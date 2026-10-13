/**
 * Shared output for the drone and a voicing played over it.
 * The limiter is in the chain only while the drone is sounding.
 * With the drone off, nothing is connected ahead of the real destination,
 * so a voicing render matches a direct connection sample for sample.
 */

export const DRONE_LIMITER = {
  threshold: -1.5,
  knee: 6,
  ratio: 12,
  attack: 0.001,
  release: 0.22,
} as const;

/** Crossfade between the dry tap and the limiter. Short enough to be click-free. */
export const OUTPUT_CROSSFADE = 0.02;

/** How long a chord already on the bus may ring after the drone lets go. */
const OUTPUT_TAIL = 2.6;

export function limiterKneeStart(): number {
  return 10 ** ((DRONE_LIMITER.threshold - DRONE_LIMITER.knee / 2) / 20);
}

export type OutputChain = {
  bus: GainNode;
  limiter: DynamicsCompressorNode;
  /** Real destination while the drone is off. The bus while it is on. */
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
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = DRONE_LIMITER.threshold;
  limiter.knee.value = DRONE_LIMITER.knee;
  limiter.ratio.value = DRONE_LIMITER.ratio;
  limiter.attack.value = DRONE_LIMITER.attack;
  limiter.release.value = DRONE_LIMITER.release;
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
    voicingTarget() {
      return drone && connected ? bus : context.destination;
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
