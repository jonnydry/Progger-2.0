import {
  CELLO_SAMPLES,
  type DroneLayer,
  type DroneModeId,
  type DroneOctave,
  type DronePitch,
  type DroneRole,
  type DroneSoundId,
  dronePitches,
  midiHz,
  sampleForMidi,
  scaleWalk,
  seamlessLoop,
  symmetricDetuneCents,
  trimEdgeSilence,
} from './drone.ts';

export type DroneStatus = 'idle' | 'starting' | 'playing' | 'error';

export type ReedRequest = {
  root: string;
  modeId: DroneModeId;
  octave: DroneOctave;
  scaleId?: string;
  sound?: DroneSoundId;
};

export function requestSound(request: ReedRequest): DroneSoundId {
  return request.sound ?? 'reed';
}

/** Volume 1 stays at least 1 dB under full scale when added to one plucked note. */
export const DRONE_MAX_LINEAR_GAIN = 0.15;

export const DRONE_LIMITER = {
  threshold: -1,
  knee: 0,
  ratio: 20,
  attack: 0.003,
  release: 0.08,
} as const;

/** Gains the reed graph and the headroom calculation both read. */
export const REED_GAINS = {
  pitch: 0.1,
  other: 0.7,
  upper: 0.58,
  body: 0.8,
  formantBus: 0.62,
  formants: [0.72, 0.48, 0.3],
  noise: 0.012,
  envelope: 0.9,
  bellows: 0.055,
  dry: 0.86,
  wet: 0.16,
  impulse: 0.28,
  early: 0.35,
  silence: 0.0001,
  oddPartial: 0.85,
  evenPartial: 0.18,
  partialSlope: 1.08,
  partials: 24,
} as const;

export const REED_TIMING = {
  playAttack: 1.6,
  switchAttack: 0.2,
  stopFade: 0.55,
  hideFade: 0.02,
  playFade: 0.04,
  switchFade: 0.16,
  bellowsRise: 0.15,
  stopTail: 0.02,
} as const;

/**
 * Bow and cello caps are set from a Chrome limiter render, not the
 * analytical sum. Makeup gain lifts a full voice. The loud bow is two
 * key changes on E♭ locrian, layered, 0.254s apart, while the detuned saws
 * are still in phase. The fade starts 20ms before the new voice. Caps keep
 * that peak, plus the loudest pluck, at or under -1 dBFS.
 */
export const BOW_GAINS = {
  pitch: 0.055,
  noise: 0.009,
  envelope: 1,
  dry: 0.8,
  wet: 0.22,
  cap: 0.168,
  voices: 4,
} as const;

export const CELLO_GAINS = {
  pitch: 0.62,
  envelope: 0.85,
  dry: 0.9,
  wet: 0.12,
  samplePeak: 0.5,
  cap: 0.202,
} as const;

export const WALK_GAINS = {
  attack: 0.85,
  body: 0.12,
  decay: 0.0001,
  trim: 0.2,
  partials: 25,
} as const;

export const WALK_STEP_MS = 800;

/** The pluck envelope at `time`, from the breakpoints scheduled in `pluck`. */
export function walkPluckLevel(start: number, time: number): number {
  const attackEnd = start + 0.006;
  const bodyEnd = start + 0.65;
  const tailEnd = start + 2.5;
  const zeroEnd = start + 2.52;
  if (time <= start) return WALK_GAINS.decay;
  if (time < attackEnd) {
    const progress = (time - start) / 0.006;
    return WALK_GAINS.decay + (WALK_GAINS.attack - WALK_GAINS.decay) * progress;
  }
  if (time < bodyEnd) {
    return exponentialRampValue(
      {
        start: WALK_GAINS.attack,
        target: WALK_GAINS.body,
        startTime: attackEnd,
        endTime: bodyEnd,
      },
      time,
    );
  }
  if (time < tailEnd) {
    return exponentialRampValue(
      {
        start: WALK_GAINS.body,
        target: WALK_GAINS.decay,
        startTime: bodyEnd,
        endTime: tailEnd,
      },
      time,
    );
  }
  if (time < zeroEnd) {
    const progress = (time - tailEnd) / (zeroEnd - tailEnd);
    return WALK_GAINS.decay * (1 - progress);
  }
  return 0;
}

export function soundLinearCap(sound: DroneSoundId): number {
  if (sound === 'bow') return BOW_GAINS.cap;
  if (sound === 'cello') return CELLO_GAINS.cap;
  return DRONE_MAX_LINEAR_GAIN;
}

/** The exponential envelope scheduled in buildReed. Stop reads this instead of gain.value. */
export type GainRamp = {
  start: number;
  target: number;
  startTime: number;
  endTime: number;
};

type GainAutomation = {
  value: number;
  cancelScheduledValues: (cancelTime: number) => unknown;
  setValueAtTime: (value: number, startTime: number) => unknown;
  linearRampToValueAtTime: (value: number, endTime: number) => unknown;
};

/**
 * Intrinsic envelope at `time`.
 * During the swell this is the exponential curve.
 * Once the swell has finished it is the ramp target, the steady level.
 * The curve is not extrapolated past `endTime`.
 */
export function exponentialRampValue(ramp: GainRamp, time: number): number {
  if (ramp.endTime <= ramp.startTime || time <= ramp.startTime)
    return ramp.start;
  if (time >= ramp.endTime) return ramp.target;
  if (!(ramp.start > 0) || !(ramp.target > 0)) return ramp.target;
  const progress = (time - ramp.startTime) / (ramp.endTime - ramp.startTime);
  return ramp.start * (ramp.target / ramp.start) ** progress;
}

type FadeRamp = {
  from: number;
  to: number;
  startTime: number;
  endTime: number;
};

/** The fade gain's own ramp. gain.value stays stale, so a second stop reads this. */
function fadeLevel(ramp: FadeRamp | null, time: number): number {
  if (!ramp) return 1;
  if (!(ramp.endTime > ramp.startTime) || time <= ramp.startTime)
    return ramp.from;
  if (time >= ramp.endTime) return ramp.to;
  const progress = (time - ramp.startTime) / (ramp.endTime - ramp.startTime);
  return ramp.from + (ramp.to - ramp.from) * progress;
}

/**
 * Silence one voice by ramping its fade gain.
 * The swell envelope, including the bellows on that gain, is not touched.
 */
export function scheduleFade(
  param: GainAutomation,
  time: number,
  end: number,
  level: number,
): void {
  param.setValueAtTime(level, time);
  param.linearRampToValueAtTime(0, end);
}

/** A new voice starts at silence, then swells. The intrinsic gain is 1. */
export function scheduleSwell(
  param: GainAutomation & {
    exponentialRampToValueAtTime: (value: number, endTime: number) => unknown;
  },
  when: number,
  attack: number,
  target: number = REED_GAINS.envelope,
): GainRamp {
  const ramp: GainRamp = {
    start: REED_GAINS.silence,
    target,
    startTime: when,
    endTime: when + attack,
  };
  param.value = ramp.start;
  param.setValueAtTime(ramp.start, ramp.startTime);
  param.exponentialRampToValueAtTime(ramp.target, ramp.endTime);
  return ramp;
}

const REED_CENTS = [-3.5, 3.5] as const;

export function clampDroneVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}

export function droneMasterGain(
  volume: number,
  sound: DroneSoundId = 'reed',
): number {
  return clampDroneVolume(volume) * soundLinearCap(sound);
}

export function walkHarmonicAmplitudeSum(
  frequency: number,
  sampleRate: number,
): number {
  let sum = 0;
  for (let harmonic = 1; harmonic < WALK_GAINS.partials; harmonic += 1) {
    if (frequency * harmonic >= sampleRate / 2) break;
    sum += Math.abs(Math.sin(harmonic * Math.PI * 0.23) / harmonic ** 1.35);
  }
  return sum;
}

export function reedHarmonicAmplitudeSum(
  frequency: number,
  sampleRate: number,
): number {
  let sum = 0;
  for (let harmonic = 1; harmonic < REED_GAINS.partials; harmonic += 1) {
    if (frequency * harmonic >= sampleRate / 2) break;
    const coefficient =
      harmonic % 2 === 1 ? REED_GAINS.oddPartial : REED_GAINS.evenPartial;
    sum += coefficient / harmonic ** REED_GAINS.partialSlope;
  }
  return sum;
}

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
  fetchImpl?: typeof fetch;
  onWalk?: (index: number | null) => void;
};

export function reedPitchGain(role: DroneRole, layer: DroneLayer): number {
  const weight =
    (role === 'root' ? 1 : REED_GAINS.other) *
    (layer === 'upper' ? REED_GAINS.upper : 1);
  return weight * REED_GAINS.pitch;
}

function createReedVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  probe = false,
  sound: DroneSoundId = 'reed',
  buffers: ReadonlyMap<string, AudioBuffer> | null = null,
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
  let fade: GainNode;
  let fadeRamp: FadeRamp | null = null;
  try {
    fade = buildSound(
      sound,
      context,
      destination,
      pitches,
      when,
      attack,
      kit,
      probe,
      buffers,
    ).fade;
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
    stop(stopAt: number, fadeTime: number, now = context.currentTime) {
      const release = Math.max(fadeTime, 0.015);
      const time = Math.min(now, stopAt);
      const end = time + release;
      const level = fadeLevel(fadeRamp, time);
      scheduleFade(fade.gain, time, end, level);
      fadeRamp = { from: level, to: 0, startTime: time, endTime: end };
      const rate = context.sampleRate > 0 ? context.sampleRate : 48000;
      for (const source of sources) source.stop(end + 1 / rate);
      const leftover = nodes;
      setTimeout(
        () => {
          for (const node of leftover) node.disconnect();
        },
        (release + 0.05) * 1000,
      );
    },
  };
}

/**
 * The measured voice is the production reed, including the bellows on the
 * envelope. A unity loop replaces the reed sum so the rendered samples are
 * the gain. The room is still built and fed; its bus is silent.
 */
export function startMeasuredReed(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  sound: DroneSoundId = 'reed',
): { stop: (stopAt: number, fade: number, now?: number) => void } {
  return createReedVoice(
    context,
    destination,
    pitches,
    when,
    attack,
    true,
    sound,
  );
}

/** The production voice, waveform included, for a peak measurement. */
export function startLiveVoice(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  sound: DroneSoundId,
  buffers: ReadonlyMap<string, AudioBuffer> | null = null,
): { stop: (stopAt: number, fade: number, now?: number) => void } {
  return createReedVoice(
    context,
    destination,
    pitches,
    when,
    attack,
    false,
    sound,
    buffers,
  );
}

function fadeToRoom(
  context: BaseAudioContext,
  kit: VoiceKit,
  envelope: GainNode,
  destination: AudioNode,
  wet: number,
  dry: number,
  probe: boolean,
): GainNode {
  const fade = kit.gain();
  fade.gain.value = 1;
  envelope.connect(fade);
  if (probe) {
    fade.connect(destination);
    const sink = kit.gain();
    sink.gain.value = 0;
    connectRoom(context, kit, fade, sink, wet, dry);
  } else {
    connectRoom(context, kit, fade, destination, wet, dry);
  }
  return fade;
}

function probeUnity(
  context: BaseAudioContext,
  kit: VoiceKit,
  envelope: AudioNode,
  when: number,
) {
  const direct = kit.player();
  const unity = context.createBuffer(1, 1, context.sampleRate);
  unity.getChannelData(0)[0] = 1;
  direct.buffer = unity;
  direct.loop = true;
  direct.connect(envelope);
  direct.start(when);
}

function buildSound(
  sound: DroneSoundId,
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: VoiceKit,
  probe: boolean,
  buffers: ReadonlyMap<string, AudioBuffer> | null,
): { envelope: GainNode; ramp: GainRamp; fade: GainNode } {
  if (sound === 'bow')
    return buildBow(context, destination, pitches, when, attack, kit, probe);
  if (sound === 'cello') {
    return buildCello(
      context,
      destination,
      pitches,
      when,
      attack,
      kit,
      probe,
      buffers,
    );
  }
  return buildReed(context, destination, pitches, when, attack, kit, probe);
}

function buildBow(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: VoiceKit,
  probe: boolean,
): { envelope: GainNode; ramp: GainRamp; fade: GainNode } {
  const cents = symmetricDetuneCents('bow');
  const waves = ['sawtooth', 'triangle', 'triangle', 'sawtooth'] as const;
  const voiceOscs: OscillatorNode[] = [];
  const mixer = kit.gain();
  mixer.gain.value = 1;
  if (!probe) {
    for (const pitch of pitches) {
      const pitchGain = kit.gain();
      pitchGain.gain.value =
        (pitch.role === 'root' ? 1 : REED_GAINS.other) *
        (pitch.layer === 'upper' ? REED_GAINS.upper : 1) *
        BOW_GAINS.pitch;
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
  }

  const lowpass = kit.filter();
  lowpass.type = 'lowpass';
  lowpass.Q.value = 0.65;
  const opened = attack > 0.8;
  lowpass.frequency.setValueAtTime(opened ? 240 : 880, when);
  lowpass.frequency.exponentialRampToValueAtTime(
    1480,
    when + (opened ? 3.4 : 1.1),
  );
  if (!probe) mixer.connect(lowpass);

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
  vibrato.start(when);

  const envelope = kit.gain();
  const ramp = scheduleSwell(envelope.gain, when, attack, BOW_GAINS.envelope);
  if (probe) probeUnity(context, kit, envelope, when);
  else {
    lowpass.connect(envelope);
    const noise = kit.player();
    noise.buffer = noiseBuffer(context);
    noise.loop = true;
    const noiseFilter = kit.filter();
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1700;
    noiseFilter.Q.value = 0.55;
    const noiseGain = kit.gain();
    noiseGain.gain.value = BOW_GAINS.noise;
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(envelope);
    noise.start(when);
    for (const voice of voiceOscs) voice.start(when);
  }
  filterLfo.start(when);
  return {
    envelope,
    ramp,
    fade: fadeToRoom(
      context,
      kit,
      envelope,
      destination,
      BOW_GAINS.wet,
      BOW_GAINS.dry,
      probe,
    ),
  };
}

function buildCello(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: VoiceKit,
  probe: boolean,
  buffers: ReadonlyMap<string, AudioBuffer> | null,
): { envelope: GainNode; ramp: GainRamp; fade: GainNode } {
  const mixer = kit.gain();
  mixer.gain.value = 1;
  if (!probe) {
    if (!buffers) throw new Error('Cello samples are not loaded.');
    for (const pitch of pitches) {
      const choice = sampleForMidi(pitch.midi);
      const buffer = buffers.get(choice.file);
      if (!buffer) throw new Error(`Missing cello sample ${choice.file}.`);
      const source = kit.player();
      source.buffer = buffer;
      source.loop = true;
      source.playbackRate.value = choice.playbackRate;
      const gain = kit.gain();
      gain.gain.value =
        (pitch.role === 'root' ? 1 : REED_GAINS.other) *
        (pitch.layer === 'upper' ? REED_GAINS.upper : 1) *
        CELLO_GAINS.pitch;
      source.connect(gain);
      gain.connect(mixer);
      source.start(when);
    }
  }
  const lowpass = kit.filter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 4200;
  lowpass.Q.value = 0.4;
  if (!probe) mixer.connect(lowpass);
  const envelope = kit.gain();
  const ramp = scheduleSwell(
    envelope.gain,
    when,
    attack,
    CELLO_GAINS.envelope,
  );
  if (probe) probeUnity(context, kit, envelope, when);
  else lowpass.connect(envelope);
  return {
    envelope,
    ramp,
    fade: fadeToRoom(
      context,
      kit,
      envelope,
      destination,
      CELLO_GAINS.wet,
      CELLO_GAINS.dry,
      probe,
    ),
  };
}

function buildReed(
  context: BaseAudioContext,
  destination: AudioNode,
  pitches: readonly DronePitch[],
  when: number,
  attack: number,
  kit: VoiceKit,
  probe = false,
): { envelope: GainNode; ramp: GainRamp; fade: GainNode } {
  const mixer = kit.gain();
  mixer.gain.value = 1;
  for (const pitch of pitches) {
    const frequency = midiHz(pitch.midi);
    const wave = reedWave(context, frequency);
    const pitchGain = kit.gain();
    pitchGain.gain.value = reedPitchGain(pitch.role, pitch.layer);
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
  bodyGain.gain.value = REED_GAINS.body;
  mixer.connect(body);
  body.connect(bodyGain);

  const formants = [
    { frequency: 620, q: 6.2, amount: REED_GAINS.formants[0] },
    { frequency: 1280, q: 5.4, amount: REED_GAINS.formants[1] },
    { frequency: 2140, q: 4.4, amount: REED_GAINS.formants[2] },
  ];
  const formantBus = kit.gain();
  formantBus.gain.value = REED_GAINS.formantBus;
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
  noiseGain.gain.value = REED_GAINS.noise;
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(sum);
  noise.start(when);

  const envelope = kit.gain();
  const ramp = scheduleSwell(envelope.gain, when, attack);
  if (probe) {
    const direct = kit.player();
    const unity = context.createBuffer(1, 1, context.sampleRate);
    unity.getChannelData(0)[0] = 1;
    direct.buffer = unity;
    direct.loop = true;
    direct.connect(envelope);
    direct.start(when);
  } else {
    sum.connect(envelope);
  }

  const bellows = kit.osc();
  bellows.type = 'sine';
  bellows.frequency.value = 0.16;
  const depth = kit.gain();
  depth.gain.setValueAtTime(0, when);
  depth.gain.linearRampToValueAtTime(
    REED_GAINS.bellows,
    when + attack + REED_TIMING.bellowsRise,
  );
  bellows.connect(depth);
  depth.connect(envelope.gain);
  bellows.start(when);

  return {
    envelope,
    ramp,
    fade: fadeToRoom(
      context,
      kit,
      envelope,
      destination,
      REED_GAINS.wet,
      REED_GAINS.dry,
      probe,
    ),
  };
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
          ? REED_GAINS.early
          : 0;
      data[i] =
        ((random() * 2 - 1) * (1 - t) ** 2.8 + early) * REED_GAINS.impulse;
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
  const real = new Float32Array(REED_GAINS.partials);
  const imaginary = new Float32Array(REED_GAINS.partials);
  for (let harmonic = 1; harmonic < imaginary.length; harmonic += 1) {
    if (frequency * harmonic >= context.sampleRate / 2) break;
    const coefficient =
      harmonic % 2 === 1 ? REED_GAINS.oddPartial : REED_GAINS.evenPartial;
    imaginary[harmonic] = coefficient / harmonic ** REED_GAINS.partialSlope;
  }
  return context.createPeriodicWave(real, imaginary);
}

const AUDIO_ERROR = 'Audio didn\u2019t start. Tap play to try again.';

export class ReedDrone {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private voices: ReedVoice[] = [];
  private voiceNodes = 0;
  private outputUntil = 0;
  private generation = 0;
  private phase: DroneStatus = 'idle';
  private disposed = false;
  private volume = 1;
  private sound: DroneSoundId = 'reed';
  private current: ReedRequest | null = null;
  private walking = false;
  private walkIndex = 0;
  private walkGeneration = 0;
  private walkTimer: ReturnType<typeof setTimeout> | undefined;
  private plucks: {
    oscillator: OscillatorNode;
    envelope: GainNode;
    started: number;
  }[] = [];
  private celloBytes = new Map<string, ArrayBuffer>();
  private celloBuffers = new Map<string, AudioBuffer>();
  private celloLoad: Promise<void> | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly onWalk: (index: number | null) => void;
  private resumeTimer: ReturnType<typeof setTimeout> | undefined;
  private cancelResume: (() => void) | null = null;
  private readonly onStatus: (status: DroneStatus, message?: string) => void;
  private readonly createContext: () => AudioContext;
  private readonly ownsContext: boolean;
  private onContextState: (() => void) | null = null;
  private readonly documentTarget: VisibilityTarget | null;
  private readonly windowTarget: WindowTarget | null;
  private readonly onVisibility = () => {
    if (!this.documentTarget?.hidden) return;
    this.stopWalk();
    this.halt(REED_TIMING.hideFade);
  };
  private readonly onPageHide = () => {
    this.stopWalk();
    this.halt(REED_TIMING.hideFade);
  };

  constructor(
    onStatus: (status: DroneStatus, message?: string) => void,
    options: ReedOptions = {},
  ) {
    this.onStatus = onStatus;
    this.onWalk = options.onWalk ?? (() => {});
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.ownsContext = options.createContext === undefined;
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
    this.documentTarget?.addEventListener(
      'visibilitychange',
      this.onVisibility,
    );
    this.windowTarget?.addEventListener('pagehide', this.onPageHide);
  }

  nodeCount(): number {
    return this.voiceNodes + (this.master ? 2 : 0);
  }

  play(request: ReedRequest): void {
    if (this.disposed) return;
    this.sound = requestSound(request);
    const pitches = dronePitches(request.root, request.modeId, request.octave);
    void this.start(
      request,
      pitches,
      REED_TIMING.playAttack,
      REED_TIMING.playFade,
    );
  }

  retune(request: ReedRequest): void {
    if (this.disposed) return;
    const pitches = dronePitches(request.root, request.modeId, request.octave);
    if (this.phase === 'idle' || this.phase === 'error') return;
    const nextSound = requestSound(request);
    if (
      this.current &&
      this.current.root === request.root &&
      this.current.modeId === request.modeId &&
      this.current.octave === request.octave &&
      this.sound === nextSound
    ) {
      return;
    }
    this.sound = nextSound;
    void this.start(
      request,
      pitches,
      REED_TIMING.switchAttack,
      REED_TIMING.switchFade,
    );
  }

  /** Fetch the cello loops. Decode waits until a context exists. */
  preloadCello(): Promise<void> {
    this.celloLoad ??= this.fetchCello().catch((error: unknown) => {
      this.celloLoad = null;
      throw error;
    });
    return this.celloLoad;
  }

  walk(request: ReedRequest): void {
    if (this.disposed) return;
    if (this.walking) {
      this.stopWalk();
      return;
    }
    this.walking = true;
    this.sound = requestSound(request);
    const context = this.unlock().context;
    void context.resume().catch(() => {});
    this.runWalk(scaleWalk(request.root, request.scaleId ?? request.modeId));
  }

  stopWalk(): void {
    this.walking = false;
    this.walkGeneration += 1;
    clearTimeout(this.walkTimer);
    this.stopPlucks();
    this.onWalk(null);
  }

  setVolume(volume: number): void {
    if (this.disposed) return;
    this.volume = clampDroneVolume(volume);
    this.applyVolume();
  }

  stop(fade: number = REED_TIMING.stopFade): void {
    this.halt(fade);
  }

  private halt(fade: number): void {
    if (this.disposed) return;
    this.generation += 1;
    this.cancelResume?.();
    this.cancelResume = null;
    clearTimeout(this.resumeTimer);
    if (this.context && this.voices.length)
      this.fadeVoices(this.context.currentTime, fade);
    else this.voices = [];
    this.voiceNodes = 0;
    this.phase = 'idle';
    this.onStatus('idle');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopWalk();
    this.generation += 1;
    this.cancelResume?.();
    this.cancelResume = null;
    clearTimeout(this.resumeTimer);
    this.documentTarget?.removeEventListener(
      'visibilitychange',
      this.onVisibility,
    );
    this.windowTarget?.removeEventListener('pagehide', this.onPageHide);
    const context = this.context;
    const master = this.master;
    const limiter = this.limiter;
    const ownsContext = this.ownsContext;
    if (context) {
      if (this.onContextState) {
        context.removeEventListener('statechange', this.onContextState);
        this.onContextState = null;
      }
      const release = Math.max(REED_TIMING.hideFade, 0.015);
      const now = context.currentTime;
      this.fadeVoices(now, REED_TIMING.hideFade);
      // A fade that is already running may outlast the hide cut. Keep the
      // master connected until the later of the two reaches silence.
      const wait = Math.max(release, this.outputUntil - now);
      setTimeout(() => {
        master?.disconnect();
        limiter?.disconnect();
        if (ownsContext) void context.close().catch(() => {});
      }, wait * 1000);
    }
    this.context = null;
    this.master = null;
    this.limiter = null;
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
      if (opened.context.state !== 'running')
        throw new Error('Audio is unavailable.');
      if (this.sound === 'cello') await this.decodeCello(opened.context);
      if (generation !== this.generation || this.disposed) return;
      const when = opened.context.currentTime + 0.02;
      this.fadeVoices(when, fade);
      const voice = createReedVoice(
        opened.context,
        opened.master,
        pitches,
        when,
        attack,
        false,
        this.sound,
        this.sound === 'cello' ? this.celloBuffers : null,
      );
      this.voices = [voice];
      this.voiceNodes = voice.nodeCount;
      this.phase = 'playing';
      this.onStatus('playing');
    } catch {
      if (generation !== this.generation || this.disposed) return;
      if (this.context) {
        this.fadeVoices(this.context.currentTime, REED_TIMING.hideFade);
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
    master.gain.value = droneMasterGain(this.volume, this.sound);
    const limiter = context.createDynamicsCompressor();
    limiter.threshold.value = DRONE_LIMITER.threshold;
    limiter.knee.value = DRONE_LIMITER.knee;
    limiter.ratio.value = DRONE_LIMITER.ratio;
    limiter.attack.value = DRONE_LIMITER.attack;
    limiter.release.value = DRONE_LIMITER.release;
    master.connect(limiter);
    limiter.connect(context.destination);
    this.onContextState = () => {
      if (context.state === 'running' || context.state === 'closed') return;
      this.stopWalk();
      if (this.phase !== 'playing') return;
      this.halt(REED_TIMING.hideFade);
    };
    context.addEventListener('statechange', this.onContextState);
    this.context = context;
    this.master = master;
    this.limiter = limiter;
    void context.resume().catch(() => {});
    return { context, master };
  }

  private waitUntilRunning(
    context: AudioContext,
    generation: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const resume = context.resume();
      let rejectTimeout: (error: Error) => void = () => {};
      const timeout = new Promise<never>((_, rejectRace) => {
        rejectTimeout = rejectRace;
      });
      const timer = setTimeout(
        () => rejectTimeout(new Error('Audio did not start.')),
        2000,
      );
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
    const next = droneMasterGain(this.volume, this.sound);
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    this.master.gain.linearRampToValueAtTime(next, now + 0.03);
  }

  private fadeVoices(when: number, fade: number): void {
    if (this.voices.length) {
      const release = Math.max(fade, 0.015);
      this.outputUntil = Math.max(this.outputUntil, when + release);
    }
    for (const voice of this.voices) voice.stop(when, fade);
    this.voices = [];
  }

  private async fetchCello(): Promise<void> {
    await Promise.all(
      CELLO_SAMPLES.map(async (sample) => {
        if (this.celloBytes.has(sample.file)) return;
        const response = await this.fetchImpl(sample.href);
        if (!response.ok)
          throw new Error(`Cello sample failed (${response.status}).`);
        this.celloBytes.set(sample.file, await response.arrayBuffer());
      }),
    );
  }

  private async decodeCello(context: BaseAudioContext): Promise<void> {
    await this.preloadCello();
    for (const sample of CELLO_SAMPLES) {
      if (this.celloBuffers.has(sample.file)) continue;
      const bytes = this.celloBytes.get(sample.file);
      if (!bytes) throw new Error(`Missing cello sample ${sample.file}.`);
      const decoded = await context.decodeAudioData(bytes.slice(0));
      this.celloBuffers.set(sample.file, loopSampleBuffer(context, decoded));
    }
  }

  private runWalk(notes: ReturnType<typeof scaleWalk>): void {
    const generation = (this.walkGeneration += 1);
    let index = 0;
    const tick = () => {
      if (!this.walking || generation !== this.walkGeneration || !this.context)
        return;
      this.onWalk(index);
      this.pluck(notes[index].midi);
      index += 1;
      if (index < notes.length) this.walkTimer = setTimeout(tick, WALK_STEP_MS);
      else {
        this.walkTimer = setTimeout(() => {
          if (generation !== this.walkGeneration) return;
          this.walking = false;
          this.onWalk(null);
        }, WALK_STEP_MS);
      }
    };
    this.walkTimer = setTimeout(tick, 80);
  }

  private pluck(midi: number): void {
    if (!this.context || !this.limiter) return;
    const now = this.context.currentTime + 0.02;
    const plucked = startWalkPluck(
      this.context,
      this.limiter,
      midi,
      now,
      this.volume,
    );
    plucked.oscillator.onended = () => {
      for (const node of plucked.nodes) node.disconnect();
    };
    this.plucks.push({
      oscillator: plucked.oscillator,
      envelope: plucked.envelope,
      started: now,
    });
  }

  private stopPlucks(): void {
    const now = this.context?.currentTime ?? 0;
    for (const pluck of this.plucks) {
      try {
        const level = walkPluckLevel(pluck.started, now);
        pluck.envelope.gain.cancelScheduledValues(now);
        pluck.envelope.gain.setValueAtTime(level, now);
        pluck.envelope.gain.linearRampToValueAtTime(0, now + 0.02);
        pluck.oscillator.stop(now + 0.03);
      } catch {
        // Already stopped.
      }
    }
    this.plucks = [];
  }
}

/** The walk pluck: its own periodic wave, into the limiter, scaled by volume. */
export function startWalkPluck(
  context: BaseAudioContext,
  destination: AudioNode,
  midi: number,
  when: number,
  volume: number,
): { oscillator: OscillatorNode; envelope: GainNode; nodes: AudioNode[] } {
  const oscillator = context.createOscillator();
  const frequency = midiHz(midi);
  oscillator.setPeriodicWave(pluckWave(context, frequency));
  oscillator.frequency.value = frequency;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.45;
  filter.frequency.setValueAtTime(Math.min(5500, frequency * 12), when);
  filter.frequency.exponentialRampToValueAtTime(
    Math.max(600, frequency * 2),
    when + 1.3,
  );
  const envelope = context.createGain();
  envelope.gain.setValueAtTime(WALK_GAINS.decay, when);
  envelope.gain.linearRampToValueAtTime(WALK_GAINS.attack, when + 0.006);
  envelope.gain.exponentialRampToValueAtTime(WALK_GAINS.body, when + 0.65);
  envelope.gain.exponentialRampToValueAtTime(WALK_GAINS.decay, when + 2.5);
  envelope.gain.linearRampToValueAtTime(0, when + 2.52);
  const trim = context.createGain();
  trim.gain.value = WALK_GAINS.trim * clampDroneVolume(volume);
  oscillator.connect(filter);
  filter.connect(envelope);
  envelope.connect(trim);
  trim.connect(destination);
  const nodes: AudioNode[] = [oscillator, filter, envelope, trim];
  oscillator.start(when);
  oscillator.stop(when + 2.55);
  return { oscillator, envelope, nodes };
}

/** Trim, loop, and crossfade a decoded cello sample the way playback does. */
export function prepareCelloBuffer(
  context: BaseAudioContext,
  decoded: AudioBuffer,
): AudioBuffer {
  return loopSampleBuffer(context, decoded);
}

function loopSampleBuffer(
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

function mixdown(buffer: AudioBuffer): Float32Array {
  const mixed = new Float32Array(buffer.length);
  const channels = buffer.numberOfChannels;
  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1)
      mixed[index] += data[index] / channels;
  }
  return mixed;
}

function pluckWave(context: BaseAudioContext, frequency: number): PeriodicWave {
  const real = new Float32Array(WALK_GAINS.partials);
  const imaginary = new Float32Array(WALK_GAINS.partials);
  for (let harmonic = 1; harmonic < imaginary.length; harmonic += 1) {
    if (frequency * harmonic >= context.sampleRate / 2) break;
    imaginary[harmonic] =
      Math.sin(harmonic * Math.PI * 0.23) / harmonic ** 1.35;
  }
  return context.createPeriodicWave(real, imaginary);
}
