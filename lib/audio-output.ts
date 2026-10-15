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

/**
 * Fade used to enter and leave silence around a graph change.
 * The limiter is inserted or removed only while the speaker is silent.
 */
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
 * Makeup is the small-signal slope. 4.26 puts the default reed near −14 LUFS,
 * about 12 dB over main. The loudest bowed sustain stays under the 0.8 knee.
 */
export const DRONE_DRIVE = 3;
export const DRONE_MAKEUP = 4.26;
/** One-pole time constants. Attack is fast; release ignores the string's pitch. */
export const DRONE_DUCK_ATTACK = 0.01;
export const DRONE_DUCK_RELEASE = 0.28;
/**
 * How hard a chord envelope pushes the drone down. The floor below
 * catches it, so a loud strum cannot drive the gain through zero.
 */
export const DRONE_DUCK_DEPTH = 10;
/**
 * Lowest drone VCA gain while a chord is sounding. −26 dB leaves a
 * walked chord on the louder drones under the 0.8 knee, and the gain
 * stays positive so the drone cannot flip phase.
 * The release is 280 ms, so the return after a strum is a slow swell.
 */
export const DRONE_DUCK_FLOOR_DB = -26;
export const DRONE_DUCK_FLOOR = 10 ** (DRONE_DUCK_FLOOR_DB / 20);
/**
 * Lookahead shared by the drone and the chord.
 * The sidechain hears the chord immediately. Both signals wait this long
 * before the bus, and the drone VCA is after that wait, so the gain is
 * already at the floor when the strum and the drone meet.
 */
export const DRONE_DUCK_LOOKAHEAD = 0.02;
/**
 * Chord and walk level while the drone is on.
 * A bowed Eb locrian stack peaked 0.34 dB over the knee at full level.
 * The sidechain hears the strum before this trim, and the drone-off
 * path never enters the chord bus.
 */
export const DRONE_CHORD_TRIM_DB = -0.7;
export const DRONE_CHORD_TRIM = 10 ** (DRONE_CHORD_TRIM_DB / 20);

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
      const input =
        amplitude * Math.sin((2 * Math.PI * frequency * index) / sampleRate);
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
    thirdDb:
      fundamental > 0 && third > 0
        ? 20 * Math.log10(third / fundamental)
        : -Infinity,
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
  const chordLevel = track(context.createGain());
  chordLevel.gain.value = DRONE_CHORD_TRIM;
  const delay = track(context.createDelay(0.05));
  delay.delayTime.value = DRONE_DUCK_LOOKAHEAD;
  const chordDelay = track(context.createDelay(0.05));
  chordDelay.delayTime.value = DRONE_DUCK_LOOKAHEAD;
  input.connect(delay);
  delay.connect(level);
  level.connect(destination);
  chordInput.connect(chordLevel);
  chordLevel.connect(chordDelay);
  chordDelay.connect(destination);
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
    OUTPUT_KNEE +
    headroom * (1 - Math.exp(-(magnitude - OUTPUT_KNEE) / headroom));
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
  /**
   * Phrase audio stays on this gain. `setDrone` re-points it, so a loop
   * that is already sounding follows the limiter instead of keeping the
   * destination it picked on the first note.
   */
  phraseInput: GainNode;
  readonly duckReady: boolean;
  /** Chain nodes, including the sidechain once `installDuck` has connected it. */
  readonly ownedNodes: number;
  installDuck(): Promise<void>;
  /** Real destination while the drone is off. The chord input while it is on. */
  voicingTarget(): AudioNode;
  /**
   * Engage or bypass the limiter.
   * A positive `fade` mutes the speaker, changes the graph at silence,
   * then fades back in. Zero snaps and, on bypass, drops the taps.
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
  const phraseSend = track(context.createGain());
  phraseSend.gain.value = 1;
  let phrasePoint: AudioNode | null = null;

  function pointPhrase(target: AudioNode): void {
    if (phrasePoint === target) return;
    try {
      phraseSend.disconnect();
    } catch {
      // The send is connected only after the first point.
    }
    phraseSend.connect(target);
    phrasePoint = target;
  }

  pointPhrase(context.destination);
  const speaker = track(context.createGain());
  speaker.gain.value = 0;
  const dry = track(context.createGain());
  const wet = track(context.createGain());
  dry.gain.value = 1;
  wet.gain.value = 1;
  const limiter = track(context.createWaveShaper());
  limiter.curve = limiterCurve() as Float32Array<ArrayBuffer>;
  limiter.oversample = 'none';
  const stage = createDroneStage(context, bus);
  /** Where the bus is patched. `off` touches nothing ahead of the destination. */
  let route: 'off' | 'limited' | 'open' = 'off';
  let drone = false;
  let connected = false;
  let epoch = 0;
  let pendingSilence = -1;
  /** When the fade back in after `pendingSilence` reaches unity. */
  let pendingRestoreEnd = -1;
  let segment = { from: 0, to: 0, start: 0, end: 0 };
  let tailTimer: ReturnType<typeof setTimeout> | undefined;
  let dropTimer: ReturnType<typeof setTimeout> | undefined;
  let switchTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimer(timer: ReturnType<typeof setTimeout> | undefined) {
    if (timer === undefined) return undefined;
    clearTimeout(timer);
    return undefined;
  }

  function clearTimers(): void {
    tailTimer = clearTimer(tailTimer);
    dropTimer = clearTimer(dropTimer);
    switchTimer = clearTimer(switchTimer);
  }

  function levelAt(time: number): number {
    if (
      pendingRestoreEnd >= 0 &&
      time >= pendingRestoreEnd &&
      segment.end <= pendingRestoreEnd
    ) {
      return 1;
    }
    if (!(segment.end > segment.start) || time <= segment.start)
      return segment.from;
    if (time >= segment.end) return segment.to;
    const mix = (time - segment.start) / (segment.end - segment.start);
    return segment.from + (segment.to - segment.from) * mix;
  }

  function scheduleFade(time: number, target: number, seconds: number): void {
    const from = levelAt(time);
    speaker.gain.cancelScheduledValues(time);
    speaker.gain.setValueAtTime(from, time);
    if (!(seconds > 0) || from === target) {
      speaker.gain.setValueAtTime(target, time);
      segment = { from: target, to: target, start: time, end: time };
      return;
    }
    const end = time + seconds;
    speaker.gain.linearRampToValueAtTime(target, end);
    segment = { from, to: target, start: time, end };
  }

  function routeLimited(): void {
    if (route === 'off') bus.connect(speaker);
    if (route === 'open') {
      dry.disconnect();
      speaker.disconnect();
    }
    if (route !== 'limited') {
      speaker.connect(limiter);
      if (route === 'off') limiter.connect(wet);
      wet.connect(context.destination);
      wet.gain.value = 1;
    }
    route = 'limited';
    drone = true;
    connected = true;
    pointPhrase(stage.chordInput);
  }

  function routeOpen(): void {
    if (route === 'limited') {
      wet.disconnect();
      speaker.disconnect();
    }
    if (route === 'off') bus.connect(speaker);
    if (route !== 'open') {
      speaker.connect(dry);
      dry.connect(context.destination);
      dry.gain.value = 1;
    }
    route = 'open';
    drone = false;
    connected = true;
    pointPhrase(context.destination);
  }

  function routeOff(): void {
    if (route === 'limited') wet.disconnect();
    if (route === 'open') dry.disconnect();
    if (route !== 'off') {
      speaker.disconnect();
      bus.disconnect();
    }
    route = 'off';
    drone = false;
    connected = false;
    pendingSilence = -1;
    pendingRestoreEnd = -1;
    pointPhrase(context.destination);
  }

  function canSuspend(): boolean {
    const offline = context as OfflineAudioContext;
    return (
      typeof offline.length === 'number' &&
      typeof offline.suspend === 'function'
    );
  }

  /**
   * node-web-audio-api can report `when` as already rendered before
   * suspend() is installed, and the rejection arrives after the buffer
   * is done. The non-suspend offline path schedules the same fade.
   */
  function nodeOfflineRuntime(): boolean {
    const runtime = globalThis as {
      process?: { versions?: { node?: string } };
    };
    return typeof runtime.process?.versions?.node === 'string';
  }

  /**
   * Change the route once the speaker has reached silence, then fade back in.
   * Contexts that can suspend do the switch on the audio clock.
   * A live context waits the same interval.
   * node-web-audio-api's suspend races the render clock under load, so
   * that runtime uses the same pre-scheduled fade as Firefox.
   * Firefox's offline context cannot suspend. Both fades are already on the
   * speaker parameter, and the route is patched before the first sample.
   * The fade back in is a new ramp, so it does not replace the event that
   * lands on zero.
   */
  function atSilence(
    when: number,
    restoreSeconds: number,
    active: boolean,
  ): void {
    pendingSilence = when;
    pendingRestoreEnd = when + restoreSeconds;
    const token = epoch;
    const finish = (anchor: boolean) => {
      if (token !== epoch) return;
      if (pendingSilence === when) pendingSilence = -1;
      if (active) routeLimited();
      else routeOpen();
      if (anchor) {
        restore(when, restoreSeconds);
      } else {
        speaker.gain.linearRampToValueAtTime(1, when + restoreSeconds);
        segment = { from: 0, to: 1, start: when, end: when + restoreSeconds };
      }
      pendingRestoreEnd = -1;
    };
    if (canSuspend() && !nodeOfflineRuntime()) {
      const offline = context as OfflineAudioContext;
      // suspend() rejects once the render clock has passed `when`.
      // Switch on the spot instead of leaving that rejection unhandled.
      let switched = false;
      const switchNow = () => {
        if (switched || offline.state === 'closed') return;
        switched = true;
        finish(true);
      };
      if (!(when > offline.currentTime)) {
        switchNow();
        return;
      }
      void offline
        .suspend(when)
        .then(() => {
          switchNow();
          return offline.resume();
        })
        .catch((error: unknown) => {
          if (when > offline.currentTime) throw error;
          switchNow();
        });
      return;
    }
    const offline = context as OfflineAudioContext;
    if (typeof offline.length === 'number') {
      finish(false);
      return;
    }
    switchTimer = clearTimer(switchTimer);
    const delay = Math.max(0, (when - context.currentTime) * 1000);
    const waitForSilence = () => {
      switchTimer = undefined;
      if (token !== epoch) return;
      const remaining = when - context.currentTime;
      if (remaining > 0.001) {
        switchTimer = setTimeout(waitForSilence, remaining * 1000);
        return;
      }
      finish(true);
    };
    switchTimer = setTimeout(waitForSilence, delay);
  }

  function armTail(seconds: number): void {
    tailTimer = clearTimer(tailTimer);
    dropTimer = clearTimer(dropTimer);
    const token = epoch;
    tailTimer = setTimeout(
      () => {
        tailTimer = undefined;
        if (token !== epoch || drone || route !== 'open') return;
        const now = context.currentTime;
        const dropAt = now + OUTPUT_CROSSFADE;
        scheduleFade(now, 0, OUTPUT_CROSSFADE);
        const drop = () => {
          dropTimer = undefined;
          if (token !== epoch || drone || route !== 'open') return;
          const remaining = dropAt - context.currentTime;
          if (remaining > 0.001) {
            dropTimer = setTimeout(drop, remaining * 1000);
            return;
          }
          routeOff();
        };
        dropTimer = setTimeout(drop, OUTPUT_CROSSFADE * 1000);
      },
      (seconds + OUTPUT_TAIL) * 1000,
    );
  }

  function restore(when: number, seconds: number): void {
    const start = Math.max(when, context.currentTime);
    speaker.gain.setValueAtTime(0, start);
    speaker.gain.linearRampToValueAtTime(1, start + seconds);
    segment = { from: 0, to: 1, start, end: start + seconds };
  }

  return {
    bus,
    limiter,
    droneInput: stage.input,
    chordInput: stage.chordInput,
    phraseInput: phraseSend,
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
      if (seconds === 0) {
        epoch += 1;
        pendingSilence = -1;
        pendingRestoreEnd = -1;
        clearTimers();
        if (active) {
          scheduleFade(time, 1, 0);
          routeLimited();
        } else {
          scheduleFade(time, 0, 0);
          routeOff();
        }
        return;
      }
      if (active && route === 'limited' && pendingSilence < 0) return;
      if (!active && route === 'off') return;
      if (!active && route === 'open' && pendingSilence < 0) return;
      if (active && route === 'off') {
        clearTimers();
        speaker.gain.cancelScheduledValues(time);
        speaker.gain.setValueAtTime(0, time);
        segment = { from: 0, to: 0, start: time, end: time };
        routeLimited();
        speaker.gain.linearRampToValueAtTime(1, time + seconds);
        segment = { from: 0, to: 1, start: time, end: time + seconds };
        return;
      }
      scheduleFade(time, 0, seconds);
      const silence = time + seconds;
      atSilence(silence, seconds, active);
      if (!active) armTail(seconds);
    },
    disconnect() {
      epoch += 1;
      pendingSilence = -1;
      pendingRestoreEnd = -1;
      clearTimers();
      route = 'off';
      drone = false;
      connected = false;
      bus.disconnect();
      dry.disconnect();
      wet.disconnect();
      speaker.disconnect();
      limiter.disconnect();
      phraseSend.disconnect();
      phrasePoint = null;
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
