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
 * Drone-only loudness. A tanh bend cuts crest factor, then the small-signal
 * slope brings the steady tone up. Chords and walk plucks enter at
 * `chordInput`, so they are not saturated. Their level ducks the drone
 * through an envelope follower. The safety clip stays after the sum.
 */
export const DRONE_DRIVE = 16;
export const DRONE_MAKEUP = 3.305;
export const DRONE_DUCK_HERTZ = 70;
export const DRONE_DUCK_DEPTH = 4;
/** The drone waits this long so the chord envelope can duck it before the strum peak. */
export const DRONE_DUCK_LOOKAHEAD = 0.008;

export function droneSaturateSample(sample: number): number {
  return Math.tanh(sample * DRONE_DRIVE) * (DRONE_MAKEUP / DRONE_DRIVE);
}

export function droneSaturateCurve(length = 2049): Float32Array {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = droneSaturateSample(x);
  }
  return curve;
}

export function rectifierCurve(length = 2049): Float32Array {
  const curve = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const x = (index / (length - 1)) * 2 - 1;
    curve[index] = Math.abs(x);
  }
  return curve;
}

export type DroneStage = {
  /** Saturated drone. The volume master connects here. */
  input: WaveShaperNode;
  /** Chords and walk plucks. They duck the drone and skip the saturator. */
  chordInput: GainNode;
};

export function createDroneStage(
  context: BaseAudioContext,
  destination: AudioNode,
): DroneStage {
  const input = context.createWaveShaper();
  input.curve = droneSaturateCurve() as Float32Array<ArrayBuffer>;
  input.oversample = 'none';
  const level = context.createGain();
  level.gain.value = 1;
  const chordInput = context.createGain();
  chordInput.gain.value = 1;
  const rectify = context.createWaveShaper();
  rectify.curve = rectifierCurve() as Float32Array<ArrayBuffer>;
  rectify.oversample = 'none';
  const follower = context.createBiquadFilter();
  follower.type = 'lowpass';
  follower.frequency.value = DRONE_DUCK_HERTZ;
  follower.Q.value = 0.707;
  const depth = context.createGain();
  depth.gain.value = -DRONE_DUCK_DEPTH;
  const delay = context.createDelay(0.05);
  delay.delayTime.value = DRONE_DUCK_LOOKAHEAD;
  input.connect(level);
  level.connect(delay);
  delay.connect(destination);
  chordInput.connect(destination);
  chordInput.connect(rectify);
  rectify.connect(follower);
  follower.connect(depth);
  depth.connect(level.gain);
  return { input, chordInput };
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
  const bus = context.createGain();
  bus.gain.value = 1;
  const dry = context.createGain();
  const wet = context.createGain();
  dry.gain.value = 1;
  wet.gain.value = 0;
  const limiter = context.createWaveShaper();
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
