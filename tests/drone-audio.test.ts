import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReedDrone, type DroneStatus, type ReedRequest } from '../lib/drone-audio.ts';
import { midiHz } from '../lib/drone.ts';

class Param {
  value = 0;
  events: { method: string; value: number }[] = [];
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value;
    this.events.push({ method: 'set', value });
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
    this.events.push({ method: 'linear', value });
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
    this.events.push({ method: 'exponential', value });
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
    this.channels = Array.from({ length: channels }, () => new Float32Array(length));
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
  connect(next: unknown) {
    this.connections.push(next);
    return next;
  }
  disconnect() {}
}

class FakeContext {
  state = 'running';
  currentTime = 4;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  closed = 0;
  oscillators: Oscillator[] = [];
  sources: BufferSource[] = [];
  compressors: Compressor[] = [];
  gains: (FakeNode & { gain: Param })[] = [];
  filters: (FakeNode & { frequency: Param; Q: Param; type: string })[] = [];
  convolvers: (FakeNode & { normalize: boolean; buffer: FakeBuffer | null })[] = [];
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
  const master = context.gains.find((gain) => gain.connections.includes(limiter));
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

void test('a low reed starts on one context, centers the root, and closes on dispose', async () => {
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
  assert.equal(master.gain.value, 0.3);
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
    root.reduce((sum, oscillator) => sum + oscillator.detune.value, 0) / root.length,
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
      param.events.some((event) => event.method === 'exponential' && event.value === 0.9),
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
  assert.equal(context.convolvers[0].buffer.length, Math.floor(context.sampleRate * 0.8));
  assert.deepEqual(
    context.filters.map((filter) => filter.type).sort(),
    ['bandpass', 'bandpass', 'bandpass', 'highpass', 'lowpass'],
  );
  assert.deepEqual(
    context.filters.map((filter) => filter.frequency.value).sort((a, b) => a - b),
    [620, 740, 1280, 1800, 2140],
  );
  assert.deepEqual(
    context.filters.map((filter) => filter.Q.value).sort((a, b) => a - b),
    [0.45, 0.5, 4.4, 5.4, 6.2],
  );
  engine.dispose();
  assert.equal(context.closed, 1);
});

void test('a replay whose resume reports state immediately stays on the same context', async () => {
  const { engine, context, states, created } = setup();
  engine.play(lowRequest);
  await until(() => states.at(-1) === 'playing');
  context.resume = () => {
    context.state = 'running';
    context.onstatechange?.();
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
  const frequencies = context.oscillators.map((oscillator) => oscillator.frequency.value);
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
  await until(() => states.at(-1) === 'playing' && createdNodes(context) > nodes);
  assert.equal(created(), 1);
  const live = context.oscillators
    .filter((oscillator) => oscillator.stops.length === 0)
    .map((oscillator) => oscillator.frequency.value);
  assert.equal(live.filter((frequency) => frequency === midiHz(40)).length, 2);
  assert.equal(live.filter((frequency) => frequency === midiHz(47)).length, 2);
  assert.equal(live.includes(midiHz(45)), false);
  assert.equal(live.includes(midiHz(52)), false);
  const stops = context.oscillators.map((oscillator) => oscillator.stops.length);
  assert.throws(() => engine.retune({ root: 'H', modeId: 'dorian', octave: 'low' }));
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
  assert.equal(master.gain.value, 0.15);
  engine.setVolume(2);
  assert.equal(
    master.gain.events.filter((event) => event.method === 'linear').at(-1)?.value,
    0.3,
  );
  engine.setVolume(Number.NaN);
  assert.equal(
    master.gain.events.filter((event) => event.method === 'linear').at(-1)?.value,
    0,
  );
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
  assert.ok(context.oscillators.every((oscillator) => oscillator.stops.length > 0));
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
  context.onstatechange?.();
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
  assert.equal(harness.messages.at(-1), 'Audio didn\u2019t start. Tap play to try again.');
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
      param.events.some((event) => event.method === 'linear' && event.value === 0),
    ),
    true,
  );
  engine.stop();
  assert.equal(context.closed, 0);
  engine.dispose();
  assert.equal(context.closed, 1);
});

void test('an unknown root throws before a context is created', () => {
  const { engine, states, created } = setup();
  assert.throws(() => engine.play({ root: 'H', modeId: 'dorian', octave: 'low' }));
  assert.equal(created(), 0);
  assert.deepEqual(states, []);
  engine.dispose();
});
