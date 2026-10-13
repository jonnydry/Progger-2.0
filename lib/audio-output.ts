/**
 * Shared output for the drone and a voicing played over it.
 * The limiter is in the chain only while the drone is sounding.
 * With the drone off, nothing is connected ahead of the real destination,
 * so a voicing render matches a direct connection sample for sample.
 */

/**
 * Memoryless soft clip. Unity through the knee, then an exponential
 * approach to the ceiling with a matched slope, so a sample under the
 * knee is unchanged and a sample above it cannot reach the ceiling.
 * A DynamicsCompressor was not usable here: its makeup gain lifted
 * ordinary mixes, and it still let a 0.93 peak through.
 */
export const OUTPUT_KNEE = 0.8;
export const OUTPUT_CEILING = 0.8414;

/** Crossfade between the dry tap and the limiter. Short enough to be click-free. */
export const OUTPUT_CROSSFADE = 0.02;

/**
 * How long a chord already on the bus may ring after the drone lets go.
 * The voicing strums six strings 45 ms apart, then decays for 2.5 s and
 * releases over 20 ms. The drone room keeps ringing for 0.8 s plus a
 * 50 ms margin. The hold is that release plus that room.
 * tests/output-tail.test.ts locks the pieces to voicing-audio.ts and the room.
 */
export const OUTPUT_VOICING_STRINGS = 6;
export const OUTPUT_VOICING_STRUM = 0.045;
export const OUTPUT_VOICING_DECAY = 2.5;
export const OUTPUT_VOICING_RELEASE = 0.02;
export const OUTPUT_ROOM = 0.8;
export const OUTPUT_ROOM_MARGIN = 0.05;

export function outputTailSeconds(): number {
  return (
    (OUTPUT_VOICING_STRINGS - 1) * OUTPUT_VOICING_STRUM +
    OUTPUT_VOICING_DECAY +
    OUTPUT_VOICING_RELEASE +
    OUTPUT_ROOM +
    OUTPUT_ROOM_MARGIN
  );
}

export const OUTPUT_TAIL = outputTailSeconds();

/**
 * Drone-only loudness. A gentle tanh bend, then the small-signal slope.
 * Chords and walk plucks enter at `chordInput`, so they are not saturated.
 * Their envelope ducks the drone. The safety clip stays after the sum.
 * Drive 3 keeps a cap-level sine under about 2% THD. Drive 16 was near 18%.
 * Makeup is the small-signal slope. 1.27 keeps the loudest drone crossfade
 * near 0.225, so that peak plus the 0.6375 pluck ceiling stays under −1 dBFS.
 */
export const DRONE_DRIVE = 3;
export const DRONE_MAKEUP = 1.27;
/** One-pole time constants. Attack is fast; release ignores the string's pitch. */
export const DRONE_DUCK_ATTACK = 0.01;
export const DRONE_DUCK_RELEASE = 0.22;
/**
 * How hard a chord envelope pushes the drone down. The floor below
 * catches it, so a loud strum cannot drive the gain through zero.
 */
export const DRONE_DUCK_DEPTH = 6;
/**
 * Lowest drone VCA gain while a chord is sounding. −10 dB is inside the
 * −9 to −12 dB window: deep enough to leave the chord the headroom,
 * and still positive so the drone cannot flip phase.
 */
export const DRONE_DUCK_FLOOR_DB = -10;
export const DRONE_DUCK_FLOOR = 10 ** (DRONE_DUCK_FLOOR_DB / 20);
/** The drone waits this long so the chord envelope can duck it before the strum peak. */
export const DRONE_DUCK_LOOKAHEAD = 0.008;

export function droneSaturateSample(sample: number): number {
  return Math.tanh(sample * DRONE_DRIVE) * (DRONE_MAKEUP / DRONE_DRIVE);
}

/** Harmonics of a sine at `amplitude` through the drone saturator. */
export function droneSaturatorHarmonics(
  amplitude: number,
  frequency = 110,
  sampleRate = 48000,
): { thd: number; thirdDb: number; peak: number } {
  const cycles = 80;
  const length = Math.round((sampleRate * cycles) / frequency);
  let peak = 0;
  const harmonics = Array.from({ length: 9 }, () => 0);
  for (let harmonic = 1; harmonic <= 9; harmonic += 1) {
    let real = 0;
    let imag = 0;
    const omega = (2 * Math.PI * frequency * harmonic) / sampleRate;
    for (let index = 0; index < length; index += 1) {
      const input = amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
      const sample = droneSaturateSample(input);
      if (harmonic === 1) peak = Math.max(peak, Math.abs(sample));
      real += sample * Math.cos(omega * index);
      imag -= sample * Math.sin(omega * index);
    }
    harmonics[harmonic - 1] = (2 * Math.hypot(real, imag)) / length;
  }
  const fundamental = harmonics[0] ?? 0;
  let distortion = 0;
  for (let index = 1; index < harmonics.length; index += 1) {
    distortion += (harmonics[index] ?? 0) ** 2;
  }
  const third = harmonics[2] ?? 0;
  return {
    thd: fundamental > 0 ? Math.sqrt(distortion) / fundamental : 0,
    thirdDb: fundamental > 0 && third > 0 ? 20 * Math.log10(third / fundamental) : -Infinity,
    peak,
  };
}

/**
 * What the sidechain adds to the VCA's intrinsic gain of 1.
 * The result stays at or above `DRONE_DUCK_FLOOR - 1`, so the gain
 * itself stays at or above the floor.
 */
export function droneDuckOffset(sample: number): number {
  const floorOffset = DRONE_DUCK_FLOOR - 1;
  if (sample >= 0) return 0;
  if (sample <= floorOffset) return floorOffset;
  return sample;
}

export function droneSaturateCurve(length = 2049): Float32Array {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = droneSaturateSample(x);
  }
  return curve;
}

export function droneDuckFloorCurve(length = 2049): Float32Array {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = droneDuckOffset(x);
  }
  return curve;
}

const DUCK_PROCESSOR_NAME = 'drone-duck-follower';
const duckModules = new WeakMap<BaseAudioContext, Promise<void>>();

function duckProcessorSource(): string {
  return `const ATTACK=${DRONE_DUCK_ATTACK};const RELEASE=${DRONE_DUCK_RELEASE};
class DroneDuckFollower extends AudioWorkletProcessor {
  constructor() { super(); this.env = 0; }
  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return true;
    const channels = (inputs[0] || []);
    const attack = 1 - Math.exp(-1 / (sampleRate * ATTACK));
    const release = 1 - Math.exp(-1 / (sampleRate * RELEASE));
    let env = this.env;
    for (let index = 0; index < output.length; index += 1) {
      let level = 0;
      for (let channel = 0; channel < channels.length; channel += 1) {
        const data = channels[channel];
        if (data && index < data.length) {
          const value = Math.abs(data[index]);
          if (value > level) level = value;
        }
      }
      env += (level > env ? attack : release) * (level - env);
      output[index] = env;
    }
    this.env = env;
    return true;
  }
}
registerProcessor('${DUCK_PROCESSOR_NAME}', DroneDuckFollower);`;
}

/** Register the envelope follower on this context. A context without a worklet resolves at once. */
export function prepareDuckFollower(context: BaseAudioContext): Promise<void> {
  const pending = duckModules.get(context);
  if (pending) return pending;
  const worklet = (context as AudioContext).audioWorklet;
  if (!worklet) {
    const ready = Promise.resolve();
    duckModules.set(context, ready);
    return ready;
  }
  const url = URL.createObjectURL(
    new Blob([duckProcessorSource()], { type: 'application/javascript' }),
  );
  const ready = worklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  duckModules.set(context, ready);
  return ready;
}

export type DroneStage = {
  /** Saturated drone. The volume master connects here. */
  input: WaveShaperNode;
  /** Chords and walk plucks. They duck the drone and skip the saturator. */
  chordInput: GainNode;
  /** The signal added to the drone VCA. Null until `installDuck` resolves. */
  duck: AudioNode | null;
  readonly duckReady: boolean;
  /** Nodes this stage created, including the sidechain once it is installed. */
  readonly ownedNodes: number;
  installDuck(): Promise<void>;
};

export function createDroneStage(
  context: BaseAudioContext,
  destination: AudioNode,
): DroneStage {
  let owned = 0;
  const track = <T extends AudioNode>(node: T): T => {
    owned += 1;
    return node;
  };
  const input = track(context.createWaveShaper());
  input.curve = droneSaturateCurve() as Float32Array<ArrayBuffer>;
  input.oversample = 'none';
  const level = track(context.createGain());
  level.gain.value = 1;
  const chordInput = track(context.createGain());
  chordInput.gain.value = 1;
  const delay = track(context.createDelay(0.05));
  delay.delayTime.value = DRONE_DUCK_LOOKAHEAD;
  input.connect(level);
  level.connect(delay);
  delay.connect(destination);
  chordInput.connect(destination);
  let duck: AudioNode | null = null;
  let duckReady = false;
  let installing: Promise<void> | null = null;

  function connect(follower: AudioNode): void {
    if (duckReady) return;
    const depth = track(context.createGain());
    depth.gain.value = -DRONE_DUCK_DEPTH;
    const floor = track(context.createWaveShaper());
    floor.curve = droneDuckFloorCurve() as Float32Array<ArrayBuffer>;
    floor.oversample = 'none';
    chordInput.connect(follower);
    follower.connect(depth);
    depth.connect(floor);
    floor.connect(level.gain);
    duck = floor;
    duckReady = true;
  }

  return {
    input,
    chordInput,
    get duck() {
      return duck;
    },
    get duckReady() {
      return duckReady;
    },
    get ownedNodes() {
      return owned;
    },
    installDuck() {
      if (duckReady) return Promise.resolve();
      if (installing) return installing;
      const worklet = (context as AudioContext).audioWorklet;
      if (!worklet) {
        connect(track(context.createGain()));
        installing = Promise.resolve();
        return installing;
      }
      installing = prepareDuckFollower(context).then(() => {
        if (duckReady) return;
        const WorkletNode = globalThis.AudioWorkletNode;
        if (!WorkletNode) throw new Error('AudioWorkletNode is unavailable.');
        connect(track(new WorkletNode(context, DUCK_PROCESSOR_NAME)));
      });
      return installing;
    },
  };
}

export function limiterKneeStart(): number {
  return OUTPUT_KNEE;
}

/** One sample of the output clip. Odd, monotonic, and exact on [−knee, knee]. */
export function outputLimitSample(sample: number): number {
  const magnitude = Math.abs(sample);
  if (magnitude <= OUTPUT_KNEE) return sample;
  const headroom = OUTPUT_CEILING - OUTPUT_KNEE;
  const limited =
    OUTPUT_KNEE + headroom * (1 - Math.exp(-(magnitude - OUTPUT_KNEE) / headroom));
  return Math.sign(sample) * limited;
}

export function limiterCurve(length = 2049): Float32Array {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = outputLimitSample(x);
  }
  return curve;
}

export type OutputChain = {
  bus: GainNode;
  limiter: WaveShaperNode;
  /** Saturated drone input. The volume master connects here. */
  droneInput: WaveShaperNode;
  /** Chords and walk plucks while the drone is on. */
  chordInput: GainNode;
  readonly duckReady: boolean;
  /** Chain nodes, including the sidechain once `installDuck` has connected it. */
  readonly ownedNodes: number;
  installDuck(): Promise<void>;
  /** Real destination while the drone is off. The chord input while it is on. */
  voicingTarget(): AudioNode;
  /**
   * Engage or bypass the limiter.
   * `fade` is seconds. Zero snaps and, on bypass, drops the speaker taps.
   */
  setDrone(active: boolean, time: number, fade?: number): void;
  disconnect(): void;
};

export function createOutputChain(context: BaseAudioContext): OutputChain {
  let owned = 0;
  const track = <T extends AudioNode>(node: T): T => {
    owned += 1;
    return node;
  };
  const bus = track(context.createGain());
  bus.gain.value = 1;
  const dry = track(context.createGain());
  const wet = track(context.createGain());
  dry.gain.value = 1;
  wet.gain.value = 0;
  const limiter = track(context.createWaveShaper());
  limiter.curve = limiterCurve() as Float32Array<ArrayBuffer>;
  limiter.oversample = 'none';
  const stage = createDroneStage(context, bus);
  let connected = false;
  let drone = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer(): void {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  }

  function taps(on: boolean): void {
    if (on && !connected) {
      bus.connect(dry);
      dry.connect(context.destination);
      bus.connect(limiter);
      limiter.connect(wet);
      wet.connect(context.destination);
      connected = true;
      return;
    }
    if (!on && connected) {
      dry.disconnect();
      wet.disconnect();
      connected = false;
    }
  }

  function ramp(param: AudioParam, target: number, time: number, fade: number): void {
    param.cancelScheduledValues(time);
    param.setValueAtTime(param.value, time);
    if (fade <= 0) {
      param.setValueAtTime(target, time);
      return;
    }
    param.linearRampToValueAtTime(target, time + fade);
  }

  return {
    bus,
    limiter,
    droneInput: stage.input,
    chordInput: stage.chordInput,
    get duckReady() {
      return stage.duckReady;
    },
    get ownedNodes() {
      return owned + stage.ownedNodes;
    },
    installDuck() {
      return stage.installDuck();
    },
    voicingTarget() {
      return drone && connected ? stage.chordInput : context.destination;
    },
    setDrone(active: boolean, time: number, fade = OUTPUT_CROSSFADE) {
      const seconds = Math.max(0, fade);
      if (connected && active === drone && seconds > 0) return;
      clearTimer();
      if (active) {
        taps(true);
        drone = true;
        ramp(dry.gain, 0, time, seconds);
        ramp(wet.gain, 1, time, seconds);
        return;
      }
      drone = false;
      if (!connected) return;
      ramp(dry.gain, 1, time, seconds);
      ramp(wet.gain, 0, time, seconds);
      if (seconds <= 0) {
        taps(false);
        return;
      }
      timer = setTimeout(() => {
        timer = undefined;
        if (drone) return;
        taps(false);
      }, (seconds + OUTPUT_TAIL) * 1000);
    },
    disconnect() {
      clearTimer();
      drone = false;
      if (!connected) {
        bus.disconnect();
        limiter.disconnect();
        return;
      }
      bus.disconnect();
      dry.disconnect();
      wet.disconnect();
      limiter.disconnect();
      connected = false;
    },
  };
}

type PageAudio = {
  context: AudioContext;
  chain: OutputChain;
  voicing: AudioContext;
};

let page: PageAudio | null = null;

/** One context for Explore. Created on the first play gesture, not at import. */
export function pageAudio(): PageAudio {
  if (page) return page;
  if (typeof AudioContext === 'undefined') {
    throw new Error('Audio is only available in the browser.');
  }
  const context = new AudioContext();
  const chain = createOutputChain(context);
  page = { context, chain, voicing: voicingContext(context, chain) };
  return page;
}

/**
 * The voicing player connects to `destination` and closes its context.
 * While the drone is off, destination is the real one.
 * close() does not shut the shared context; the page unloads it.
 */
export function voicingContext(
  context: BaseAudioContext,
  chain: OutputChain,
): AudioContext {
  return new Proxy(context, {
    get(target, prop, _receiver) {
      if (prop === 'destination') return chain.voicingTarget();
      if (prop === 'close') return () => Promise.resolve();
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, prop, value) {
      Reflect.set(target, prop, value, target);
      return true;
    },
  }) as AudioContext;
}
