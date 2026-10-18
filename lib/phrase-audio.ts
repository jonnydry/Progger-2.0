import { pageAudio } from './audio-output.ts';
import {
  onsetSeconds,
  phrasePeriodBeats,
  type FingeredNote,
  type SwingInput,
} from './phrase.ts';
import { scheduleVoicing, type ScheduledVoicing } from './voicing-audio.ts';

/**
 * Phrase playback uses the existing plucked voicing voice, one note at a time.
 * It resumes the shared context and never calls the drone, so a stopped drone
 * stays stopped. Note times sit on the audio clock. A 25 ms tick only wakes
 * the scheduler; a late tick does not move a note that is still inside the
 * lookahead.
 */
export const PHRASE_TRIM = 0.2;
export const PHRASE_LOOKAHEAD_SEC = 0.15;
export const PHRASE_TICK_SEC = 0.025;
export const PHRASE_END_RELEASE_SEC = 0.3;
/**
 * The slider number is quarter-note BPM. Beat N starts at N * (60 / BPM)
 * seconds. Swing moves the offbeat eighth inside that quarter and does not
 * scale the beat. 40 is largo and 240 is prestissimo.
 */
export const PHRASE_TEMPO_MIN = 40;
export const PHRASE_TEMPO_MAX = 240;
/** New sessions start here. The number is already quarter notes per minute. */
export const PHRASE_TEMPO_DEFAULT = 96;

export type PhrasePlayback = 'idle' | 'starting' | 'playing' | 'error';

export function clampPhraseTempo(tempo: number): number {
  if (!Number.isFinite(tempo)) return PHRASE_TEMPO_DEFAULT;
  return Math.min(PHRASE_TEMPO_MAX, Math.max(PHRASE_TEMPO_MIN, tempo));
}

/** Quarter-note meter. Callers can pass another bar size; there is no control for it. */
export const PHRASE_BEATS_PER_BAR = 4;

function barSize(beatsPerBar: number): number {
  return beatsPerBar > 0 ? beatsPerBar : PHRASE_BEATS_PER_BAR;
}

/** A downbeat after the start. Beat 0 is the first note, not the cadence. */
function onLaterDownbeat(beat: number, bar: number): boolean {
  if (!(beat > 1e-9) || !(bar > 0)) return false;
  const bars = beat / bar;
  return Math.abs(bars - Math.round(bars)) < 1e-9;
}

/**
 * The closing cadence, when the last note starts on a later downbeat.
 * Generated phrases put that landing on the bar after the last bar.
 */
export function phraseClosingIndex(
  notes: readonly { beat: number; duration?: number }[],
  beatsPerBar: number = PHRASE_BEATS_PER_BAR,
): number {
  const bar = barSize(beatsPerBar);
  const index = notes.length - 1;
  const last = notes[index];
  if (!last || !onLaterDownbeat(last.beat, bar)) return -1;
  return index;
}

/**
 * Beats from the downbeat through the bar that holds the last onset
 * that is not the closing cadence. An onset that lands exactly on a
 * bar line still fills the next bar, so that note stays inside the
 * loop. The cadence starts on the following downbeat and is left out,
 * and the next pass's first note is that landing. `beatsPerBar`
 * defaults to 4. A 3/4 bar is 3. An onset on beat 0 still fills its bar.
 */
export function phraseLoopBeats(
  notes: readonly { beat: number; duration?: number }[],
  beatsPerBar: number = PHRASE_BEATS_PER_BAR,
): number {
  const bar = barSize(beatsPerBar);
  const closing = phraseClosingIndex(notes, bar);
  const closingBeat = closing >= 0 ? notes[closing]?.beat : null;
  let onset = -1;
  for (const note of notes) {
    if (
      closingBeat != null &&
      Number.isFinite(note.beat) &&
      Math.abs(note.beat - closingBeat) < 1e-9
    ) {
      continue;
    }
    if (Number.isFinite(note.beat) && note.beat > onset) onset = note.beat;
  }
  if (!(onset >= 0)) return 0;
  const bars = Math.floor(onset / bar + 1e-9) + 1;
  return bars * bar;
}

/** Straight seconds for `phraseLoopBeats`. Swing does not move a bar line. */
export function phraseLoopSeconds(
  notes: readonly { beat: number; duration?: number }[],
  tempo: number,
  beatsPerBar: number = PHRASE_BEATS_PER_BAR,
): number {
  return phraseLoopBeats(notes, beatsPerBar) * (60 / clampPhraseTempo(tempo));
}

export function melodyFrets(note: {
  string: number;
  fret: number;
}): (number | null)[] {
  const frets: (number | null)[] = [null, null, null, null, null, null];
  frets[note.string] = note.fret;
  return frets;
}

export function schedulePhrase(
  context: BaseAudioContext,
  destination: AudioNode,
  notes: readonly { string: number; fret: number; beat: number }[],
  tempo: number,
  swing: SwingInput,
  when: number,
): { trim: GainNode; voices: ScheduledVoicing[] } {
  const trim = context.createGain();
  trim.gain.setValueAtTime(PHRASE_TRIM, when);
  trim.connect(destination);
  const voices = notes.map((note) =>
    scheduleVoicing(
      context,
      melodyFrets(note),
      when + onsetSeconds(note.beat, clampPhraseTempo(tempo), swing),
      trim,
    ),
  );
  return { trim, voices };
}

export type PhraseClock = {
  now(): number;
  after(delaySec: number, fn: () => void): unknown;
  cancel(handle: unknown): void;
};

export type PhraseCue = {
  index: number;
  /** Audio time the note should sound. */
  intended: number;
  /** Audio time handed to the voice. Equals `intended` while the lookahead holds. */
  scheduled: number;
};

export type PhraseWake = { expected: number; actual: number };

/**
 * Schedules cues whose audio time is inside the horizon.
 * One pass looks ahead by `PHRASE_LOOKAHEAD_SEC`. A loop looks ahead by
 * that plus one whole period, so the next downbeat is already on the audio
 * clock a period before it sounds. Notes at or after `loopBeats` are the
 * closing cadence: a loop skips them so that downbeat is not struck twice.
 * The wake is at most one tick away. A late tick cannot move a note that
 * was queued inside the horizon.
 */
export class LookaheadScheduler {
  readonly cues: PhraseCue[] = [];
  readonly wakes: PhraseWake[] = [];
  private timer: unknown = null;
  private stopped = false;
  private ended = false;
  private cursor = 0;
  private origin: number;
  private expected = 0;
  private readonly clock: PhraseClock;
  private readonly beats: readonly number[];
  private readonly tempo: number;
  private readonly swing: SwingInput;
  private period: number;
  private loop: boolean;
  /** While looping, beats at or after this value are not played. */
  private loopBeats: number;
  private readonly onCue: (cue: PhraseCue) => void;
  private readonly onEnd: () => void;
  /** Notes at or after this time belong to the pass being replaced. */
  private suppressAt = Number.POSITIVE_INFINITY;
  private onSuppress: (() => void) | null = null;

  constructor(
    clock: PhraseClock,
    beats: readonly number[],
    tempo: number,
    swing: SwingInput,
    startAt: number,
    period: number,
    loop: boolean,
    onCue: (cue: PhraseCue) => void,
    onEnd: () => void,
    loopBeats = Number.POSITIVE_INFINITY,
  ) {
    this.clock = clock;
    this.beats = beats;
    this.tempo = tempo;
    this.swing = swing;
    this.origin = startAt;
    this.period = period;
    this.loop = loop;
    this.loopBeats = loopBeats;
    this.onCue = onCue;
    this.onEnd = onEnd;
  }

  get pending(): boolean {
    return this.timer != null;
  }

  start() {
    this.expected = this.clock.now();
    this.pump();
  }

  stop() {
    this.stopped = true;
    this.clear();
    this.onSuppress = null;
  }

  /**
   * Drop notes already queued at or after `boundary` and stop there
   * instead of wrapping. `onReach` runs about a lookahead before the
   * boundary, so the next phrase can be placed on that instant.
   */
  suppressFrom(boundary: number, onReach: () => void): void {
    this.suppressAt = boundary;
    this.onSuppress = onReach;
    for (let index = this.cues.length - 1; index >= 0; index -= 1) {
      const cue = this.cues[index];
      if (cue && cue.intended >= boundary - 1e-4) this.cues.splice(index, 1);
    }
    if (this.stopped || this.ended) return;
    this.pump();
  }

  clearSuppress(): void {
    this.suppressAt = Number.POSITIVE_INFINITY;
    this.onSuppress = null;
  }

  /**
   * Stop wrapping. Drop cues already queued at or after this pass's loop
   * end, then play the rest of the pass the way Loop off does, including
   * the closing note, and stop at `holdPeriod`.
   */
  releaseLoop(passOrigin: number, holdPeriod: number, landingIndex: number) {
    const boundary = passOrigin + this.period;
    for (let index = this.cues.length - 1; index >= 0; index -= 1) {
      const cue = this.cues[index];
      if (cue && cue.intended >= boundary - 1e-4) this.cues.splice(index, 1);
    }
    this.loop = false;
    this.loopBeats = Number.POSITIVE_INFINITY;
    this.origin = passOrigin;
    if (holdPeriod > 1e-4) this.period = holdPeriod;
    this.cursor = landingIndex >= 0 ? landingIndex : this.beats.length;
    this.ended = false;
    this.pump();
  }

  private clear() {
    if (this.timer != null) this.clock.cancel(this.timer);
    this.timer = null;
  }

  private pump() {
    if (this.stopped || this.ended) return;
    const now = this.clock.now();
    this.wakes.push({ expected: this.expected, actual: now });
    const looping = this.loop && this.period > 1e-4;
    const horizon = now + PHRASE_LOOKAHEAD_SEC + (looping ? this.period : 0);
    let guard = 0;
    while (guard++ < 10000) {
      if (this.loop && this.loopBeats < Infinity) {
        while (
          this.cursor < this.beats.length &&
          (this.beats[this.cursor] ?? 0) >= this.loopBeats - 1e-9
        ) {
          this.cursor += 1;
        }
      }
      if (this.cursor >= this.beats.length) {
        const end = this.origin + this.period;
        if (
          this.suppressAt < Number.POSITIVE_INFINITY &&
          end >= this.suppressAt - 1e-4
        ) {
          this.reachSuppress(now);
          return;
        }
        if (!looping) {
          if (end > horizon) {
            this.wake(Math.min(end, now + PHRASE_TICK_SEC));
            return;
          }
          this.ended = true;
          this.clear();
          this.onEnd();
          return;
        }
        this.origin += this.period;
        this.cursor = 0;
        continue;
      }
      const intended =
        this.origin +
        onsetSeconds(this.beats[this.cursor] ?? 0, this.tempo, this.swing);
      if (intended >= this.suppressAt - 1e-4) {
        this.reachSuppress(now);
        return;
      }
      if (intended > horizon) {
        const wakeAt = Math.min(
          intended - PHRASE_LOOKAHEAD_SEC,
          now + PHRASE_TICK_SEC,
        );
        // A hair past the horizon is still this pass. A wake that is
        // only a rounding error ahead calls setTimeout(0) and sounds late.
        if (wakeAt > now + 1e-4) {
          this.wake(wakeAt);
          return;
        }
      }
      const nextIntended = this.nextIntended();
      // A wake that missed a run of notes would otherwise sound them as one
      // chord. Drop every overdue note except the latest.
      if (intended + 1e-4 < now && nextIntended <= now) {
        this.cursor += 1;
        continue;
      }
      const scheduled = intended + 1e-4 < now ? now : intended;
      const cue = { index: this.cursor, intended, scheduled };
      this.cues.push(cue);
      this.onCue(cue);
      this.cursor += 1;
    }
  }

  private nextIntended(): number {
    let index = this.cursor + 1;
    let origin = this.origin;
    const guardMax = this.beats.length * 2 + 2;
    for (let guard = 0; guard < guardMax; guard += 1) {
      if (index >= this.beats.length) {
        if (!(this.loop && this.period > 1e-4)) return Number.POSITIVE_INFINITY;
        index = 0;
        origin += this.period;
        continue;
      }
      const beat = this.beats[index] ?? 0;
      if (this.loop && beat >= this.loopBeats - 1e-9) {
        index += 1;
        continue;
      }
      return origin + onsetSeconds(beat, this.tempo, this.swing);
    }
    return Number.POSITIVE_INFINITY;
  }

  private reachSuppress(now: number): void {
    const wakeAt = this.suppressAt - PHRASE_LOOKAHEAD_SEC;
    if (wakeAt > now + 1e-4) {
      this.wake(wakeAt);
      return;
    }
    this.ended = true;
    this.clear();
    const reach = this.onSuppress;
    this.onSuppress = null;
    this.suppressAt = Number.POSITIVE_INFINITY;
    reach?.();
  }

  private wake(when: number) {
    this.clear();
    const now = this.clock.now();
    this.expected = Math.max(when, now);
    this.timer = this.clock.after(this.expected - now, () => {
      this.timer = null;
      this.pump();
    });
  }
}

type PhrasePass = {
  notes: readonly FingeredNote[];
  bars: 2 | 4;
  tempo: number;
  swing: SwingInput;
  loop: boolean;
  context?: BaseAudioContext;
  destination?: AudioNode;
  /** Test clock. Playback uses the audio context when this is omitted. */
  clock?: PhraseClock;
};

type LiveVoice = {
  voice: ScheduledVoicing;
  ends: number;
  scheduled: number;
};

export class PhrasePlayer {
  private serial = 0;
  private disposed = false;
  /** Waits out a finished pass, then disconnects whatever is still current. */
  private endTimer: ReturnType<typeof setTimeout> | undefined;
  /** Fades already heading for zero. A new start leaves these timers alone. */
  private fades: { timer: ReturnType<typeof setTimeout>; drop: () => void }[] =
    [];
  /** Starts the queued phrase a lookahead before its boundary. */
  private queueTimer: unknown = null;
  /** Boundary the queue timer is waiting on. */
  private queueAt = Number.NaN;
  private scheduler: LookaheadScheduler | null = null;
  private context: AudioContext | null = null;
  private trim: GainNode | null = null;
  private voices: LiveVoice[] = [];
  private startedAt = 0;
  private period = 0;
  /** Loop-off length, including the two-beat cadence hold. */
  private holdPeriod = 0;
  private landingIndex = -1;
  private looping = false;
  /** Loop was turned off and this pass is still sounding its cadence. */
  private finishing = false;
  /** Latest phrase waiting for the current pass to end. Earlier ones are dropped. */
  private pending: PhrasePass | null = null;
  /** Sounding graph kept until the queued phrase's downbeat. */
  private preserved: {
    at: number;
    trim: GainNode | null;
    voices: LiveVoice[];
  } | null = null;
  /** Phrases already replaced, fading under the one that just started. */
  private releases: {
    trim: GainNode | null;
    voices: LiveVoice[];
    dropped: boolean;
    timer: unknown;
    cancel: () => void;
  }[] = [];
  private clock: PhraseClock | null = null;
  private readonly onState: (state: PhrasePlayback) => void;

  constructor(onState: (state: PhrasePlayback) => void) {
    this.onState = onState;
  }

  /** Scheduler wake plus disconnect timers, for leak checks. */
  pendingTimers(): number {
    return (
      (this.scheduler?.pending ? 1 : 0) +
      (this.endTimer ? 1 : 0) +
      this.fades.length
    );
  }

  /** Trim and voice nodes not yet disconnected. */
  connectedNodes(): number {
    const voices = this.voices.reduce(
      (sum, entry) => sum + 1 + entry.voice.voices.length * 3,
      0,
    );
    return voices + (this.trim ? 1 : 0);
  }

  get isLooping(): boolean {
    return this.looping;
  }

  /**
   * A looping pass, or the cadence after Loop was turned off, is still
   * sounding. A new phrase waits for that boundary instead of cutting it.
   */
  phraseChangeWaits(): boolean {
    return this.looping || this.finishing;
  }

  /**
   * Remember the newest phrase and start it when the sounding pass ends.
   * Looping switches at the seam. A finishing pass plays its closing note
   * through the hold, then starts. Nothing is waiting when this is called
   * outside those passes, so the phrase starts now. A later call replaces
   * one that has not started.
   */
  queuePhrase(input: PhrasePass): void {
    if (this.disposed || !input.notes.length) return;
    if (input.bars !== 2 && input.bars !== 4) return;
    if (!this.phraseChangeWaits()) {
      void this.start(input);
      return;
    }
    this.pending = input;
    if (this.looping) this.suppressNextPass();
  }

  elapsed(): number {
    const now = this.clock?.now() ?? this.context?.currentTime;
    if (now === undefined || this.startedAt === 0) return 0;
    const time = Math.max(0, now - this.startedAt);
    if (!this.looping || this.period <= 0) return time;
    return time % this.period;
  }

  /**
   * Loop was turned off during this pass. Drop the repeat that was already
   * queued, play the closing note, and run out the cadence hold. Nothing
   * from a later pass is scheduled.
   */
  finishPass() {
    if (!this.looping || !this.scheduler || !this.context || !this.trim) return;
    const now = this.clock?.now() ?? this.context.currentTime;
    const loopPeriod = this.period;
    if (!(loopPeriod > 1e-4)) return;
    this.cancelQueueTimer();
    this.scheduler.clearSuppress();
    const elapsed = now - this.startedAt;
    const pass = Math.max(0, Math.floor(elapsed / loopPeriod + 1e-9));
    const passOrigin = this.startedAt + pass * loopPeriod;
    const boundary = passOrigin + loopPeriod;
    this.looping = false;
    this.startedAt = passOrigin;
    this.period = this.holdPeriod > 1e-4 ? this.holdPeriod : loopPeriod;
    this.voices = this.soundingVoices(this.voices, boundary, now);
    const end = passOrigin + this.period;
    try {
      this.trim.gain.setValueAtTime(PHRASE_TRIM, end);
      this.trim.gain.linearRampToValueAtTime(0, end + PHRASE_END_RELEASE_SEC);
    } catch {
      // The context may already be closed.
    }
    this.scheduler.releaseLoop(passOrigin, this.period, this.landingIndex);
    this.finishing = true;
    // The queued phrase was captured while Loop was on. Loop is off now,
    // so that request plays once, closing note included.
    if (this.pending) this.pending = { ...this.pending, loop: false };
  }

  stop() {
    this.serial += 1;
    this.looping = false;
    this.finishing = false;
    this.pending = null;
    this.preserved = null;
    this.cancelQueueTimer();
    this.scheduler?.clearSuppress();
    this.halt(false);
    if (!this.disposed) this.onState('idle');
  }

  dispose() {
    this.disposed = true;
    this.stop();
  }

  async start(input: PhrasePass) {
    if (this.disposed || !input.notes.length) return;
    if (input.bars !== 2 && input.bars !== 4) return;
    this.serial += 1;
    const run = this.serial;
    this.pending = null;
    this.finishing = false;
    this.cancelQueueTimer();
    const preserved = this.preserved;
    this.preserved = null;
    let replaced: {
      at: number;
      trim: GainNode | null;
      voices: LiveVoice[];
    } | null = null;
    // When this pass is already inside its end release. Anchoring the
    // overlap at the new phrase's lead time steps that ramp.
    let replacedReleaseAt = Number.NaN;
    if (preserved) {
      this.scheduler?.stop();
      this.scheduler = null;
      this.clearEndTimer();
      this.voices = [];
      this.trim = null;
    } else if (this.scheduler || this.trim || this.voices.length) {
      // An immediate switch, including plain Loop off, keeps this pass
      // audible and fades it as the new phrase starts.
      if (!this.looping && this.period > 1e-4) {
        replacedReleaseAt = this.startedAt + this.period;
      }
      replaced = { at: 0, trim: this.trim, voices: this.voices.slice() };
      this.scheduler?.stop();
      this.scheduler = null;
      this.clearEndTimer();
      this.voices = [];
      this.trim = null;
    } else {
      this.halt(false);
    }
    this.onState('starting');
    try {
      const audio = input.context ? null : pageAudio();
      const context = (input.context ?? audio?.voicing) as AudioContext;
      const destination = input.destination ?? audio?.chain.phraseInput;
      if (!destination) throw new Error('Audio is unavailable.');
      const resume = context.resume();
      await resume;
      if (this.disposed || run !== this.serial) {
        if (preserved) this.disconnectPreserved(preserved);
        if (replaced) this.disconnectPreserved(replaced);
        return;
      }
      // A request that arrived during resume() replaces this one.
      // Leaving it pending would play the stale phrase and start the
      // new one later.
      const phrase = this.pending ?? input;
      this.pending = null;
      const tempo = clampPhraseTempo(phrase.tempo);
      const offline =
        typeof (context as unknown as OfflineAudioContext).startRendering ===
        'function';
      if (!offline && context.state !== 'running') {
        throw new Error('Audio is unavailable.');
      }
      this.context = context;
      const loopBeats = phraseLoopBeats(phrase.notes);
      const loopPeriod = phraseLoopSeconds(phrase.notes, tempo);
      const looping = phrase.loop && loopPeriod > 1e-4;
      this.looping = looping;
      this.holdPeriod = onsetSeconds(
        phrasePeriodBeats(phrase.bars),
        tempo,
        phrase.swing,
      );
      this.landingIndex = phraseClosingIndex(phrase.notes);
      // A loop ends on the bar line after the last non-closing onset.
      // An onset on a bar line fills the next bar, so that note plays.
      // The cadence starts on the loop end and is skipped; the next
      // pass's first note is that landing. Loop off plays the cadence
      // and holds it for two beats.
      this.period = looping ? loopPeriod : this.holdPeriod;
      const clock: PhraseClock = phrase.clock ?? {
        now: () => context.currentTime,
        after: (delay, fn) => setTimeout(fn, Math.max(0, delay) * 1000),
        cancel: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      };
      this.clock = clock;
      this.startedAt = preserved ? preserved.at : clock.now() + 0.05;
      const trim = context.createGain();
      trim.gain.setValueAtTime(PHRASE_TRIM, this.startedAt);
      trim.connect(destination);
      this.trim = trim;
      const beats = phrase.notes.map((note) => note.beat);
      this.scheduler = new LookaheadScheduler(
        clock,
        beats,
        tempo,
        phrase.swing,
        this.startedAt,
        this.period,
        looping,
        (cue) => {
          if (run !== this.serial || this.disposed || !this.trim) return;
          this.dropFinished(this.clock?.now() ?? context.currentTime);
          const note = phrase.notes[cue.index];
          if (!note) return;
          const voice = scheduleVoicing(
            context,
            melodyFrets(note),
            cue.scheduled,
            this.trim,
          );
          this.voices.push({
            voice,
            ends: cue.scheduled + 2.6,
            scheduled: cue.scheduled,
          });
          if (!looping && cue.index === phrase.notes.length - 1) {
            const end = this.startedAt + this.period;
            this.trim.gain.setValueAtTime(PHRASE_TRIM, end);
            this.trim.gain.linearRampToValueAtTime(
              0,
              end + PHRASE_END_RELEASE_SEC,
            );
          }
        },
        () => {
          if (run !== this.serial || this.disposed) return;
          this.looping = false;
          this.scheduler = null;
          const end = this.startedAt + this.period;
          if (this.pending) {
            this.armQueuedStart(end);
            return;
          }
          this.finishing = false;
          const releaseEnds = end + PHRASE_END_RELEASE_SEC;
          const waitMs = Math.max(
            0,
            (releaseEnds - (this.clock?.now() ?? context.currentTime)) * 1000,
          );
          this.armDetach(waitMs);
          this.onState('idle');
        },
        looping ? loopBeats : Number.POSITIVE_INFINITY,
      );
      this.scheduler.start();
      if (run !== this.serial || this.disposed) {
        if (preserved) this.disconnectPreserved(preserved);
        if (replaced) this.disconnectPreserved(replaced);
        return;
      }
      if (preserved) this.fadePreserved(preserved);
      if (replaced) {
        const now =
          this.clock?.now() ?? this.context?.currentTime ?? this.startedAt;
        const inTail =
          Number.isFinite(replacedReleaseAt) &&
          now >= replacedReleaseAt - 1e-4 &&
          now <= replacedReleaseAt + PHRASE_END_RELEASE_SEC + 1e-4;
        replaced.at = inTail ? now : this.startedAt;
        // A note that has not started by the switch would pluck inside
        // the release. Drop it the way a seam switch does.
        replaced.voices = this.soundingVoices(
          replaced.voices,
          this.startedAt,
          now,
        );
        this.fadePreserved(replaced);
      }
      this.onState('playing');
    } catch {
      if (this.disposed || run !== this.serial) return;
      this.halt(false);
      this.onState('error');
    }
  }

  private suppressNextPass(): void {
    if (!this.scheduler || !this.clock || !(this.period > 1e-4)) return;
    const now = this.clock.now();
    const elapsed = now - this.startedAt;
    const pass = Math.max(0, Math.floor(elapsed / this.period + 1e-9));
    const boundary = this.startedAt + (pass + 1) * this.period;
    this.dropVoicesFrom(boundary, now);
    this.scheduler.suppressFrom(boundary, () => {
      this.armQueuedStart(boundary);
    });
    // Arm now, not when the lookahead arrives, so Stop can cancel the
    // switch. The suppress callback still starts it if this timer is gone.
    this.armQueuedStart(boundary);
  }

  private dropVoicesFrom(boundary: number, now: number): void {
    this.voices = this.soundingVoices(this.voices, boundary, now);
  }

  /**
   * Keep voices that have already started, or that start before
   * `boundary`. Anything scheduled from `boundary` onward that is still
   * in the future would sound inside the fade.
   */
  private soundingVoices(
    voices: LiveVoice[],
    boundary: number,
    now: number,
  ): LiveVoice[] {
    const keep: LiveVoice[] = [];
    for (const entry of voices) {
      if (entry.scheduled >= boundary - 1e-4 && entry.scheduled > now + 1e-4) {
        disconnectVoice(entry.voice);
      } else {
        keep.push(entry);
      }
    }
    return keep;
  }

  private armQueuedStart(at: number): void {
    const now = this.clock?.now() ?? at;
    const beginAt = at - PHRASE_LOOKAHEAD_SEC;
    const fire = () => {
      this.queueTimer = null;
      this.queueAt = Number.NaN;
      void this.beginQueued(at);
    };
    if (!(beginAt > now + 1e-4) || !this.clock) {
      this.cancelQueueTimer();
      fire();
      return;
    }
    if (this.queueTimer != null && this.queueAt === at) return;
    this.cancelQueueTimer();
    this.queueAt = at;
    this.queueTimer = this.clock.after(beginAt - now, fire);
  }

  private cancelQueueTimer(): void {
    if (this.queueTimer != null) this.clock?.cancel(this.queueTimer);
    this.queueTimer = null;
    this.queueAt = Number.NaN;
  }

  private async beginQueued(at: number): Promise<void> {
    if (this.disposed) return;
    const input = this.pending;
    this.pending = null;
    if (!input) return;
    this.preserved = {
      at,
      trim: this.trim,
      voices: this.voices.slice(),
    };
    await this.start(input);
  }

  private dropOutgoing(): void {
    const now = this.context?.currentTime ?? 0;
    for (const fade of this.releases.splice(0)) {
      fade.dropped = true;
      fade.cancel();
      // Stop within the overlap used to cut the phrase that was still
      // fading. Give it the same 20 ms release as the phrase Stop fades.
      this.releaseGraph(fade.trim, fade.voices, now, 0.02);
    }
  }

  /**
   * Let the phrase that just ended fall away on the same release as a
   * finished pass. The new phrase starts at `at`; this ramp overlaps it.
   * Stop does not use this path.
   */
  private fadePreserved(preserved: {
    at: number;
    trim: GainNode | null;
    voices: LiveVoice[];
  }): void {
    const end = preserved.at + PHRASE_END_RELEASE_SEC;
    if (preserved.trim) {
      try {
        const gain = preserved.trim.gain;
        gain.cancelScheduledValues(preserved.at);
        gain.setValueAtTime(gain.value, preserved.at);
        gain.linearRampToValueAtTime(0, end);
      } catch {
        // The context may already be closed.
      }
    }
    for (const entry of preserved.voices) {
      for (const { oscillator } of entry.voice.voices) {
        try {
          oscillator.stop(end);
        } catch {
          // Already stopped.
        }
      }
    }
    const fade = {
      trim: preserved.trim,
      voices: preserved.voices,
      dropped: false,
      timer: null as unknown,
      cancel: () => {},
    };
    this.releases.push(fade);
    const finish = () => {
      if (fade.dropped) return;
      fade.dropped = true;
      this.releases = this.releases.filter((item) => item !== fade);
      this.disconnectPreserved(fade);
    };
    const now = this.clock?.now() ?? preserved.at;
    const wait = end - now;
    const clock = this.clock;
    if (wait > 1e-4 && clock) {
      fade.timer = clock.after(wait, finish);
      fade.cancel = () => {
        if (fade.timer != null) clock.cancel(fade.timer);
        fade.timer = null;
      };
      return;
    }
    finish();
  }

  private disconnectPreserved(preserved: {
    trim: GainNode | null;
    voices: LiveVoice[];
  }): void {
    if (preserved.trim) disconnectNode(preserved.trim);
    for (const entry of preserved.voices) disconnectVoice(entry.voice);
  }

  private clearEndTimer() {
    clearTimeout(this.endTimer);
    this.endTimer = undefined;
  }

  /** Disconnect fades that have not reached the end of their ramp. */
  private finishFadesNow() {
    const pending = this.fades;
    this.fades = [];
    for (const entry of pending) {
      clearTimeout(entry.timer);
      entry.drop();
    }
  }

  private trackFade(drop: () => void, ms: number) {
    const entry = {
      drop,
      timer: setTimeout(() => {
        this.fades = this.fades.filter((item) => item !== entry);
        drop();
      }, ms),
    };
    this.fades.push(entry);
  }

  private armDetach(ms: number) {
    this.clearEndTimer();
    if (this.disposed) {
      this.finishFadesNow();
      this.teardown(0);
      return;
    }
    this.endTimer = setTimeout(() => {
      this.endTimer = undefined;
      this.teardown(0);
    }, ms);
  }

  private halt(immediate: boolean) {
    this.dropOutgoing();
    this.scheduler?.stop();
    this.scheduler = null;
    this.clearEndTimer();
    // A stop fade keeps its timer. Clearing it here disconnects the gain
    // while the 20 ms ramp is still moving, which clicks.
    if (this.disposed || immediate) this.finishFadesNow();
    this.teardown(this.disposed || immediate ? 0 : 0.02);
  }

  private dropFinished(now: number) {
    const keep: LiveVoice[] = [];
    for (const entry of this.voices) {
      if (entry.ends > now) keep.push(entry);
      else disconnectVoice(entry.voice);
    }
    this.voices = keep;
  }

  private teardown(fadeSec: number) {
    const context = this.context;
    const trim = this.trim;
    const voices = this.voices;
    this.voices = [];
    this.trim = null;
    if (!context || (!trim && !voices.length)) return;
    this.releaseGraph(trim, voices, context.currentTime, fadeSec);
  }

  /** Ramp `trim` to silence, then disconnect. A zero fade drops at once. */
  private releaseGraph(
    trim: GainNode | null,
    voices: LiveVoice[],
    now: number,
    fadeSec: number,
  ): void {
    if (trim) {
      try {
        trim.gain.cancelScheduledValues(now);
        trim.gain.setValueAtTime(trim.gain.value, now);
        if (fadeSec > 0) trim.gain.linearRampToValueAtTime(0, now + fadeSec);
        else trim.gain.setValueAtTime(0, now);
      } catch {
        // The context may already be closed.
      }
    }
    for (const entry of voices) {
      for (const { oscillator } of entry.voice.voices) {
        try {
          oscillator.stop(now + fadeSec + 0.01);
        } catch {
          // Already stopped.
        }
      }
    }
    const drop = () => {
      if (trim) disconnectNode(trim);
      for (const entry of voices) disconnectVoice(entry.voice);
    };
    if (fadeSec <= 0 || this.disposed) {
      drop();
      return;
    }
    this.trackFade(drop, fadeSec * 1000 + 30);
  }
}

/** Stop on hide, tab discard, and bfcache restore. Never starts playback. */
export function bindPhraseLifecycle(
  doc: {
    hidden: boolean;
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
  },
  host: {
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
  },
  pause: () => void,
): () => void {
  const onVisibility = () => {
    if (doc.hidden) pause();
  };
  const onPageHide = () => pause();
  const onPageShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) pause();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  host.addEventListener('pagehide', onPageHide);
  host.addEventListener('pageshow', onPageShow);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    host.removeEventListener('pagehide', onPageHide);
    host.removeEventListener('pageshow', onPageShow);
  };
}

function disconnectNode(node: AudioNode) {
  try {
    node.disconnect();
  } catch {
    // Already disconnected.
  }
}

function disconnectVoice(voice: ScheduledVoicing) {
  for (const { oscillator, envelope, filter } of voice.voices) {
    disconnectNode(oscillator);
    disconnectNode(envelope);
    disconnectNode(filter);
  }
  disconnectNode(voice.bus);
}
