import { pageAudio } from './audio-output.ts';
import {
  onsetSeconds,
  phrasePeriodBeats,
  type Feel,
  type FingeredNote,
} from './phrase.ts';
import { scheduleVoicing, type ScheduledVoicing } from './voicing-audio.ts';

/**
 * Phrase playback uses the existing plucked voicing voice, one note at a time.
 * It resumes the shared context and never calls the drone, so a stopped drone
 * stays stopped.
 */
export const PHRASE_TRIM = 0.2;

export type PhrasePlayback = 'idle' | 'starting' | 'playing' | 'error';

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
  feel: Feel,
  when: number,
): { trim: GainNode; voices: ScheduledVoicing[] } {
  const trim = context.createGain();
  trim.gain.setValueAtTime(PHRASE_TRIM, when);
  trim.connect(destination);
  const voices = notes.map((note) =>
    scheduleVoicing(
      context,
      melodyFrets(note),
      when + onsetSeconds(note.beat, tempo, feel),
      trim,
    ),
  );
  return { trim, voices };
}

type PhrasePass = {
  notes: readonly FingeredNote[];
  bars: 2 | 4;
  tempo: number;
  feel: Feel;
  loop: boolean;
};

export class PhrasePlayer {
  private serial = 0;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private context: AudioContext | null = null;
  private batches: {
    trim: GainNode;
    voices: ScheduledVoicing[];
    ends: number;
  }[] = [];
  private startedAt = 0;
  private period = 0;
  private looping = false;
  private readonly onState: (state: PhrasePlayback) => void;

  constructor(onState: (state: PhrasePlayback) => void) {
    this.onState = onState;
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
    this.release();
    if (!this.disposed) this.onState('idle');
  }

  dispose() {
    this.disposed = true;
    this.stop();
  }

  async start(input: PhrasePass) {
    if (this.disposed || !input.notes.length) return;
    this.serial += 1;
    const run = this.serial;
    this.release();
    this.onState('starting');
    try {
      const context = pageAudio().voicing;
      const resume = context.resume();
      await resume;
      if (this.disposed || run !== this.serial) return;
      if (context.state !== 'running') throw new Error('Audio is unavailable.');
      this.context = context;
      this.looping = input.loop;
      this.period = onsetSeconds(
        phrasePeriodBeats(input.bars),
        input.tempo,
        input.feel,
      );
      this.startedAt = context.currentTime + 0.05;
      this.arm(input, this.startedAt, run);
      if (run !== this.serial || this.disposed) return;
      this.onState('playing');
    } catch {
      if (this.disposed || run !== this.serial) return;
      this.release();
      this.onState('error');
    }
  }

  private arm(input: PhrasePass, when: number, run: number) {
    const context = this.context;
    if (!context) return;
    this.batches.push({
      ...schedulePhrase(
        context,
        context.destination,
        input.notes,
        input.tempo,
        input.feel,
        when,
      ),
      ends: when + this.period + 2.6,
    });
    const until = ((when + this.period - context.currentTime) * 1000) | 0;
    this.timer = setTimeout(
      () => {
        if (run !== this.serial || this.disposed) return;
        if (!input.loop) {
          this.looping = false;
          this.release();
          this.onState('idle');
          return;
        }
        this.dropFinished(context.currentTime);
        const now = context.currentTime;
        let next = when + this.period;
        if (next < now) {
          // A late timer must not walk missed periods and stack them as a chord.
          next = now + 0.05;
          this.startedAt = next;
        }
        this.arm(input, next, run);
      },
      Math.max(0, until - (input.loop ? 70 : 0)),
    );
  }

  private dropFinished(now: number) {
    const keep = [];
    for (const batch of this.batches) {
      if (batch.ends > now) keep.push(batch);
      else disconnectBatch(batch);
    }
    this.batches = keep;
  }

  private release() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const context = this.context;
    const batches = this.batches;
    this.batches = [];
    if (!context || !batches.length) return;
    const now = context.currentTime;
    for (const batch of batches) {
      try {
        batch.trim.gain.cancelScheduledValues(now);
        batch.trim.gain.setValueAtTime(batch.trim.gain.value, now);
        batch.trim.gain.linearRampToValueAtTime(0, now + 0.02);
      } catch {
        // The context may already be closed.
      }
      for (const voice of batch.voices) {
        for (const { oscillator } of voice.voices) {
          try {
            oscillator.stop(now + 0.03);
          } catch {
            // Already stopped.
          }
        }
      }
    }
    setTimeout(() => {
      for (const batch of batches) disconnectBatch(batch);
    }, 50);
  }
}

function disconnectBatch(batch: {
  trim: GainNode;
  voices: ScheduledVoicing[];
}) {
  for (const voice of batch.voices) {
    for (const { oscillator, envelope, filter } of voice.voices) {
      oscillator.disconnect();
      envelope.disconnect();
      filter.disconnect();
    }
    try {
      voice.bus.disconnect();
    } catch {
      // Already disconnected.
    }
  }
  try {
    batch.trim.disconnect();
  } catch {
    // Already disconnected.
  }
}
