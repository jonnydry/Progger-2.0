import {
  type DroneLayer,
  type DroneModeId,
  type DroneOctave,
  type DronePitch,
  type DroneRole,
  dronePitches,
  midiHz,
} from './drone.ts';

export type DroneStatus = 'idle' | 'starting' | 'playing' | 'error';

export type ReedRequest = {
  root: string;
  modeId: DroneModeId;
  octave: DroneOctave;
};

export const DRONE_MAX_LINEAR_GAIN = 0.3;

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
const PLAY_FADE = 0.04;
const SWITCH_FADE = 0.16;
const REED_CENTS = [-3.5, 3.5] as const;

const impulses = new WeakMap<BaseAudioContext, AudioBuffer>();
const noises = new WeakMap<BaseAudioContext, AudioBuffer>();

type Scheduled = {
  start: (when?: number) => void;
  stop: (when?: number) => void;
};

type ReedVoice = {
  nodeCount: number;
  stop: (when: number, fade: number) => void;
};

type VoiceKit = {
  gain: () => GainNode;
  osc: () => OscillatorNode;
  filter: () => BiquadFilterNode;
  player: () => AudioBufferSourceNode;
  convolver: () => ConvolverNode;
};

type VisibilityTarget = {
  hidden: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type WindowTarget = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type ReedOptions = {
  createContext?: () => AudioContext;
  document?: VisibilityTarget | null;
  windowTarget?: WindowTarget | null;
};

function pitchWeight(role: DroneRole, layer: DroneLayer): number {
  return (role === 'root' ? 1 : 0.7) * (layer === 'upper' ? 0.58 : 1);
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

function createReedVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
): ReedVoice {
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
  const kit: VoiceKit = { gain, osc, filter, player, convolver };
  let envelope: GainNode;
  try {
    envelope = buildReed(context, destination, pitches, when, attack, kit);
  } catch (error) {
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        // Not started yet.
      }
    }
    for (const node of nodes) node.disconnect();
    throw error;
  }
  return {
    nodeCount: nodes.length,
    stop(stopAt: number, fade: number) {
      const release = Math.max(fade, 0.015);
      envelope.gain.cancelScheduledValues(stopAt);
      envelope.gain.setValueAtTime(Math.max(envelope.gain.value, 0.0001), stopAt);
      envelope.gain.linearRampToValueAtTime(0, stopAt + release);
      for (const source of sources) source.stop(stopAt + release + 0.02);
      const leftover = nodes;
      setTimeout(() => {
        for (const node of leftover) node.disconnect();
      }, (release + 0.05) * 1000);
    },
  };
}

function buildReed(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: VoiceKit,
): GainNode {
  const mixer = kit.gain();
  mixer.gain.value = 1;
  for (const pitch of pitches) {
    const frequency = midiHz(pitch.midi);
    const wave = reedWave(context, frequency);
    const pitchGain = kit.gain();
    pitchGain.gain.value = pitchWeight(pitch.role, pitch.layer) * 0.1;
    for (const detune of REED_CENTS) {
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
  noise.buffer = noiseBuffer(context);
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

function noiseSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseBuffer(context: BaseAudioContext): AudioBuffer {
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

const AUDIO_ERROR = 'Audio didn\u2019t start. Tap play to try again.';

export class ReedDrone {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private voices: ReedVoice[] = [];
  private voiceNodes = 0;
  private generation = 0;
  private phase: DroneStatus = 'idle';
  private disposed = false;
  private volume = 1;
  private current: ReedRequest | null = null;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelResume: (() => void) | null = null;
  private readonly onStatus: (status: DroneStatus, message?: string) => void;
  private readonly createContext: () => AudioContext;
  private readonly documentTarget: VisibilityTarget | null;
  private readonly windowTarget: WindowTarget | null;
  private readonly onVisibility = () => {
    if (this.documentTarget?.hidden) this.halt(HIDE_FADE);
  };
  private readonly onPageHide = () => {
    this.halt(HIDE_FADE);
  };

  constructor(
    onStatus: (status: DroneStatus, message?: string) => void,
    options: ReedOptions = {},
  ) {
    this.onStatus = onStatus;
    this.createContext = options.createContext ?? (() => new AudioContext());
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
    this.documentTarget?.addEventListener('visibilitychange', this.onVisibility);
    this.windowTarget?.addEventListener('pagehide', this.onPageHide);
  }

  nodeCount(): number {
    return this.voiceNodes + (this.master ? 2 : 0);
  }

  play(request: ReedRequest): void {
    if (this.disposed) return;
    const pitches = dronePitches(request.root, request.modeId, request.octave);
    void this.start(request, pitches, PLAY_ATTACK, PLAY_FADE);
  }

  retune(request: ReedRequest): void {
    if (this.disposed) return;
    const pitches = dronePitches(request.root, request.modeId, request.octave);
    if (this.phase === 'idle' || this.phase === 'error') return;
    if (
      this.current &&
      this.current.root === request.root &&
      this.current.modeId === request.modeId &&
      this.current.octave === request.octave
    ) {
      return;
    }
    void this.start(request, pitches, SWITCH_ATTACK, SWITCH_FADE);
  }

  setVolume(volume: number): void {
    if (this.disposed) return;
    this.volume = clampVolume(volume);
    this.applyVolume();
  }

  stop(): void {
    this.halt(STOP_FADE);
  }

  private halt(fade: number): void {
    if (this.disposed) return;
    this.generation += 1;
    this.cancelResume?.();
    this.cancelResume = null;
    clearTimeout(this.resumeTimer);
    if (this.context && this.voices.length) this.fadeVoices(this.context.currentTime, fade);
    else this.voices = [];
    this.voiceNodes = 0;
    this.phase = 'idle';
    this.onStatus('idle');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.cancelResume?.();
    this.cancelResume = null;
    clearTimeout(this.resumeTimer);
    this.documentTarget?.removeEventListener('visibilitychange', this.onVisibility);
    this.windowTarget?.removeEventListener('pagehide', this.onPageHide);
    if (this.context) {
      this.context.onstatechange = null;
      this.fadeVoices(this.context.currentTime, HIDE_FADE);
      void this.context.close().catch(() => {});
      this.context = null;
    }
    this.master = null;
    this.voices = [];
    this.voiceNodes = 0;
  }

  private async start(
    request: ReedRequest,
    pitches: readonly DronePitch[],
    attack: number,
    fade: number,
  ): Promise<void> {
    if (this.disposed) return;
    const generation = ++this.generation;
    this.phase = 'starting';
    this.current = {
      root: request.root,
      modeId: request.modeId,
      octave: request.octave,
    };
    this.onStatus('starting');
    try {
      const opened = this.unlock();
      await this.waitUntilRunning(opened.context, generation);
      if (generation !== this.generation || this.disposed) return;
      if (opened.context.state !== 'running') throw new Error('Audio is unavailable.');
      const when = opened.context.currentTime + 0.02;
      this.fadeVoices(when, fade);
      const voice = createReedVoice(opened.context, opened.master, pitches, when, attack);
      this.voices = [voice];
      this.voiceNodes = voice.nodeCount;
      this.phase = 'playing';
      this.onStatus('playing');
    } catch {
      if (generation !== this.generation || this.disposed) return;
      if (this.context) {
        this.fadeVoices(this.context.currentTime, HIDE_FADE);
        this.voiceNodes = 0;
      }
      this.phase = 'error';
      this.onStatus('error', AUDIO_ERROR);
    }
  }

  private unlock(): { context: AudioContext; master: GainNode } {
    if (this.context && this.master) {
      this.applyVolume();
      void this.context.resume().catch(() => {});
      return { context: this.context, master: this.master };
    }
    const context = this.createContext();
    const master = context.createGain();
    master.gain.value = this.volume * DRONE_MAX_LINEAR_GAIN;
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = DRONE_LIMITER.threshold;
    limiter.knee.value = DRONE_LIMITER.knee;
    limiter.ratio.value = DRONE_LIMITER.ratio;
    limiter.attack.value = DRONE_LIMITER.attack;
    limiter.release.value = DRONE_LIMITER.release;
    master.connect(limiter);
    limiter.connect(context.destination);
    context.onstatechange = () => {
      if (this.phase !== 'playing') return;
      if (context.state === 'running' || context.state === 'closed') return;
      this.halt(HIDE_FADE);
    };
    this.context = context;
    this.master = master;
    void context.resume().catch(() => {});
    return { context, master };
  }

  private waitUntilRunning(context: AudioContext, generation: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const resume = context.resume();
      let rejectTimeout: (error: Error) => void = () => {};
      const timeout = new Promise<never>((_, rejectRace) => {
        rejectTimeout = rejectRace;
      });
      const timer = setTimeout(() => rejectTimeout(new Error('Audio did not start.')), 2000);
      this.resumeTimer = timer;
      let cancel = () => {};
      const cancelled = new Promise<void>((resolveCancel) => {
        cancel = resolveCancel;
        this.cancelResume = cancel;
      });
      void Promise.race([resume, timeout, cancelled])
        .then(() => {
          clearTimeout(timer);
          if (this.cancelResume === cancel) this.cancelResume = null;
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
          clearTimeout(timer);
          if (this.cancelResume === cancel) this.cancelResume = null;
          if (generation !== this.generation || this.disposed) resolve();
          else reject(error);
        });
    });
  }

  private applyVolume(): void {
    if (!this.master || !this.context) return;
    const now = this.context.currentTime;
    const next = this.volume * DRONE_MAX_LINEAR_GAIN;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(next, now + 0.03);
  }

  private fadeVoices(when: number, fade: number): void {
    for (const voice of this.voices) voice.stop(when, fade);
    this.voices = [];
  }
}
