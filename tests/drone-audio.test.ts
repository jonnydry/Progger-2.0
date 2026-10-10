import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRONE_DUCK_GAIN,
  DRONE_LIMITER,
  DRONE_MAX_LINEAR_GAIN,
  DroneEngine,
  type DronePatch,
  type DroneStatus,
} from '../lib/drone-audio.ts';
import { midiHz, scaleWalk } from '../lib/drone.ts';

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
  buffer: unknown = null;
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

class FakeContext {
  state = 'running';
  currentTime = 4;
  sampleRate = 48000;
  destination = new FakeNode();
  onstatechange: (() => void) | null = null;
  closed = 0;
  oscillators: Oscillator[] = [];
  sources: BufferSource[] = [];
  compressors: { threshold: Param; knee: Param; ratio: Param; attack: Param; release: Param }[] =
    [];
  gains: (FakeNode & { gain: Param })[] = [];
  params: Param[] = [];
  resume = () => Promise.resolve();
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
    return Object.assign(new FakeNode(), { frequency, Q, type: '' });
  }
  createDynamicsCompressor() {
    const compressor = {
      threshold: new Param(),
      knee: new Param(),
      ratio: new Param(),
      attack: new Param(),
      release: new Param(),
      connect: (next: unknown) => next,
      disconnect() {},
    };
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
    return Object.assign(new FakeNode(), { normalize: true, buffer: null as unknown });
  }
  createPeriodicWave() {
    return {};
  }
  createBuffer(channels: number, length: number, sampleRate: number) {
    return new FakeBuffer(channels, length, sampleRate);
  }
  decodeAudioData() {
    const buffer = new FakeBuffer(1, 24000, this.sampleRate);
    for (let i = 0; i < buffer.length; i += 1) {
      buffer.channels[0][i] = Math.sin(i / 20) * 0.4;
    }
    return Promise.resolve(buffer);
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

const bowPatch: DronePatch = {
  sound: 'bow',
  root: 'A',
  modeId: 'dorian',
  octave: 'low',
  volume: 1,
};

function setup(patch: DronePatch = bowPatch) {
  const context = new FakeContext();
  const states: DroneStatus[] = [];
  const messages: string[] = [];
  const walks: (number | null)[] = [];
  const fetched: string[] = [];
  let created = 0;
  const documentTarget = new FakeDocument();
  const engine = new DroneEngine(
    (status, message) => {
      states.push(status);
      if (message) messages.push(message);
    },
    (index) => walks.push(index),
    {
      createContext: () => {
        created += 1;
        return context as unknown as AudioContext;
      },
      fetchImpl: (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        fetched.push(url);
        return Promise.resolve(new Response(new Uint8Array([1, 2, 3, 4])));
      },
      document: documentTarget,
      windowTarget: null,
    },
  );
  return {
    context,
    states,
    messages,
    walks,
    fetched,
    engine,
    documentTarget,
    created: () => created,
    patch,
  };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('timed out');
}

void test('importing and constructing the lab engine does not create an AudioContext', async () => {
  const { engine, created } = setup();
  assert.equal(created(), 0);
  engine.dispose();
});

void test('bowed drone starts on play, reuses one context, and centers detune on the root', async () => {
  const { engine, context, states, created } = setup();
  engine.play(bowPatch);
  await until(() => states.at(-1) === 'playing');
  assert.equal(created(), 1);
  assert.equal(context.compressors.length, 1);
  const limiter = context.compressors[0];
  assert.equal(limiter.threshold.value, DRONE_LIMITER.threshold);
  assert.equal(limiter.knee.value, 0);
  assert.equal(limiter.ratio.value, 20);
  assert.equal(engine.nodeCount(), 26);
  const root = context.oscillators.filter(
    (oscillator) => Math.abs(oscillator.frequency.value - midiHz(45)) < 1e-6,
  );
  assert.deepEqual(
    root.map((oscillator) => oscillator.detune.value).sort((a, b) => a - b),
    [-6, -2, 2, 6],
  );
  assert.deepEqual(
    root.map((oscillator) => oscillator.type).sort(),
    ['sawtooth', 'sawtooth', 'triangle', 'triangle'],
  );
  const fifth = context.oscillators.filter(
    (oscillator) => Math.abs(oscillator.frequency.value - midiHz(52)) < 1e-6,
  );
  assert.equal(fifth.length, 4);
  assert.equal(
    fifth.reduce((sum, oscillator) => sum + oscillator.detune.value, 0),
    0,
  );
  const master = context.gains.find((gain) => gain.gain.value === DRONE_MAX_LINEAR_GAIN);
  assert.ok(master);
  engine.play({ ...bowPatch, octave: 'layered' });
  await until(() => engine.nodeCount() === 36);
  assert.equal(created(), 1);
  engine.dispose();
  assert.equal(context.closed, 1);
});

void test('Locrian drones the octave and the reed uses a symmetric pair', async () => {
  const { engine, context, states } = setup();
  engine.play({ ...bowPatch, modeId: 'locrian', sound: 'reed' });
  await until(() => states.at(-1) === 'playing');
  assert.equal(engine.nodeCount(), 29);
  const frequencies = context.oscillators.map((oscillator) => oscillator.frequency.value);
  assert.ok(frequencies.some((frequency) => Math.abs(frequency - midiHz(45)) < 1e-6));
  assert.ok(frequencies.some((frequency) => Math.abs(frequency - midiHz(57)) < 1e-6));
  assert.equal(
    frequencies.some((frequency) => Math.abs(frequency - midiHz(52)) < 1e-6),
    false,
  );
  const root = context.oscillators.filter(
    (oscillator) => Math.abs(oscillator.frequency.value - midiHz(45)) < 1e-6,
  );
  assert.deepEqual(
    root.map((oscillator) => oscillator.detune.value).sort((a, b) => a - b),
    [-3.5, 3.5],
  );
  engine.dispose();
});

void test('cello samples are fetched only when requested and play at the written pitch', async () => {
  const { engine, context, states, fetched, created } = setup();
  engine.play(bowPatch);
  await until(() => states.at(-1) === 'playing');
  assert.equal(fetched.length, 0);
  await engine.loadCello();
  assert.equal(created(), 1);
  assert.equal(fetched.length, 5);
  assert.ok(fetched.every((url) => url.startsWith('/audio/drone/cello-')));
  engine.play({ ...bowPatch, sound: 'cello' });
  await until(() => context.sources.some((source) => source.loop && source.playbackRate.value === 1));
  assert.equal(engine.nodeCount(), 13);
  const looped = context.sources.filter(
    (source) => source.loop && source.starts.length > 0 && source.stops.length === 0,
  );
  assert.deepEqual(
    looped.map((source) => source.playbackRate.value).sort((a, b) => a - b),
    [1, 1],
  );
  engine.dispose();
});

void test('walk notes duck the drone and use the lab pluck, not a second context', async () => {
  const { engine, context, states, walks, created } = setup();
  engine.play(bowPatch);
  await until(() => states.at(-1) === 'playing');
  const before = context.oscillators.length;
  engine.walk(bowPatch);
  await until(() => walks.includes(0));
  assert.equal(created(), 1);
  const pluck = context.oscillators.slice(before).find(
    (oscillator) => Math.abs(oscillator.frequency.value - scaleWalk('A', 'dorian')[0].midi) < 1
      || Math.abs(oscillator.frequency.value - midiHz(scaleWalk('A', 'dorian')[0].midi)) < 1e-6,
  );
  assert.ok(pluck);
  assert.equal(pluck.frequency.value, midiHz(69));
  const ducked = context.params.some((param) =>
    param.events.some(
      (event) => event.method === 'linear' && Math.abs(event.value - DRONE_DUCK_GAIN) < 1e-6,
    ),
  );
  assert.equal(ducked, true);
  engine.walk(bowPatch);
  assert.equal(walks.at(-1), null);
  engine.dispose();
});

void test('hiding the page or an interrupted context stops playback', async () => {
  const { engine, context, states, documentTarget } = setup();
  engine.play(bowPatch);
  await until(() => states.at(-1) === 'playing');
  documentTarget.hidden = true;
  documentTarget.emit('visibilitychange');
  assert.equal(states.at(-1), 'idle');
  assert.ok(context.oscillators.every((oscillator) => oscillator.stops.length > 0));
  engine.play(bowPatch);
  await until(() => states.at(-1) === 'playing');
  context.state = 'interrupted';
  context.onstatechange?.();
  assert.equal(states.at(-1), 'idle');
  engine.dispose();
});

void test('a failed resume can be retried on the next tap', async () => {
  const harness = setup();
  harness.context.resume = () => Promise.reject(new Error('blocked'));
  harness.engine.play(bowPatch);
  await until(() => harness.states.at(-1) === 'error');
  harness.context.resume = () => Promise.resolve();
  harness.engine.play(bowPatch);
  await until(() => harness.states.at(-1) === 'playing');
  harness.engine.dispose();
});
