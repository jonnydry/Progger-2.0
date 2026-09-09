import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoicingPlayer, type AuditionState } from '../lib/voicing-audio.ts';

const C_MAJOR = [null, 3, 2, 0, 1, 0];

class Parameter {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
}
class Node {
  disconnected = false;
  connect<T>(next: T): T {
    return next;
  }
  disconnect() {
    this.disconnected = true;
  }
}
class Oscillator extends Node {
  frequency = new Parameter();
  onended: (() => void) | null = null;
  starts: number[] = [];
  stops: number[] = [];
  setPeriodicWave() {}
  start(at: number) {
    this.starts.push(at);
  }
  stop(at: number) {
    this.stops.push(at);
  }
  finish() {
    this.onended?.();
  }
}
class Context {
  state = 'running';
  currentTime = 1;
  sampleRate = 48000;
  destination = new Node();
  onstatechange: (() => void) | null = null;
  oscillators: Oscillator[] = [];
  nodes: Node[] = [];
  closed = 0;
  resume = () => Promise.resolve();
  close() {
    this.closed++;
    this.state = 'closed';
    return Promise.resolve();
  }
  createGain() {
    const node = Object.assign(new Node(), { gain: new Parameter() });
    this.nodes.push(node);
    return node;
  }
  createBiquadFilter() {
    const node = Object.assign(new Node(), {
      frequency: new Parameter(),
      Q: new Parameter(),
      type: '',
    });
    this.nodes.push(node);
    return node;
  }
  createPeriodicWave() {
    return {};
  }
  createOscillator() {
    const node = new Oscillator();
    this.oscillators.push(node);
    this.nodes.push(node);
    return node;
  }
}
function setup() {
  const context = new Context();
  const states: AuditionState[] = [];
  let created = 0;
  const player = new VoicingPlayer(
    (state) => states.push(state),
    () => {
      created++;
      return context as unknown as AudioContext;
    },
  );
  return { context, states, player, created: () => created };
}

void test('audio is lazy and the exact displayed string voices end naturally', async () => {
  const { player, context, states, created } = setup();
  assert.equal(created(), 0);
  await player.play(C_MAJOR);
  assert.equal(created(), 1);
  assert.equal(context.oscillators.length, 5);
  assert.equal(states.at(-1), 'playing');
  for (const voice of context.oscillators.slice(0, -1)) voice.finish();
  assert.equal(states.at(-1), 'playing', 'wait for the final string tail');
  context.oscillators.at(-1)!.finish();
  assert.equal(states.at(-1), 'idle');
  assert.ok(context.nodes.every((node) => node.disconnected));
  player.dispose();
});

void test('stop cancels pending resume without waiting for the browser', async () => {
  const { player, context, states } = setup();
  let resume!: () => void;
  context.resume = () =>
    new Promise<void>((resolve) => {
      resume = resolve;
    });
  const pending = player.play(C_MAJOR);
  assert.equal(states.at(-1), 'starting');
  player.stop();
  await pending;
  assert.equal(states.at(-1), 'idle');
  resume();
  await Promise.resolve();
  assert.equal(context.oscillators.length, 0, 'late resume cannot start sound');
  player.dispose();
});

void test('replay cancels old audio and old endings cannot reset new playback', async () => {
  const { player, context, states, created } = setup();
  await player.play(C_MAJOR);
  const old = [...context.oscillators];
  await player.play([3, 2, 0, 0, 0, 3]);
  assert.equal(created(), 1, 'reuse the user-unlocked context');
  assert.ok(old.every((voice) => voice.stops.length === 2));
  old.forEach((voice) => voice.finish());
  assert.equal(states.at(-1), 'playing');
  context.oscillators.slice(old.length).forEach((voice) => voice.finish());
  assert.equal(states.at(-1), 'idle');
  player.dispose();
});

void test('disposal during resume prevents late sound and further notifications', async () => {
  const { player, context, states } = setup();
  let resume!: () => void;
  context.resume = () =>
    new Promise<void>((resolve) => {
      resume = resolve;
    });
  const pending = player.play(C_MAJOR);
  player.dispose();
  const snapshot = [...states];
  await pending;
  resume();
  await player.play(C_MAJOR);
  assert.equal(context.closed, 1);
  assert.equal(context.oscillators.length, 0);
  assert.deepEqual(states, snapshot);
});

void test('failed resume reports an error and the next user gesture can retry', async () => {
  const { player, context, states } = setup();
  context.resume = () => Promise.reject(new Error('Playback blocked'));
  await player.play(C_MAJOR);
  assert.equal(states.at(-1), 'error');
  assert.equal(context.oscillators.length, 0);
  context.resume = () => Promise.resolve();
  await player.play(C_MAJOR);
  assert.equal(states.at(-1), 'playing');
  player.dispose();
});

void test('audio suspension ends the playing state', async () => {
  const { player, context, states } = setup();
  await player.play(C_MAJOR);
  context.state = 'suspended';
  context.onstatechange?.();
  assert.equal(states.at(-1), 'idle');
  assert.ok(context.oscillators.every((voice) => voice.stops.length === 2));
  player.dispose();
});

void test('a newer gesture wins when an older browser resume finishes last', async () => {
  const { player, context, states } = setup();
  let releaseOld!: () => void;
  context.resume = () =>
    new Promise<void>((resolve) => {
      releaseOld = resolve;
    });
  const oldRun = player.play(C_MAJOR);
  context.resume = () => Promise.resolve();
  await player.play([3, 2, 0, 0, 0, 3]);
  await oldRun;
  releaseOld();
  await Promise.resolve();
  assert.equal(context.oscillators.length, 6);
  assert.equal(states.at(-1), 'playing');
  player.dispose();
});

void test('a graph failure before the first voice releases the bus and permits retry', async () => {
  const { player, context, states } = setup();
  const createOscillator = context.createOscillator.bind(context);
  context.createOscillator = () => {
    throw new Error('No voice available');
  };
  await player.play(C_MAJOR);
  assert.equal(states.at(-1), 'error');
  assert.equal(context.oscillators.length, 0);
  const abandonedBus = context.nodes[0];
  assert.ok(abandonedBus);
  // Start a new audition before the abandoned graph's fallback cleanup fires.
  context.createOscillator = createOscillator;
  await player.play(C_MAJOR);
  const newNodes = context.nodes.slice(1);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(abandonedBus.disconnected, true);
  assert.ok(newNodes.every((node) => !node.disconnected));
  assert.equal(states.at(-1), 'playing');
  player.dispose();
});
