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

export type PhraseVoiceOptions = {
  /** Velocity multiplier in (0, 1]; never above 1 so drone headroom is preserved. */
  velocity?: number;
  /** Pluck attack ramp in seconds (default 0.006; softer for same-string legato). */
  attackSec?: number;
  /** Multiplier on initial lowpass cutoff (default 1). */
  cutoffScale?: number;
  /** Minimum decay tail in seconds when a slow tempo note outlasts DECAY (2.5 s). */
  minTailSec?: number;
  /** Neck-position warmth: higher frets gently soften upper brilliance. */
  fret?: number;
  /** String index 0 (low E) to 5 (high E) for subtle neck-position warmth. */
  string?: number;
};

const waveCache = new WeakMap<BaseAudioContext, Map<number, PeriodicWave>>();

function pluckWave(
  context: BaseAudioContext,
  frequency: number,
): PeriodicWave {
  const nyquist = context.sampleRate / 2;
  let maxHarmonic = 0;
  for (let harmonic = 1; harmonic < 25; harmonic += 1) {
    if (frequency * harmonic < nyquist) maxHarmonic = harmonic;
  }
  let byContext = waveCache.get(context);
  if (!byContext) {
    byContext = new Map();
    waveCache.set(context, byContext);
  }
  const cached = byContext.get(maxHarmonic);
  if (cached) return cached;
  const real = new Float32Array(25);
  const imaginary = new Float32Array(25);
  for (let harmonic = 1; harmonic <= maxHarmonic; harmonic += 1) {
    imaginary[harmonic] =
      Math.sin(harmonic * Math.PI * 0.23) / harmonic ** 1.35;
  }
  const wave = context.createPeriodicWave(real, imaginary);
  byContext.set(maxHarmonic, wave);
  return wave;
}

export type ScheduledVoicing = {
  bus: GainNode;
  voices: {
    oscillator: OscillatorNode;
    envelope: GainNode;
    filter: BiquadFilterNode;
  }[];
};

/** The chord the audition button plays. Offline renders call this same function. */
export function scheduleVoicing(
  context: BaseAudioContext,
  frets: readonly (number | null)[],
  when: number,
  destination: AudioNode,
  beforeVoices?: (
    bus: GainNode,
    voices: ScheduledVoicing['voices'],
  ) => void,
  options?: PhraseVoiceOptions,
): ScheduledVoicing {
  const pitches = voicingMidi(frets);
  const bus = context.createGain();
  bus.gain.value = 0.75 / pitches.length;
  bus.connect(destination);
  const voices: ScheduledVoicing['voices'] = [];
  // A failure while building a voice still has to drop this bus. Playback
  // installs that cleanup before the first oscillator exists.
  beforeVoices?.(bus, voices);
  for (const [index, midi] of pitches.entries()) {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    // Plucking away from a string's center leaves a rounded, uneven spectrum.
    oscillator.setPeriodicWave(pluckWave(context, frequency));
    oscillator.frequency.value = frequency;
    const at = when + index * STRUM_GAP;
    filter.type = 'lowpass';
    filter.Q.value = 0.45;
    if (!options) {
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
      oscillator.connect(filter);
      filter.connect(envelope);
      envelope.connect(bus);
      oscillator.start(at);
      oscillator.stop(at + DECAY + 0.025);
      voices.push({ oscillator, envelope, filter });
    } else {
      const velocity = Math.min(1, Math.max(0.2, options.velocity ?? 1));
      const attack = Math.max(0.004, options.attackSec ?? 0.006);
      const cutoffScale = Math.min(1.15, Math.max(0.55, options.cutoffScale ?? 1));
      const fretWarmth =
        options.fret !== undefined && options.fret > 5
          ? Math.max(0.84, 1 - (options.fret - 5) * 0.008)
          : 1;
      const stringWarmth =
        options.string !== undefined
          ? 0.94 + Math.min(5, Math.max(0, options.string)) * 0.018
          : 1;
      const warmth = fretWarmth * stringWarmth;
      const decaySec = Math.max(DECAY, options.minTailSec ?? DECAY);
      const bodySec = 0.65 * (decaySec / DECAY);
      const peakLevel = 0.85 * velocity;
      const bodyLevel = Math.max(0.0002, 0.12 * velocity);
      const startCutoff = Math.min(
        5500,
        Math.max(1500, frequency * 12) * cutoffScale * warmth,
      );
      const endCutoff = Math.max(
        600,
        Math.min(startCutoff, frequency * 2 * warmth),
      );
      filter.frequency.setValueAtTime(startCutoff, at);
      filter.frequency.exponentialRampToValueAtTime(
        endCutoff,
        at + 1.3 * (decaySec / DECAY),
      );
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(peakLevel, at + attack);
      envelope.gain.exponentialRampToValueAtTime(bodyLevel, at + bodySec);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + decaySec);
      envelope.gain.linearRampToValueAtTime(0, at + decaySec + 0.02);
      oscillator.connect(filter);
      filter.connect(envelope);
      envelope.connect(bus);
      oscillator.start(at);
      oscillator.stop(at + decaySec + 0.025);
      voices.push({ oscillator, envelope, filter });
    }
  }
  return { bus, voices };
}

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
      voicingMidi(frets);
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
      let ended = 0;
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      let cleanup = () => {};
      const { voices } = scheduleVoicing(
        context,
        frets,
        start,
        context.destination,
        (chordBus, chordVoices) => {
          cleanup = () => {
            clearTimeout(cleanupTimer);
            for (const { oscillator, envelope, filter } of chordVoices) {
              oscillator.onended = null;
              oscillator.disconnect();
              envelope.disconnect();
              filter.disconnect();
            }
            chordBus.disconnect();
          };
          this.cancelSound = () => {
            // Fade out before stopping to avoid a hard waveform discontinuity.
            const now = context.currentTime;
            chordBus.gain.cancelScheduledValues(now);
            chordBus.gain.setValueAtTime(chordBus.gain.value, now);
            chordBus.gain.linearRampToValueAtTime(0, now + 0.018);
            for (const { oscillator } of chordVoices) {
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
        },
      );

      for (const { oscillator } of voices) {
        oscillator.onended = () => {
          ended++;
          if (ended !== voices.length) return;
          cleanup();
          if (run === this.serial && !this.disposed) {
            this.cancelSound = null;
            this.onState('idle');
          }
        };
      }
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
