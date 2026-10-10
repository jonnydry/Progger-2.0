import {
  CELLO_SAMPLES,
  type DroneModeId,
  type DroneOctave,
  type DronePitch,
  type DroneSoundId,
  dronePitches,
  midiHz,
  pitchWeight,
  sampleForMidi,
  scaleWalk,
  seamlessLoop,
  symmetricDetuneCents,
  trimEdgeSilence,
} from './drone.ts';

/**
 * The chord voicing player keeps its AudioContext private, so this lab cannot
 * share it. Exactly one context is created, on the first tap. Walk notes are
 * a separate pluck in this module: they share the master and limiter, and
 * they are the only signal that ducks the drone.
 */
export type DroneStatus = 'idle' | 'starting' | 'playing' | 'error';

export type DronePatch = {
  sound: DroneSoundId;
  root: string;
  modeId: DroneModeId;
  octave: DroneOctave;
  volume: number;
};

/**
 * Bow and cello scale at volume 1.
 * The reed uses REED_MAX_LINEAR_GAIN so one plucked note stays 1 dB under full scale.
 */
export const DRONE_MAX_LINEAR_GAIN = 0.3;

/** Reed scale at volume 1. Same cap as the shared engine. */
export const REED_MAX_LINEAR_GAIN = 0.15;

/** A few dB, recovered smoothly after each walk note. */
export const DRONE_DUCK_DB = 4;
export const DRONE_DUCK_GAIN = 10 ** (-DRONE_DUCK_DB / 20);

export const DRONE_LIMITER = {
  threshold: -1,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.08,
} as const;

const PLAY_ATTACK = 1.6;
const SWITCH_ATTACK = 0.2;
const STOP_FADE = 0.55;
const HIDE_FADE = 0.02;
const WALK_STEP_MS = 800;
const WALK_DELAY_MS = 1300;

type Scheduled = {
  start: (when?: number) => void;
  stop: (when?: number) => void;
};

export type DroneVoice = {
  nodeCount: number;
  stop: (when: number, fade: number) => void;
};

export type MasterBus = {
  duck: GainNode;
  master: GainNode;
  limiter: DynamicsCompressorNode;
  nodeCount: number;
};

type StatusHandler = (status: DroneStatus, message?: string) => void;
type WalkHandler = (index: number | null) => void;

type VisibilityTarget = {
  hidden: boolean;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type WindowTarget = {
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

type EngineOptions = {
  createContext?: () => AudioContext;
  fetchImpl?: typeof fetch;
  document?: VisibilityTarget | null;
  windowTarget?: WindowTarget | null;
};

const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

function linearCap(sound: DroneSoundId): number {
  return sound === 'reed' ? REED_MAX_LINEAR_GAIN : DRONE_MAX_LINEAR_GAIN;
}

export function createMasterBus(
  context: BaseAudioContext,
  volume: number,
  sound: DroneSoundId = 'bow',
): MasterBus {
  const duck = context.createGain();
  duck.gain.value = 1;
  const master = context.createGain();
  master.gain.value = clampVolume(volume) * linearCap(sound);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = DRONE_LIMITER.threshold;
  limiter.knee.value = DRONE_LIMITER.knee;
  limiter.ratio.value = DRONE_LIMITER.ratio;
  limiter.attack.value = DRONE_LIMITER.attack;
  limiter.release.value = DRONE_LIMITER.release;
  duck.connect(master);
  master.connect(limiter);
  return { duck, master, limiter, nodeCount: 3 };
}

export function loopSampleBuffer(
  context: BaseAudioContext,
  decoded: AudioBuffer,
): AudioBuffer {
  const mixed = mixdown(decoded);
  const trimmed = trimEdgeSilence(mixed);
  const fade = Math.min(
    Math.round(decoded.sampleRate * 0.06),
    Math.floor(trimmed.length / 4),
  );
  const looped = seamlessLoop(trimmed, Math.max(8, fade));
  const buffer = context.createBuffer(1, looped.length, decoded.sampleRate);
  buffer.getChannelData(0).set(looped);
  return buffer;
}

export function createDroneVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  patch: DronePatch,
  buffers: ReadonlyMap<string, AudioBuffer> | null,
  when: number,
  attack: number,
): DroneVoice {
  const nodes: AudioNode[] = [];
  const sources: Scheduled[] = [];
  const gain = () => {
    const node = context.createGain();
    nodes.push(node);
    return node;
  };
  const osc = () => {
    const node = context.createOscillator();
    nodes.push(node);
    sources.push(node);
    return node;
  };
  const filter = () => {
    const node = context.createBiquadFilter();
    nodes.push(node);
    return node;
  };
  const player = () => {
    const node = context.createBufferSource();
    nodes.push(node);
    sources.push(node);
    return node;
  };
  const convolver = () => {
    const node = context.createConvolver();
    nodes.push(node);
    return node;
  };
  const pitches = dronePitches(patch.root, patch.modeId, patch.octave);
  let envelope: GainNode;
  try {
  if (patch.sound === 'bow') {
    envelope = buildBow(context, destination, pitches, when, attack, {
      gain,
      osc,
      filter,
      player,
      convolver,
    });
  } else if (patch.sound === 'reed') {
    envelope = buildReed(context, destination, pitches, when, attack, {
      gain,
      osc,
      filter,
      player,
      convolver,
    });
  } else {
    envelope = buildCello(context, destination, pitches, when, attack, buffers, {
      gain,
      filter,
      player,
      convolver,
    });
  }
  } catch (error) {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // Not started yet.
      }
    }
    for (const node of nodes) {
      try {
        node.disconnect();
      } catch {
        // Not connected yet.
      }
    }
    throw error;
  }
  return {
    nodeCount: nodes.length,
    stop(stopAt: number, fade: number) {
      const release = Math.max(fade, 0.015);
      envelope.gain.cancelScheduledValues(stopAt);
      envelope.gain.setValueAtTime(Math.max(envelope.gain.value, 0.0001), stopAt);
      envelope.gain.linearRampToValueAtTime(0, stopAt + release);
      for (const source of sources) {
        try {
          source.stop(stopAt + release + 0.02);
        } catch {
          // A source that never started, or already stopped, can reject stop().
        }
      }
      const leftover = nodes;
      setTimeout(() => {
        for (const node of leftover) {
          try {
            node.disconnect();
          } catch {
            // Already disconnected.
          }
        }
      }, (release + 0.05) * 1000);
    },
  };
}

type BowKit = {
  gain: () => GainNode;
  osc: () => OscillatorNode;
  filter: () => BiquadFilterNode;
  player: () => AudioBufferSourceNode;
  convolver: () => ConvolverNode;
};

function buildBow(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: BowKit,
): GainNode {
  const cents = symmetricDetuneCents('bow');
  const waves = ['sawtooth', 'triangle', 'triangle', 'sawtooth'] as const;
  const voiceOscs: OscillatorNode[] = [];
  const mixer = kit.gain();
  mixer.gain.value = 1;
  for (const pitch of pitches) {
    const pitchGain = kit.gain();
    pitchGain.gain.value = pitchWeight(pitch.role, pitch.layer) * 0.055;
    cents.forEach((detune, index) => {
      const voice = kit.osc();
      voice.type = waves[index];
      voice.frequency.value = midiHz(pitch.midi);
      voice.detune.value = detune;
      voice.connect(pitchGain);
      voiceOscs.push(voice);
    });
    pitchGain.connect(mixer);
  }

  const lowpass = kit.filter();
  lowpass.type = 'lowpass';
  lowpass.Q.value = 0.65;
  const opened = attack > 0.8;
  lowpass.frequency.setValueAtTime(opened ? 240 : 880, when);
  lowpass.frequency.exponentialRampToValueAtTime(1480, when + (opened ? 3.4 : 1.1));
  mixer.connect(lowpass);

  const filterLfo = kit.osc();
  filterLfo.type = 'sine';
  filterLfo.frequency.value = 0.11;
  const filterDepth = kit.gain();
  filterDepth.gain.value = 150;
  filterLfo.connect(filterDepth);
  filterDepth.connect(lowpass.frequency);

  const vibrato = kit.osc();
  vibrato.type = 'sine';
  vibrato.frequency.value = 4.7;
  const vibratoDepth = kit.gain();
  vibratoDepth.gain.setValueAtTime(0, when);
  vibratoDepth.gain.linearRampToValueAtTime(5.5, when + 2.1);
  vibrato.connect(vibratoDepth);
  for (const voice of voiceOscs) vibratoDepth.connect(voice.detune);

  const noise = kit.player();
  noise.buffer = bowNoise(context);
  noise.loop = true;
  const noiseFilter = kit.filter();
  noiseFilter.type = 'bandpass';
  noiseFilter.frequency.value = 1700;
  noiseFilter.Q.value = 0.55;
  const noiseGain = kit.gain();
  noiseGain.gain.value = 0.009;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);

  const envelope = kit.gain();
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(1, when + attack);
  lowpass.connect(envelope);
  noiseGain.connect(envelope);
  connectRoom(context, kit, envelope, destination, 0.22, 0.8);

  for (const voice of voiceOscs) voice.start(when);
  filterLfo.start(when);
  vibrato.start(when + 1.15);
  noise.start(when);
  return envelope;
}

function buildReed(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: BowKit,
): GainNode {
  const cents = symmetricDetuneCents('reed');
  const mixer = kit.gain();
  mixer.gain.value = 1;
  for (const pitch of pitches) {
    const frequency = midiHz(pitch.midi);
    const wave = reedWave(context, frequency);
    const pitchGain = kit.gain();
    pitchGain.gain.value = pitchWeight(pitch.role, pitch.layer) * 0.1;
    for (const detune of cents) {
      const voice = kit.osc();
      voice.setPeriodicWave(wave);
      voice.frequency.value = frequency;
      voice.detune.value = detune;
      voice.connect(pitchGain);
      voice.start(when);
    }
    pitchGain.connect(mixer);
  }

  const body = kit.filter();
  body.type = 'lowpass';
  body.frequency.value = 740;
  body.Q.value = 0.45;
  const bodyGain = kit.gain();
  bodyGain.gain.value = 0.8;
  mixer.connect(body);
  body.connect(bodyGain);

  const formants = [
    { frequency: 620, q: 6.2, amount: 0.72 },
    { frequency: 1280, q: 5.4, amount: 0.48 },
    { frequency: 2140, q: 4.4, amount: 0.3 },
  ];
  const formantBus = kit.gain();
  formantBus.gain.value = 0.62;
  for (const formant of formants) {
    const band = kit.filter();
    band.type = 'bandpass';
    band.frequency.value = formant.frequency;
    band.Q.value = formant.q;
    const amount = kit.gain();
    amount.gain.value = formant.amount;
    mixer.connect(band);
    band.connect(amount);
    amount.connect(formantBus);
  }

  const sum = kit.gain();
  sum.gain.value = 1;
  bodyGain.connect(sum);
  formantBus.connect(sum);

  const noise = kit.player();
  noise.buffer = bowNoise(context);
  noise.loop = true;
  const noiseFilter = kit.filter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1800;
  noiseFilter.Q.value = 0.5;
  const noiseGain = kit.gain();
  noiseGain.gain.value = 0.012;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(sum);
  noise.start(when);

  const envelope = kit.gain();
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(0.9, when + attack);
  sum.connect(envelope);

  const bellows = kit.osc();
  bellows.type = 'sine';
  bellows.frequency.value = 0.16;
  const depth = kit.gain();
  depth.gain.setValueAtTime(0, when);
  depth.gain.linearRampToValueAtTime(0.055, when + attack + 0.15);
  bellows.connect(depth);
  depth.connect(envelope.gain);
  bellows.start(when);

  connectRoom(context, kit, envelope, destination, 0.16, 0.86);
  return envelope;
}

function buildCello(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  buffers: ReadonlyMap<string, AudioBuffer> | null,
  kit: {
    gain: () => GainNode;
    filter: () => BiquadFilterNode;
    player: () => AudioBufferSourceNode;
    convolver: () => ConvolverNode;
  },
): GainNode {
  if (!buffers) throw new Error('Cello samples are not loaded.');
  const mixer = kit.gain();
  mixer.gain.value = 1;
  for (const pitch of pitches) {
    const choice = sampleForMidi(pitch.midi);
    const buffer = buffers.get(choice.file);
    if (!buffer) throw new Error(`Missing cello sample ${choice.file}.`);
    const source = kit.player();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = choice.playbackRate;
    const gain = kit.gain();
    gain.gain.value = pitchWeight(pitch.role, pitch.layer) * 0.62;
    source.connect(gain);
    gain.connect(mixer);
    source.start(when);
  }
  const lowpass = kit.filter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4200;
  lowpass.Q.value = 0.4;
  const envelope = kit.gain();
  envelope.gain.setValueAtTime(0.0001, when);
  envelope.gain.exponentialRampToValueAtTime(0.85, when + attack);
  mixer.connect(lowpass);
  lowpass.connect(envelope);
  connectRoom(context, kit, envelope, destination, 0.12, 0.9);
  return envelope;
}

function connectRoom(
  context: BaseAudioContext,
  kit: { gain: () => GainNode; convolver: () => ConvolverNode },
  source: AudioNode,
  destination: AudioNode,
  wetAmount: number,
  dryAmount: number,
) {
  const dry = kit.gain();
  dry.gain.value = dryAmount;
  const wet = kit.gain();
  wet.gain.value = wetAmount;
  const convolver = kit.convolver();
  convolver.normalize = false;
  convolver.buffer = roomImpulse(context);
  source.connect(dry);
  dry.connect(destination);
  source.connect(convolver);
  convolver.connect(wet);
  wet.connect(destination);
}

function roomImpulse(context: BaseAudioContext): AudioBuffer {
  const cached = impulses.get(context);
  if (cached) return cached;
  const seconds = 0.8;
  const length = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buffer = context.createBuffer(2, length, context.sampleRate);
  const random = noiseSource(0x51eed);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const t = i / length;
      const early =
        i === Math.floor(0.011 * context.sampleRate) ||
        i === Math.floor(0.019 * context.sampleRate)
          ? 0.35
          : 0;
      data[i] = ((random() * 2 - 1) * (1 - t) ** 2.8 + early) * 0.28;
    }
  }
  impulses.set(context, buffer);
  return buffer;
}

/** Fixed sequence so a render's peak does not depend on when the page opened. */
function noiseSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function bowNoise(context: BaseAudioContext): AudioBuffer {
  const cached = noises.get(context);
  if (cached) return cached;
  const length = Math.max(1, Math.floor(context.sampleRate));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  const noise = noiseSource(0xb04);
  for (let i = 0; i < length; i += 1) data[i] = noise() * 2 - 1;
  noises.set(context, buffer);
  return buffer;
}

function reedWave(context: BaseAudioContext, frequency: number): PeriodicWave {
  const real = new Float32Array(24);
  const imaginary = new Float32Array(24);
  for (let harmonic = 1; harmonic < imaginary.length; harmonic += 1) {
    if (frequency * harmonic >= context.sampleRate / 2) break;
    const odd = harmonic % 2 === 1;
    imaginary[harmonic] = (odd ? 0.85 : 0.18) / harmonic ** 1.08;
  }
  return context.createPeriodicWave(real, imaginary);
}

/** Same partial recipe as the voicing audition, copied so that file stays untouched. */
function pluckWave(context: BaseAudioContext, frequency: number): PeriodicWave {
  const real = new Float32Array(25);
  const imaginary = new Float32Array(25);
  for (let harmonic = 1; harmonic < imaginary.length; harmonic += 1) {
    if (frequency * harmonic < context.sampleRate / 2) {
      imaginary[harmonic] = Math.sin(harmonic * Math.PI * 0.23) / harmonic ** 1.35;
    }
  }
  return context.createPeriodicWave(real, imaginary);
}

function mixdown(buffer: AudioBuffer): Float32Array {
  const mixed = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mixed[i] += data[i] / channels;
  }
  return mixed;
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

export class DroneEngine {
  private context: AudioContext | null = null;
  private duck: GainNode | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private busNodeCount = 0;
  private voices: DroneVoice[] = [];
  private voiceNodes = 0;
  private plucks: OscillatorNode[] = [];
  private celloBytes = new Map<string, ArrayBuffer>();
  private celloBuffers = new Map<string, AudioBuffer>();
  private celloLoad: Promise<void> | null = null;
  private generation = 0;
  private phase: DroneStatus = 'idle';
  private walking = false;
  private walkGeneration = 0;
  private walkTimer: ReturnType<typeof setTimeout> | undefined;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelResume: (() => void) | null = null;
  private disposed = false;
  private volume = 0.85;
  private sound: DroneSoundId = 'bow';
  private readonly onStatus: StatusHandler;
  private readonly onWalk: WalkHandler;
  private readonly createContext: () => AudioContext;
  private readonly fetchImpl: typeof fetch;
  private readonly documentTarget: VisibilityTarget | null;
  private readonly windowTarget: WindowTarget | null;
  private readonly onVisibility: () => void;
  private readonly onPageHide: () => void;

  constructor(onStatus: StatusHandler, onWalk: WalkHandler = () => {}, options: EngineOptions = {}) {
    this.onStatus = onStatus;
    this.onWalk = onWalk;
    this.createContext = options.createContext ?? (() => new AudioContext());
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.documentTarget =
      options.document === undefined
        ? typeof document === 'undefined'
          ? null
          : document
        : options.document;
    this.windowTarget =
      options.windowTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.windowTarget;
    this.onVisibility = () => {
      if (this.documentTarget?.hidden) this.stop(HIDE_FADE);
    };
    this.onPageHide = () => this.stop(HIDE_FADE);
    this.documentTarget?.addEventListener('visibilitychange', this.onVisibility);
    this.windowTarget?.addEventListener('pagehide', this.onPageHide);
  }

  nodeCount(): number {
    return this.voiceNodes + this.busNodeCount;
  }

  /** Network fetch only. Decode waits until a context exists, which is a tap. */
  loadCello(): Promise<void> {
    this.celloLoad ??= this.fetchCello().catch((error: unknown) => {
      this.celloLoad = null;
      throw error;
    });
    return this.celloLoad;
  }

  play(patch: DronePatch): void {
    this.volume = clampVolume(patch.volume);
    this.sound = patch.sound;
    void this.start(patch, PLAY_ATTACK);
  }

  update(patch: DronePatch): void {
    this.volume = clampVolume(patch.volume);
    this.sound = patch.sound;
    this.applyVolume();
    this.cancelWalk();
    if (this.phase === 'idle' || this.phase === 'error') return;
    void this.start(patch, SWITCH_ATTACK);
  }

  walk(patch: DronePatch): void {
    if (this.walking) {
      this.cancelWalk();
      return;
    }
    this.walking = true;
    this.volume = clampVolume(patch.volume);
    this.sound = patch.sound;
    const begin = () => {
      if (!this.walking || this.phase !== 'playing') {
        this.walking = false;
        return;
      }
      this.runWalk(patch, 0);
    };
    if (this.phase === 'playing') begin();
    else {
      this.play(patch);
      this.walkTimer = setTimeout(begin, WALK_DELAY_MS);
    }
  }

  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    this.applyVolume();
  }

  stop(fade = STOP_FADE): void {
    if (this.disposed) return;
    this.generation += 1;
    this.cancelWalk();
    this.cancelResume?.();
    this.cancelResume = null;
    clearTimeout(this.resumeTimer);
    if (this.context && this.voices.length) this.fadeVoices(this.context.currentTime, fade);
    else this.voices = [];
    this.stopPlucks();
    this.voiceNodes = 0;
    this.phase = 'idle';
    this.onStatus('idle');
  }

  dispose(): void {
    this.disposed = true;
    this.generation += 1;
    this.cancelWalk();
    this.cancelResume?.();
    clearTimeout(this.resumeTimer);
    this.documentTarget?.removeEventListener('visibilitychange', this.onVisibility);
    this.windowTarget?.removeEventListener('pagehide', this.onPageHide);
    if (this.context) {
      this.context.onstatechange = null;
      this.fadeVoices(this.context.currentTime, HIDE_FADE);
      this.stopPlucks();
      void this.context.close().catch(() => {});
      this.context = null;
    }
  }

  private async start(patch: DronePatch, attack: number): Promise<void> {
    if (this.disposed) return;
    const generation = (this.generation += 1);
    this.phase = 'starting';
    this.onStatus('starting');
    try {
      const context = this.unlock();
      await this.waitUntilRunning(context, generation);
      if (generation !== this.generation || this.disposed) return;
      if (patch.sound === 'cello') {
        this.onStatus('starting', 'Loading cello…');
        await this.decodeCello(context);
        if (generation !== this.generation || this.disposed) return;
      }
      const when = context.currentTime + 0.02;
      this.fadeVoices(when, attack > 0.5 ? 0.04 : 0.16);
      const voice = createDroneVoice(
        context,
        this.duck!,
        { ...patch, volume: this.volume },
        patch.sound === 'cello' ? this.celloBuffers : null,
        when,
        attack,
      );
      this.voices = [voice];
      this.voiceNodes = voice.nodeCount;
      this.phase = 'playing';
      this.onStatus('playing');
    } catch {
      if (generation !== this.generation || this.disposed) return;
      if (this.context) this.fadeVoices(this.context.currentTime, HIDE_FADE);
      this.phase = 'error';
      this.onStatus('error', 'Audio didn’t start. Tap play to try again.');
    }
  }

  private unlock(): AudioContext {
    if (!this.context) {
      const context = this.createContext();
      this.context = context;
      const bus = createMasterBus(context, this.volume, this.sound);
      this.duck = bus.duck;
      this.master = bus.master;
      this.limiter = bus.limiter;
      this.busNodeCount = bus.nodeCount;
      bus.limiter.connect(context.destination);
      context.onstatechange = () => {
        if (this.phase !== 'playing') return;
        // iOS uses "interrupted" for calls and the lock screen. Any non-running
        // state stops the sounding graph; the next tap calls resume().
        const state = context.state as string;
        if (state === 'running' || state === 'closed') return;
        this.stop(HIDE_FADE);
      };
    } else this.applyVolume();
    // Resume in the tap turn for iOS. waitUntilRunning observes the same call's
    // failure; this extra invocation must not surface as an unhandled rejection.
    void this.context.resume().catch(() => {});
    return this.context;
  }

  private waitUntilRunning(context: AudioContext, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const resume = context.resume();
      const timeout = new Promise<void>((_, rejectTimeout) => {
        this.resumeTimer = setTimeout(
          () => rejectTimeout(new Error('Audio did not start.')),
          2000,
        );
      });
      const cancelled = new Promise<void>((resolveCancel) => {
        this.cancelResume = resolveCancel;
      });
      void Promise.race([resume, timeout, cancelled])
        .then(() => {
          clearTimeout(this.resumeTimer);
          this.cancelResume = null;
          if (generation !== this.generation || this.disposed) {
            resolve();
            return;
          }
          if (context.state !== 'running') {
            reject(new Error('Audio is unavailable.'));
            return;
          }
          resolve();
        })
        .catch((error: unknown) => {
          clearTimeout(this.resumeTimer);
          this.cancelResume = null;
          if (generation !== this.generation || this.disposed) resolve();
          else reject(error);
        });
    });
  }

  private async fetchCello(): Promise<void> {
    await Promise.all(
      CELLO_SAMPLES.map(async (sample) => {
        const response = await this.fetchImpl(sample.href);
        if (!response.ok) throw new Error(`Cello sample failed (${response.status}).`);
        this.celloBytes.set(sample.file, await response.arrayBuffer());
      }),
    );
  }

  private async decodeCello(context: BaseAudioContext): Promise<void> {
    await this.loadCello();
    for (const sample of CELLO_SAMPLES) {
      if (this.celloBuffers.has(sample.file)) continue;
      const bytes = this.celloBytes.get(sample.file);
      if (!bytes) throw new Error(`Missing cello sample ${sample.file}.`);
      const decoded = await context.decodeAudioData(bytes.slice(0));
      this.celloBuffers.set(sample.file, loopSampleBuffer(context, decoded));
    }
  }

  private applyVolume(): void {
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    const next = this.volume * linearCap(this.sound);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(next, now + 0.03);
  }

  private fadeVoices(when: number, fade: number): void {
    for (const voice of this.voices) voice.stop(when, fade);
    this.voices = [];
  }

  private cancelWalk(): void {
    this.walking = false;
    this.walkGeneration += 1;
    clearTimeout(this.walkTimer);
    this.onWalk(null);
  }

  private runWalk(patch: DronePatch, delay: number): void {
    const generation = (this.walkGeneration += 1);
    const notes = scaleWalk(patch.root, patch.modeId);
    let index = 0;
    const tick = () => {
      if (!this.walking || generation !== this.walkGeneration || this.phase !== 'playing' || !this.context) {
        return;
      }
      this.onWalk(index);
      this.duckNow();
      this.pluck(notes[index].midi);
      index += 1;
      if (index < notes.length) this.walkTimer = setTimeout(tick, WALK_STEP_MS);
      else {
        this.walkTimer = setTimeout(() => {
          if (generation === this.walkGeneration) {
            this.walking = false;
            this.onWalk(null);
          }
        }, WALK_STEP_MS);
      }
    };
    this.walkTimer = setTimeout(tick, delay);
  }

  private duckNow(): void {
    if (!this.duck || !this.context) return;
    const now = this.context.currentTime;
    const gain = this.duck.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(DRONE_DUCK_GAIN, now + 0.07);
    gain.linearRampToValueAtTime(1, now + 0.69);
  }

  private pluck(midi: number): void {
    if (!this.context || !this.master) return;
    const context = this.context;
    const now = context.currentTime + 0.02;
    const oscillator = context.createOscillator();
    const frequency = midiHz(midi);
    oscillator.setPeriodicWave(pluckWave(context, frequency));
    oscillator.frequency.value = frequency;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.45;
    filter.frequency.setValueAtTime(Math.min(5500, frequency * 12), now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(600, frequency * 2), now + 1.3);
    const envelope = context.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.linearRampToValueAtTime(0.85, now + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.12, now + 0.65);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
    envelope.gain.linearRampToValueAtTime(0, now + 2.52);
    const trim = context.createGain();
    trim.gain.value = 0.42;
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(trim);
    trim.connect(this.master);
    const nodes = [oscillator, filter, envelope, trim];
    oscillator.onended = () => {
      for (const node of nodes) node.disconnect();
    };
    oscillator.start(now);
    oscillator.stop(now + 2.55);
    this.plucks.push(oscillator);
  }

  private stopPlucks(): void {
    for (const oscillator of this.plucks) {
      try {
        oscillator.stop();
      } catch {
        // Already stopped.
      }
    }
    this.plucks = [];
  }
}
