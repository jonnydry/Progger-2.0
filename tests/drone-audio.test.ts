import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ReedDrone,
  REED_GAINS,
  REED_TIMING,
  droneMasterGain,
  exponentialRampValue,
  type DroneStatus,
  type GainRamp,
  type ReedRequest,
} from '../lib/drone-audio.ts';
import { midiHz } from '../lib/drone.ts';
import { droneControlName } from '../lib/drone-controls.ts';
import { ExploreDrone } from '../lib/drone-session.ts';

class Param {
  value = 0;
  events: { method: string; value: number; time: number }[] = [];
  cancelScheduledValues(time = 0) {
    this.events.push({ method: 'cancel', value: 0, time });
  }
  cancelAndHoldAtTime(time = 0) {
    this.events.push({ method: 'hold', value: 0, time });
  }
  setValueAtTime(value: number, time = 0) {
    this.value = value;
    this.events.push({ method: 'set', value, time });
  }
  linearRampToValueAtTime(value: number, time = 0) {
    this.value = value;
    this.events.push({ method: 'linear', value, time });
  }
  exponentialRampToValueAtTime(value: number, time = 0) {
    this.value = value;
    this.events.push({ method: 'exponential', value, time });
  }
}

class FakeNode {
  connections: unknown[] = [];
  disconnected = false;
  connect(next: unknown) {
    this.connections.push(next);
    return next;
  }
  disconnect() {
    this.disconnected = true;
  }
}

class Oscillator extends FakeNode {
  type = '';
  frequency = new Param();
  detune = new Param();
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: number[] = [];
  setPeriodicWave() {}
  start(when = 0) {
    this.starts.push(when);
  }
  stop(when = 0) {
    this.stops.push(when);
  }
}

class BufferSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new Param();
  starts: number[] = [];
  stops: number[] = [];
  start(when = 0) {
    this.starts.push(when);
  }
  stop(when = 0) {
    this.stops.push(when);
  }
}

class FakeBuffer {
  channels: Float32Array[];
  sampleRate: number;
  length: number;
  numberOfChannels: number;
  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.channels = Array.from(
      { length: channels },
      () => new Float32Array(length),
    );
  }
  getChannelData(channel: number) {
    return this.channels[channel];
  }
}

class Compressor {
  threshold = new Param();
  knee = new Param();
  ratio = new Param();
  attack = new Param();
  release = new Param();
  connections: unknown[] = [];
  disconnected = false;
  connect(next: unknown) {
    this.connections.push(next);
    return next;
  }
  disconnect() {
    this.disconnected = true;
    this.connections = [];
  }
}

class FakeContext {
  state = 'running';
  currentTime = 4;
  sampleRate = 48000;
  destination = new FakeNode();
  closed = 0;
  private stateListeners = new Set<() => void>();
  oscillators: Oscillator[] = [];
  sources: BufferSource[] = [];
  compressors: Compressor[] = [];
  gains: (FakeNode & { gain: Param })[] = [];
  filters: (FakeNode & { frequency: Param; Q: Param; type: string })[] = [];
  convolvers: (FakeNode & { normalize: boolean; buffer: FakeBuffer | null })[] =
    [];
  params: Param[] = [];
  resume = () => {
    this.state = 'running';
    return Promise.resolve();
  };
  close() {
    this.closed += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
  addEventListener(type: string, listener: () => void) {
    if (type === 'statechange') this.stateListeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (type === 'statechange') this.stateListeners.delete(listener);
  }
  emitState() {
    for (const listener of this.stateListeners) listener();
  }
  stateListenerCount() {
    return this.stateListeners.size;
  }
  createGain() {
    const gain = new Param();
    this.params.push(gain);
    const node = Object.assign(new FakeNode(), { gain });
    this.gains.push(node);
    return node;
  }
  createOscillator() {
    const node = new Oscillator();
    this.params.push(node.frequency, node.detune);
    this.oscillators.push(node);
    return node;
  }
  createBufferSource() {
    const node = new BufferSource();
    this.params.push(node.playbackRate);
    this.sources.push(node);
    return node;
  }
  createBiquadFilter() {
    const frequency = new Param();
    const Q = new Param();
    this.params.push(frequency, Q);
    const node = Object.assign(new FakeNode(), { frequency, Q, type: '' });
    this.filters.push(node);
    return node;
  }
  createDynamicsCompressor() {
    const compressor = new Compressor();
    this.params.push(
      compressor.threshold,
      compressor.knee,
      compressor.ratio,
      compressor.attack,
      compressor.release,
    );
    this.compressors.push(compressor);
    return compressor;
  }
  createConvolver() {
    const node = Object.assign(new FakeNode(), {
      normalize: true,
      buffer: null as FakeBuffer | null,
    });
    this.convolvers.push(node);
    return node;
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
}

class FakeDocument {
  hidden = false;
  private listeners = new Map<string, Set<() => void>>();
  addEventListener(type: string, listener: () => void) {
    const set = this.listeners.get(type) ?? new Set<() => void>();
    set.add(listener);
    this.listeners.set(type, set);
  }
  removeEventListener(type: string, listener: () => void) {
    this.listeners.get(type)?.delete(listener);
  }
  emit(type: string) {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

const lowRequest: ReedRequest = { root: 'A', modeId: 'dorian', octave: 'low' };

function setup(windowTarget: FakeDocument | null = null) {
  const context = new FakeContext();
  const states: DroneStatus[] = [];
  const messages: string[] = [];
  let created = 0;
  const documentTarget = new FakeDocument();
  const engine = new ReedDrone(
    (status, message) => {
      states.push(status);
      if (message) messages.push(message);
    },
    {
      createContext: () => {
        created += 1;
        return context as unknown as AudioContext;
      },
      document: documentTarget,
      windowTarget,
    },
  );
  return {
    context,
    states,
    messages,
    engine,
    documentTarget,
    created: () => created,
  };
}

function createdNodes(context: FakeContext): number {
  return (
    context.gains.length +
    context.oscillators.length +
    context.filters.length +
    context.sources.length +
    context.convolvers.length +
    context.compressors.length
  );
}

function masterGain(context: FakeContext) {
  const limiter = context.compressors[0];
  const master = context.gains.find((gain) =>
    gain.connections.includes(limiter),
  );
  assert.ok(master);
  return master;
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out');
}

void test('constructing the reed engine does not create an audio context', () => {
  const { engine, created } = setup();
  assert.equal(created(), 0);
  engine.dispose();
  assert.equal(created(), 0);
});

void test('a low reed starts on one context and centers the root', async () => {
  const { engine, context, states, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  assert.ok(states.includes('starting'));
  assert.equal(created(), 1);
  assert.equal(context.compressors.length, 1);
  const limiter = context.compressors[0];
  assert.equal(limiter.threshold.value, -1);
  assert.equal(limiter.knee.value, 0);
  assert.equal(limiter.ratio.value, 20);
  assert.equal(limiter.attack.value, 0.003);
  assert.equal(limiter.release.value, 0.08);
  assert.ok(limiter.connections.includes(context.destination));
  assert.equal(engine.nodeCount(), 28);
  assert.equal(createdNodes(context), 28);
  assert.deepEqual(
    context.oscillators.map((oscillator) => oscillator.starts),
    context.oscillators.map(() => [4.02]),
  );
  assert.deepEqual(context.sources[0].starts, [4.02]);
  const master = masterGain(context);
  assert.equal(master.gain.value, 0.15);
  const root = context.oscillators.filter(
    (oscillator) => oscillator.frequency.value === midiHz(45),
  );
  assert.deepEqual(
    root.map((oscillator) => oscillator.frequency.value),
    [midiHz(45), midiHz(45)],
  );
  assert.deepEqual(
    root.map((oscillator) => oscillator.detune.value).sort((a, b) => a - b),
    [-3.5, 3.5],
  );
  assert.equal(
    root.reduce((sum, oscillator) => sum + oscillator.detune.value, 0) /
      root.length,
    0,
  );
  const fifth = context.oscillators.filter(
    (oscillator) => oscillator.frequency.value === midiHz(52),
  );
  assert.equal(fifth.length, 2);
  assert.equal(
    fifth.reduce((sum, oscillator) => sum + oscillator.detune.value, 0),
    0,
  );
  assert.equal(
    context.params.some((param) =>
      param.events.some(
        (event) => event.method === 'exponential' && event.value === 0.9,
      ),
    ),
    true,
  );
  assert.equal(context.sources.length, 1);
  assert.equal(context.sources[0].loop, true);
  assert.ok(context.sources[0].buffer);
  assert.equal(context.sources[0].buffer.numberOfChannels, 1);
  assert.equal(context.sources[0].buffer.length, context.sampleRate);
  assert.equal(context.convolvers.length, 1);
  assert.equal(context.convolvers[0].normalize, false);
  assert.ok(context.convolvers[0].buffer);
  assert.equal(context.convolvers[0].buffer.numberOfChannels, 2);
  assert.equal(
    context.convolvers[0].buffer.length,
    Math.floor(context.sampleRate * 0.8),
  );
  assert.deepEqual(context.filters.map((filter) => filter.type).sort(), [
    'bandpass',
    'bandpass',
    'bandpass',
    'highpass',
    'lowpass',
  ]);
  assert.deepEqual(
    context.filters
      .map((filter) => filter.frequency.value)
      .sort((a, b) => a - b),
    [620, 740, 1280, 1800, 2140],
  );
  assert.deepEqual(
    context.filters.map((filter) => filter.Q.value).sort((a, b) => a - b),
    [0.45, 0.5, 4.4, 5.4, 6.2],
  );
  engine.dispose();
  assert.equal(context.closed, 0);
  assert.equal(context.stateListenerCount(), 0);
});

void test('a replay whose resume reports state immediately stays on the same context', async () => {
  const { engine, context, states, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  context.resume = () => {
    context.state = 'running';
    context.emitState();
    return Promise.resolve();
  };
  const mark = states.length;
  engine.play(lowRequest);
  await until(() => states.length > mark && states.at(-1) === 'playing');
  assert.deepEqual(states.slice(mark), ['starting', 'playing']);
  assert.equal(created(), 1);
  engine.dispose();
});

void test('playing again with the upper octave reuses the context', async () => {
  const { engine, context, states, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  const before = createdNodes(context);
  engine.play({ root: 'A', modeId: 'dorian', octave: 'layered' });
  await until(() => engine.nodeCount() === 34 && states.at(-1) === 'playing');
  assert.equal(created(), 1);
  assert.equal(createdNodes(context) - before, 32);
  engine.dispose();
});

void test('Locrian drones the octave with the same reed pair', async () => {
  const { engine, context, states } = setup();
  engine.play({ root: 'A', modeId: 'locrian', octave: 'low' });
  await until(() => states.at(-1) === 'playing');
  assert.equal(engine.nodeCount(), 28);
  assert.equal(createdNodes(context), 28);
  const frequencies = context.oscillators.map(
    (oscillator) => oscillator.frequency.value,
  );
  assert.equal(frequencies.includes(midiHz(45)), true);
  assert.equal(frequencies.includes(midiHz(57)), true);
  assert.equal(frequencies.includes(midiHz(52)), false);
  const root = context.oscillators.filter(
    (oscillator) => oscillator.frequency.value === midiHz(45),
  );
  assert.deepEqual(
    root.map((oscillator) => oscillator.detune.value).sort((a, b) => a - b),
    [-3.5, 3.5],
  );
  engine.dispose();
});

void test('retune waits for a real play, then moves to the new pitches on the same context', async () => {
  const { engine, context, states, created } = setup();
  engine.retune({ root: 'E', modeId: 'ionian', octave: 'low' });
  assert.equal(created(), 0);
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  const nodes = createdNodes(context);
  engine.retune(lowRequest);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(createdNodes(context), nodes);
  assert.equal(states.at(-1), 'playing');
  engine.retune({ root: 'E', modeId: 'ionian', octave: 'low' });
  await until(
    () => states.at(-1) === 'playing' && createdNodes(context) > nodes,
  );
  assert.equal(created(), 1);
  const live = context.oscillators
    .filter((oscillator) => oscillator.stops.length === 0)
    .map((oscillator) => oscillator.frequency.value);
  assert.equal(live.filter((frequency) => frequency === midiHz(40)).length, 2);
  assert.equal(live.filter((frequency) => frequency === midiHz(47)).length, 2);
  assert.equal(live.includes(midiHz(45)), false);
  assert.equal(live.includes(midiHz(52)), false);
  const stops = context.oscillators.map(
    (oscillator) => oscillator.stops.length,
  );
  const oldOscillators = context.oscillators.slice(0, 4);
  assert.ok(
    oldOscillators.every(
      (oscillator) => oscillator.stops[0] > oscillator.starts[0] + 0.1,
    ),
  );
  const envelopes = context.gains.filter((gain) =>
    gain.gain.events.some(
      (event) => event.method === 'exponential' && event.value === 0.9,
    ),
  );
  assert.equal(envelopes.length, 2);
  const faded = envelopes.find((gain) =>
    gain.gain.events.some(
      (event) => event.method === 'linear' && event.value === 0,
    ),
  );
  assert.ok(faded);
  const fadeIndex = faded.gain.events.findIndex(
    (event) => event.method === 'linear' && event.value === 0,
  );
  assert.equal(faded.gain.events[fadeIndex - 1]?.method, 'set');
  assert.equal(faded.gain.events[fadeIndex - 1]?.value, REED_GAINS.silence);
  assert.throws(() =>
    engine.retune({ root: 'H', modeId: 'dorian', octave: 'low' }),
  );
  assert.deepEqual(
    context.oscillators.map((oscillator) => oscillator.stops.length),
    stops,
  );
  assert.equal(states.at(-1), 'playing');
  engine.dispose();
});

void test('volume is stored before a context exists and clamps on the master ramp', async () => {
  const { engine, context, states } = setup();
  engine.setVolume(0.5);
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  const master = masterGain(context);
  assert.equal(master.gain.value, 0.075);
  engine.setVolume(2);
  assert.equal(
    master.gain.events.filter((event) => event.method === 'linear').at(-1)
      ?.value,
    0.15,
  );
  engine.setVolume(Number.NaN);
  assert.equal(
    master.gain.events.filter((event) => event.method === 'linear').at(-1)
      ?.value,
    0,
  );
  assert.equal(droneMasterGain(1), 0.15);
  assert.equal(droneMasterGain(100), 0.15);
  assert.equal(droneMasterGain(-4), 0);
  engine.dispose();
});

void test('hiding the document stops the reed and the next play resumes the same context', async () => {
  const { engine, context, states, documentTarget, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  documentTarget.emit('visibilitychange');
  assert.equal(states.at(-1), 'playing');
  documentTarget.hidden = true;
  documentTarget.emit('visibilitychange');
  assert.equal(states.at(-1), 'idle');
  assert.ok(
    context.oscillators.every((oscillator) => oscillator.stops.length > 0),
  );
  assert.equal(created(), 1);
  assert.equal(context.closed, 0);
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  assert.equal(created(), 1);
  engine.dispose();
});

void test('pagehide stops playback and does not create a context by itself', async () => {
  const windowTarget = new FakeDocument();
  const { engine, context, states, created } = setup(windowTarget);
  windowTarget.emit('pagehide');
  assert.equal(created(), 0);
  assert.equal(context.closed, 0);
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  windowTarget.emit('pagehide');
  assert.equal(states.at(-1), 'idle');
  assert.equal(created(), 1);
  assert.equal(context.closed, 0);
  engine.dispose();
});

void test('an interrupted context stops, and the next play resumes it', async () => {
  const { engine, context, states, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  context.state = 'interrupted';
  context.emitState();
  assert.equal(states.at(-1), 'idle');
  assert.equal(created(), 1);
  assert.equal(context.closed, 0);
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  assert.equal(created(), 1);
  engine.dispose();
});

void test('a rejected resume can be retried on the next play', async () => {
  const harness = setup();
  harness.context.resume = () => Promise.reject(new Error('blocked'));
  harness.engine.play(lowRequest);
  await until(() => harness.states.at(-1) === 'error');
  assert.equal(
    harness.messages.at(-1),
    'Audio didn\u2019t start. Tap play to try again.',
  );
  assert.equal(harness.created(), 1);
  harness.context.resume = () => Promise.resolve();
  harness.engine.play(lowRequest);
  await until(() => harness.states.at(-1) === 'playing');
  assert.equal(harness.created(), 1);
  harness.engine.dispose();
});

void test('stop goes idle without closing, and stop before play creates nothing', async () => {
  const idle = setup();
  idle.engine.stop();
  assert.equal(idle.created(), 0);
  assert.equal(idle.context.closed, 0);
  assert.equal(idle.states.at(-1), 'idle');
  idle.engine.dispose();

  const { engine, context, states, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  engine.stop();
  assert.equal(states.at(-1), 'idle');
  assert.equal(context.closed, 0);
  assert.equal(created(), 1);
  assert.equal(
    context.params.some((param) =>
      param.events.some(
        (event) => event.method === 'linear' && event.value === 0,
      ),
    ),
    true,
  );
  engine.stop();
  assert.equal(context.closed, 0);
  engine.dispose();
  assert.equal(context.closed, 0);
});

void test('a short stop schedules the oscillators to end with the cut fade', async () => {
  const { engine, context, states } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  engine.stop(REED_TIMING.hideFade);
  const end = context.currentTime + REED_TIMING.hideFade + REED_TIMING.stopTail;
  assert.ok(context.oscillators.length > 0);
  assert.ok(
    context.oscillators.every((oscillator) => oscillator.stops.includes(end)),
  );
  engine.dispose();
});

void test('dispose closes a context the reed created and leaves a passed-in context open', async () => {
  const passed = setup();
  passed.engine.play(lowRequest);
  await until(() => passed.states.at(-1) === 'playing');
  const sharedMaster = masterGain(passed.context);
  const sharedLimiter = passed.context.compressors[0];
  passed.engine.dispose();
  assert.equal(passed.context.closed, 0);
  assert.equal(passed.context.stateListenerCount(), 0);
  assert.equal(sharedMaster.disconnected, false);
  assert.equal(sharedLimiter.disconnected, false);
  assert.equal(
    sharedLimiter.connections.includes(passed.context.destination),
    true,
  );
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sharedMaster.disconnected, true);
  assert.equal(sharedLimiter.disconnected, true);
  assert.equal(passed.context.closed, 0);
  assert.equal(
    sharedLimiter.connections.includes(passed.context.destination),
    false,
  );

  const owned = new FakeContext();
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = function AudioContext() {
    return owned;
  } as unknown as typeof AudioContext;
  try {
    const states: DroneStatus[] = [];
    const engine = new ReedDrone((status) => {
      states.push(status);
    });
    engine.play(lowRequest);
    await until(() => states.at(-1) === 'playing');
    assert.equal(owned.closed, 0);
    engine.dispose();
    assert.equal(owned.closed, 0);
    assert.equal(owned.stateListenerCount(), 0);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(owned.closed, 1);
  } finally {
    globalThis.AudioContext = previous;
  }
});

function envelopeGains(context: FakeContext) {
  return context.gains.filter((gain) =>
    gain.gain.events.some(
      (event) =>
        event.method === 'exponential' && event.value === REED_GAINS.envelope,
    ),
  );
}

function rampOf(param: Param): GainRamp {
  const set = param.events.find((event) => event.method === 'set');
  const exponential = param.events.find(
    (event) => event.method === 'exponential',
  );
  assert.ok(set);
  assert.ok(exponential);
  return {
    start: set.value,
    target: exponential.value,
    startTime: set.time,
    endTime: exponential.time,
  };
}

/** Sample the scheduled envelope. The fade holds the anchor for one sample. */
function maxSampleStep(param: Param, now: number): number {
  const ramp = rampOf(param);
  const hold = param.events.find((event) => event.method === 'hold');
  const cancel = param.events.find((event) => event.method === 'cancel');
  const linear = [...param.events]
    .reverse()
    .find((event) => event.method === 'linear' && event.value === 0);
  const anchor = param.events.find(
    (event) => event.method === 'set' && Math.abs(event.time - now) < 1e-8,
  );
  assert.ok(linear);
  const sampleRate = 48000;
  const fadeAt = now + 1 / sampleRate;
  const from = now - 0.01;
  const to = linear.time + 0.005;
  const at = (time: number) => {
    if (hold) {
      if (time <= hold.time) return exponentialRampValue(ramp, time);
      const held = exponentialRampValue(ramp, hold.time);
      if (time >= linear.time) return linear.value;
      const progress = (time - hold.time) / (linear.time - hold.time);
      return held + (linear.value - held) * progress;
    }
    assert.ok(cancel);
    assert.ok(anchor);
    if (time < now) return exponentialRampValue(ramp, time);
    if (time < fadeAt) return anchor.value;
    if (time >= linear.time) return linear.value;
    const progress = (time - fadeAt) / (linear.time - fadeAt);
    return anchor.value + (linear.value - anchor.value) * progress;
  };
  let previous = at(from);
  let max = 0;
  for (let time = from + 1 / sampleRate; time <= to; time += 1 / sampleRate) {
    const value = at(time);
    max = Math.max(max, Math.abs(value - previous));
    previous = value;
  }
  return max;
}

function assertAnchored(
  param: Param,
  now: number,
  expected: number,
  releaseEnd: number,
) {
  assert.equal(
    param.events.some((event) => event.method === 'hold'),
    false,
  );
  const cancel = param.events.find((event) => event.method === 'cancel');
  const anchor = param.events.find(
    (event) => event.method === 'set' && Math.abs(event.time - now) < 1e-8,
  );
  const fadeAt = now + 1 / 48000;
  const fade = param.events.find(
    (event) => event.method === 'set' && Math.abs(event.time - fadeAt) < 1e-8,
  );
  const linear = [...param.events]
    .reverse()
    .find((event) => event.method === 'linear' && event.value === 0);
  assert.ok(cancel);
  assert.ok(anchor);
  assert.ok(fade);
  assert.ok(linear);
  assert.equal(cancel.time, now);
  assert.equal(anchor.value, expected);
  assert.equal(fade.value, expected);
  assert.ok(Math.abs(linear.time - releaseEnd) < 1e-9);
  assert.ok(maxSampleStep(param, now) < 1e-3);
}

async function assertMidSwellKeyChange(removeHold: boolean) {
  const holdKey = 'cancelAndHoldAtTime';
  const descriptor = Object.getOwnPropertyDescriptor(Param.prototype, holdKey);
  if (removeHold) {
    delete (Param.prototype as unknown as Record<string, unknown>)[holdKey];
  }
  try {
    const { engine, context, states } = setup();
    engine.play(lowRequest);
    await until(() => states.at(-1) === 'playing');
    const swell = envelopeGains(context);
    assert.equal(swell.length, 1);
    context.currentTime = 4.02 + 1.5;
    const duringSwell = context.currentTime;
    const swellRamp = rampOf(swell[0].gain);
    const swellValue = exponentialRampValue(swellRamp, duringSwell);
    assert.ok(swellValue > 0.45 && swellValue < 0.6);
    swell[0].gain.value = REED_GAINS.silence;
    engine.retune({ root: 'E', modeId: 'ionian', octave: 'low' });
    await until(
      () => states.at(-1) === 'playing' && envelopeGains(context).length === 2,
    );
    assertAnchored(
      swell[0].gain,
      duringSwell,
      swellValue,
      duringSwell + 0.02 + Math.max(REED_TIMING.switchFade, 0.015),
    );

    const switched = envelopeGains(context).find((gain) => {
      const ramp = rampOf(gain.gain);
      return (
        Math.abs(ramp.endTime - ramp.startTime - REED_TIMING.switchAttack) <
        1e-9
      );
    });
    assert.ok(switched);
    context.currentTime = duringSwell + 0.02 + 0.1;
    const duringSwitch = context.currentTime;
    const switchValue = exponentialRampValue(
      rampOf(switched.gain),
      duringSwitch,
    );
    switched.gain.value = REED_GAINS.silence;
    engine.retune({ root: 'D', modeId: 'dorian', octave: 'low' });
    await until(
      () => states.at(-1) === 'playing' && envelopeGains(context).length === 3,
    );
    assertAnchored(
      switched.gain,
      duringSwitch,
      switchValue,
      duringSwitch + 0.02 + Math.max(REED_TIMING.switchFade, 0.015),
    );
    engine.dispose();
  } finally {
    if (removeHold && descriptor) {
      Object.defineProperty(Param.prototype, holdKey, descriptor);
    }
  }
}

void test('a mid-swell key change anchors the computed ramp when cancelAndHoldAtTime exists', async () => {
  await assertMidSwellKeyChange(false);
});

void test('a mid-swell key change anchors the computed ramp when cancelAndHoldAtTime is missing', async () => {
  await assertMidSwellKeyChange(true);
});

void test('the reed fade never calls cancelAndHoldAtTime', () => {
  const source = readFileSync(
    new URL('../lib/drone-audio.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(source, /cancelAndHoldAtTime\s*\(/);
});

void test('the computed envelope stays at the steady level after the swell', () => {
  const ramp: GainRamp = {
    start: REED_GAINS.silence,
    target: REED_GAINS.envelope,
    startTime: 1,
    endTime: 1 + REED_TIMING.playAttack,
  };
  const later = ramp.endTime + 2;
  const progress = (later - ramp.startTime) / (ramp.endTime - ramp.startTime);
  const extrapolated = ramp.start * (ramp.target / ramp.start) ** progress;
  assert.ok(extrapolated > ramp.target);
  assert.equal(exponentialRampValue(ramp, later), ramp.target);
  assert.equal(exponentialRampValue(ramp, ramp.endTime), ramp.target);
  assert.equal(exponentialRampValue(ramp, ramp.startTime), ramp.start);
});

void test('a stop after the swell anchors the steady level for key change, toggle off, and view leave', async () => {
  const cases: { fade: number; stopDelay: number }[] = [
    { fade: REED_TIMING.switchFade, stopDelay: 0.02 },
    { fade: REED_TIMING.stopFade, stopDelay: 0 },
    { fade: REED_TIMING.hideFade, stopDelay: 0 },
  ];
  for (const item of cases) {
    const { engine, context, states } = setup();
    engine.play(lowRequest);
    await until(() => states.at(-1) === 'playing');
    const swell = envelopeGains(context);
    assert.equal(swell.length, 1);
    const ramp = rampOf(swell[0].gain);
    const past = ramp.endTime + 0.75;
    context.currentTime = past;
    assert.equal(exponentialRampValue(ramp, past), REED_GAINS.envelope);
    swell[0].gain.value = REED_GAINS.silence;
    if (item.stopDelay > 0) {
      engine.retune({ root: 'E', modeId: 'ionian', octave: 'low' });
      await until(() => envelopeGains(context).length === 2);
    } else engine.stop(item.fade);
    const releaseEnd = past + item.stopDelay + Math.max(item.fade, 0.015);
    assertAnchored(swell[0].gain, past, REED_GAINS.envelope, releaseEnd);
    engine.dispose();
  }
});

void test('a stop before the swell anchor writes silence instead of holding unity gain', async () => {
  const { engine, context, states } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  assert.equal(context.currentTime, 4);
  engine.stop(REED_TIMING.hideFade);
  const envelope = envelopeGains(context)[0]?.gain;
  assert.ok(envelope);
  assert.equal(
    envelope.events.some((event) => event.method === 'hold'),
    false,
  );
  const anchor = envelope.events.find(
    (event) => event.method === 'set' && Math.abs(event.time - 4) < 1e-8,
  );
  const fade = envelope.events.find(
    (event) =>
      event.method === 'set' && Math.abs(event.time - (4 + 1 / 48000)) < 1e-8,
  );
  assert.ok(anchor);
  assert.ok(fade);
  assert.equal(anchor.value, REED_GAINS.silence);
  assert.equal(fade.value, REED_GAINS.silence);
  engine.dispose();
});

void test('dispose waits out a fade that is already running', async () => {
  const { engine, context, states } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  const master = masterGain(context);
  const limiter = context.compressors[0];
  engine.stop();
  engine.dispose();
  assert.equal(master.disconnected, false);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(master.disconnected, false);
  assert.equal(limiter.disconnected, false);
  assert.equal(context.closed, 0);
  await new Promise((resolve) => setTimeout(resolve, 560));
  assert.equal(master.disconnected, true);
  assert.equal(limiter.disconnected, true);
  assert.equal(context.closed, 0);
});

void test('an unknown root throws before a context is created', () => {
  const { engine, states, created } = setup();
  assert.throws(() =>
    engine.play({ root: 'H', modeId: 'dorian', octave: 'low' }),
  );
  assert.equal(created(), 0);
  assert.deepEqual(states, []);
  engine.dispose();
});

function sessionRig() {
  const context = new FakeContext();
  let resumes = 0;
  const original = context.resume;
  context.resume = () => {
    resumes += 1;
    return original();
  };
  let created = 0;
  const documentTarget = new FakeDocument();
  const windowTarget = new FakeDocument();
  const controller = new ExploreDrone(
    (onStatus) =>
      new ReedDrone(onStatus, {
        createContext: () => {
          created += 1;
          return context as unknown as AudioContext;
        },
        document: documentTarget,
        windowTarget,
      }),
    lowRequest,
  );
  controller.setActive(true);
  return {
    context,
    controller,
    documentTarget,
    windowTarget,
    created: () => created,
    resumes: () => resumes,
  };
}

async function hear(controller: ExploreDrone, context: FakeContext) {
  controller.toggle();
  await until(
    () => controller.snapshot().pressed && context.oscillators.length > 0,
  );
}

function assertOff(
  controller: ExploreDrone,
  context: FakeContext,
  resumeCount: number,
  oscillators: number,
  resumes: () => number,
) {
  const shot = controller.snapshot();
  assert.equal(shot.pressed, false);
  assert.equal(droneControlName(shot.pressed), 'Drone, off');
  assert.equal(context.oscillators.length, oscillators);
  assert.equal(
    context.oscillators.every((node) => node.stops.length > 0),
    true,
  );
  assert.equal(resumes(), resumeCount);
}

async function assertTapStarts(
  controller: ExploreDrone,
  context: FakeContext,
  resumes: () => number,
) {
  const before = context.oscillators.length;
  const heard = resumes();
  controller.toggle();
  await until(() => context.oscillators.length > before);
  assert.equal(controller.snapshot().pressed, true);
  assert.equal(droneControlName(true), 'Drone, on');
  assert.ok(resumes() > heard);
}

void test('leaving Explore and coming back leaves the drone off until a tap', async () => {
  const { controller, context, resumes } = sessionRig();
  await hear(controller, context);
  const oscillators = context.oscillators.length;
  const heard = resumes();
  controller.setActive(false);
  controller.setActive(true);
  assertOff(controller, context, heard, oscillators, resumes);
  await assertTapStarts(controller, context, resumes);
  controller.dispose();
});

void test('hiding the tab and showing it leaves the drone off until a tap', async () => {
  const { controller, context, documentTarget, resumes } = sessionRig();
  await hear(controller, context);
  const oscillators = context.oscillators.length;
  const heard = resumes();
  documentTarget.hidden = true;
  controller.setHidden(true);
  documentTarget.emit('visibilitychange');
  documentTarget.hidden = false;
  documentTarget.emit('visibilitychange');
  controller.setHidden(false);
  assertOff(controller, context, heard, oscillators, resumes);
  await assertTapStarts(controller, context, resumes);
  controller.dispose();
});

void test('an interrupted context leaves the drone off, and a scale change stays silent', async () => {
  const { controller, context, resumes } = sessionRig();
  await hear(controller, context);
  const oscillators = context.oscillators.length;
  const heard = resumes();
  context.state = 'suspended';
  context.emitState();
  assertOff(controller, context, heard, oscillators, resumes);
  controller.setRequest({ root: 'C', modeId: 'ionian', octave: 'low' });
  assertOff(controller, context, heard, oscillators, resumes);
  await assertTapStarts(controller, context, resumes);
  controller.dispose();
});

void test('a failed start stays off, and a scale change does not retry it', async () => {
  const { controller, context } = sessionRig();
  context.resume = () => Promise.reject(new Error('blocked'));
  controller.toggle();
  await until(() => (controller.snapshot().message ?? '').includes('Tap play'));
  assert.equal(controller.snapshot().pressed, false);
  assert.equal(droneControlName(false), 'Drone, off');
  const oscillators = context.oscillators.length;
  controller.setRequest({ root: 'C', modeId: 'ionian', octave: 'low' });
  assert.equal(context.oscillators.length, oscillators);
  assert.equal(controller.snapshot().pressed, false);
  context.resume = () => Promise.resolve();
  controller.toggle();
  await until(
    () =>
      context.oscillators.length > oscillators && controller.snapshot().pressed,
  );
  assert.equal(droneControlName(true), 'Drone, on');
  controller.dispose();
});

void test('a bfcache restore leaves the drone off until a tap', async () => {
  const { controller, context, windowTarget, resumes } = sessionRig();
  await hear(controller, context);
  const oscillators = context.oscillators.length;
  const heard = resumes();
  windowTarget.emit('pagehide');
  controller.restoreFromCache();
  controller.setActive(true);
  assertOff(controller, context, heard, oscillators, resumes);
  await assertTapStarts(controller, context, resumes);
  controller.dispose();
});
