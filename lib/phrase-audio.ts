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
 * Schedules cues whose audio time is inside `now + lookahead`.
 * The wake is at most one tick away, and never later than the next cue
 * minus the lookahead, so the following pass is queued before it starts.
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
  private readonly period: number;
  private readonly loop: boolean;
  private readonly onCue: (cue: PhraseCue) => void;
  private readonly onEnd: () => void;

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
  ) {
    this.clock = clock;
    this.beats = beats;
    this.tempo = tempo;
    this.swing = swing;
    this.origin = startAt;
    this.period = period;
    this.loop = loop;
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
  }

  private clear() {
    if (this.timer != null) this.clock.cancel(this.timer);
    this.timer = null;
  }

  private pump() {
    if (this.stopped || this.ended) return;
    const now = this.clock.now();
    this.wakes.push({ expected: this.expected, actual: now });
    const horizon = now + PHRASE_LOOKAHEAD_SEC;
    let guard = 0;
    while (guard++ < 10000) {
      if (this.cursor >= this.beats.length) {
        const end = this.origin + this.period;
        if (!this.loop) {
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
    const beat =
      this.cursor + 1 < this.beats.length
        ? this.beats[this.cursor + 1]
        : this.loop
          ? this.beats[0]
          : undefined;
    if (beat === undefined) return Number.POSITIVE_INFINITY;
    const origin =
      this.cursor + 1 < this.beats.length
        ? this.origin
        : this.origin + this.period;
    return origin + onsetSeconds(beat ?? 0, this.tempo, this.swing);
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
};

type LiveVoice = { voice: ScheduledVoicing; ends: number };

export class PhrasePlayer {
  private serial = 0;
  private disposed = false;
  private detachTimer: ReturnType<typeof setTimeout> | undefined;
  private scheduler: LookaheadScheduler | null = null;
  private context: AudioContext | null = null;
  private trim: GainNode | null = null;
  private voices: LiveVoice[] = [];
  private startedAt = 0;
  private period = 0;
  private looping = false;
  private readonly onState: (state: PhrasePlayback) => void;

  constructor(onState: (state: PhrasePlayback) => void) {
    this.onState = onState;
  }

  /** Scheduler wake plus the disconnect timer, for leak checks. */
  pendingTimers(): number {
    return (this.scheduler?.pending ? 1 : 0) + (this.detachTimer ? 1 : 0);
  }

  /** Trim and voice nodes not yet disconnected. */
  connectedNodes(): number {
    const voices = this.voices.reduce(
      (sum, entry) => sum + 1 + entry.voice.voices.length * 3,
      0,
    );
    return voices + (this.trim ? 1 : 0);
  }

  elapsed(): number {
    if (!this.context || this.startedAt === 0) return 0;
    const time = Math.max(0, this.context.currentTime - this.startedAt);
    if (!this.looping || this.period <= 0) return time;
    return time % this.period;
  }

  stop() {
    this.serial += 1;
    this.looping = false;
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
    this.halt(false);
    this.onState('starting');
    const tempo = clampPhraseTempo(input.tempo);
    try {
      const audio = input.context ? null : pageAudio();
      const context = (input.context ?? audio?.voicing) as AudioContext;
      const destination = input.destination ?? audio?.chain.phraseInput;
      if (!destination) throw new Error('Audio is unavailable.');
      const resume = context.resume();
      await resume;
      if (this.disposed || run !== this.serial) return;
      const offline =
        typeof (context as unknown as OfflineAudioContext).startRendering ===
        'function';
      if (!offline && context.state !== 'running') {
        throw new Error('Audio is unavailable.');
      }
      this.context = context;
      this.looping = input.loop;
      this.period = onsetSeconds(
        phrasePeriodBeats(input.bars),
        tempo,
        input.swing,
      );
      this.startedAt = context.currentTime + 0.05;
      const trim = context.createGain();
      trim.gain.setValueAtTime(PHRASE_TRIM, this.startedAt);
      trim.connect(destination);
      this.trim = trim;
      const beats = input.notes.map((note) => note.beat);
      const clock: PhraseClock = {
        now: () => context.currentTime,
        after: (delay, fn) => setTimeout(fn, Math.max(0, delay) * 1000),
        cancel: (handle) =>
          clearTimeout(handle as ReturnType<typeof setTimeout>),
      };
      this.scheduler = new LookaheadScheduler(
        clock,
        beats,
        tempo,
        input.swing,
        this.startedAt,
        this.period,
        input.loop,
        (cue) => {
          if (run !== this.serial || this.disposed || !this.trim) return;
          this.dropFinished(context.currentTime);
          const note = input.notes[cue.index];
          if (!note) return;
          const voice = scheduleVoicing(
            context,
            melodyFrets(note),
            cue.scheduled,
            this.trim,
          );
          this.voices.push({ voice, ends: cue.scheduled + 2.6 });
          if (!input.loop && cue.index === input.notes.length - 1) {
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
          const releaseEnds =
            this.startedAt + this.period + PHRASE_END_RELEASE_SEC;
          const waitMs = Math.max(
            0,
            (releaseEnds - context.currentTime) * 1000,
          );
          this.armDetach(waitMs);
          this.onState('idle');
        },
      );
      this.scheduler.start();
      if (run !== this.serial || this.disposed) return;
      this.onState('playing');
    } catch {
      if (this.disposed || run !== this.serial) return;
      this.halt(false);
      this.onState('error');
    }
  }

  private armDetach(ms: number) {
    clearTimeout(this.detachTimer);
    this.detachTimer = undefined;
    if (this.disposed) {
      this.teardown(0);
      return;
    }
    this.detachTimer = setTimeout(() => {
      this.detachTimer = undefined;
      this.teardown(0);
    }, ms);
  }

  private halt(immediate: boolean) {
    this.scheduler?.stop();
    this.scheduler = null;
    clearTimeout(this.detachTimer);
    this.detachTimer = undefined;
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
    const now = context.currentTime;
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
    this.detachTimer = setTimeout(
      () => {
        this.detachTimer = undefined;
        drop();
      },
      fadeSec * 1000 + 30,
    );
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
