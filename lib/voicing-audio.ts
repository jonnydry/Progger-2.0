import { TUNING } from './music.ts';

/** Sounding pitches, in picking order. Never deduplicate or infer from a symbol. */
export function voicingMidi(frets: readonly (number | null)[]): number[] {
  if (
    frets.length !== TUNING.length ||
    !Array.from(frets).every(
      (fret) =>
        fret === null || (Number.isInteger(fret) && fret >= 0 && fret <= 24),
    )
  )
    throw new Error('A voicing needs six valid string positions.');
  const pitches = frets.flatMap((fret, string) =>
    fret === null ? [] : [TUNING[string] + fret],
  );
  if (!pitches.length) throw new Error('This voicing has no sounding strings.');
  return pitches;
}

export type AuditionState = 'idle' | 'starting' | 'playing' | 'error';
const STRUM_GAP = 0.045;
const DECAY = 2.5;

/** Short local synthesis; no samples, requests, or context until a user plays. */
export class VoicingPlayer {
  private context: AudioContext | null = null;
  private serial = 0;
  private disposed = false;
  private cancelSound: (() => void) | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelResume: (() => void) | null = null;
  private readonly onState: (state: AuditionState) => void;
  private readonly createContext: () => AudioContext;

  constructor(
    onState: (state: AuditionState) => void,
    createContext: () => AudioContext = () => new AudioContext(),
  ) {
    this.onState = onState;
    this.createContext = createContext;
  }

  stop() {
    ++this.serial;
    this.cancelResume?.();
    this.cancelResume = null;
    clearTimeout(this.resumeTimer);
    this.cancelSound?.();
    this.cancelSound = null;
    if (!this.disposed) this.onState('idle');
  }

  async play(frets: readonly (number | null)[]) {
    if (this.disposed) return;
    this.stop();
    const run = this.serial;
    this.onState('starting');
    try {
      const pitches = voicingMidi(frets);
      // Create/resume synchronously from the user's click, before any await.
      const context = (this.context ??= this.createContext());
      context.onstatechange = () => {
        if (context.state !== 'running' && this.cancelSound) this.stop();
      };
      await Promise.race([
        context.resume(),
        new Promise<void>((resolve, reject) => {
          this.cancelResume = resolve;
          this.resumeTimer = setTimeout(
            () => reject(new Error('Audio did not start.')),
            2000,
          );
        }),
      ]);
      if (this.disposed || run !== this.serial) return;
      clearTimeout(this.resumeTimer);
      this.cancelResume = null;
      if (context.state !== 'running') throw new Error('Audio is unavailable.');

      const start = context.currentTime + 0.025;
      const bus = context.createGain();
      // Fixed headroom even when every string sounds at once.
      bus.gain.value = 0.75 / pitches.length;
      bus.connect(context.destination);
      const voices: {
        oscillator: OscillatorNode;
        envelope: GainNode;
        filter: BiquadFilterNode;
      }[] = [];
      let ended = 0;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(cleanupTimer);
        for (const { oscillator, envelope, filter } of voices) {
          oscillator.onended = null;
          oscillator.disconnect();
          envelope.disconnect();
          filter.disconnect();
        }
        bus.disconnect();
      };
      this.cancelSound = () => {
        // Fade out before stopping to avoid a hard waveform discontinuity.
        const now = context.currentTime;
        bus.gain.cancelScheduledValues(now);
        bus.gain.setValueAtTime(bus.gain.value, now);
        bus.gain.linearRampToValueAtTime(0, now + 0.018);
        for (const { oscillator } of voices) {
          try {
            oscillator.stop(now + 0.02);
          } catch {
            // A partially constructed voice may not have started yet.
          }
        }
        // Suspended audio clocks cannot deliver onended. Also clean partial
        // graph failures that never got as far as starting an oscillator.
        cleanupTimer = setTimeout(cleanup, 30);
      };

      pitches.forEach((midi, index) => {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        const filter = context.createBiquadFilter();
        const frequency = 440 * 2 ** ((midi - 69) / 12);
        // Plucking away from a string's center leaves a rounded, uneven
        // harmonic spectrum. A closing filter softens the attack into the tail.
        const real = new Float32Array(25);
        const imaginary = new Float32Array(25);
        for (let harmonic = 1; harmonic < imaginary.length; harmonic++) {
          if (frequency * harmonic < context.sampleRate / 2) {
            imaginary[harmonic] =
              Math.sin(harmonic * Math.PI * 0.23) / harmonic ** 1.35;
          }
        }
        oscillator.setPeriodicWave(context.createPeriodicWave(real, imaginary));
        oscillator.frequency.value = frequency;
        const at = start + index * STRUM_GAP;
        filter.type = 'lowpass';
        filter.Q.value = 0.45;
        filter.frequency.setValueAtTime(Math.min(5500, frequency * 12), at);
        filter.frequency.exponentialRampToValueAtTime(
          Math.max(600, frequency * 2),
          at + 1.3,
        );
        envelope.gain.setValueAtTime(0, at);
        envelope.gain.linearRampToValueAtTime(0.85, at + 0.006);
        envelope.gain.exponentialRampToValueAtTime(0.12, at + 0.65);
        envelope.gain.exponentialRampToValueAtTime(0.0001, at + DECAY);
        envelope.gain.linearRampToValueAtTime(0, at + DECAY + 0.02);
        oscillator.connect(filter).connect(envelope).connect(bus);
        voices.push({ oscillator, filter, envelope });
        oscillator.onended = () => {
          ended++;
          if (ended !== voices.length) return;
          cleanup();
          if (run === this.serial && !this.disposed) {
            this.cancelSound = null;
            this.onState('idle');
          }
        };
        oscillator.start(at);
        oscillator.stop(at + DECAY + 0.025);
      });
      this.onState('playing');
    } catch {
      if (this.disposed || run !== this.serial) return;
      this.stop();
      this.onState('error');
    }
  }

  dispose() {
    this.disposed = true;
    this.stop();
    if (this.context) {
      this.context.onstatechange = null;
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
