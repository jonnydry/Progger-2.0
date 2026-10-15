import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createOutputChain } from '../lib/audio-output.ts';

class Param {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value;
  }
  linearRampToValueAtTime(value: number) {
    this.value = value;
  }
}

class Node {
  connections: unknown[] = [];
  connect(next: unknown) {
    this.connections.push(next);
    return next;
  }
  disconnect() {
    this.connections = [];
  }
}

class Gain extends Node {
  gain = new Param();
}

class Shaper extends Node {
  curve: Float32Array | null = null;
  oversample = 'none';
}

class Delay extends Node {
  delayTime = new Param();
}

/**
 * Offline context the tests own. Production code no longer detects Node;
 * this injects suspend and the render clock directly.
 */
class SwitchContext {
  state = 'running';
  currentTime = 0;
  length = 48_000;
  sampleRate = 48_000;
  destination = new Node();
  suspends: number[] = [];
  suspendError: Error | null = null;
  onSuspend: ((when: number) => void) | null = null;
  createGain() {
    return new Gain();
  }
  createWaveShaper() {
    return new Shaper();
  }
  createDelay() {
    return new Delay();
  }
  suspend(when: number) {
    this.suspends.push(when);
    this.onSuspend?.(when);
    if (this.suspendError) return Promise.reject(this.suspendError);
    return Promise.resolve();
  }
  resume() {
    return Promise.resolve();
  }
}

async function rejectionsDuring(run: () => Promise<void> | void) {
  const caught: unknown[] = [];
  const onRejection = (error: unknown) => {
    caught.push(error);
  };
  process.on('unhandledRejection', onRejection);
  try {
    await run();
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    process.off('unhandledRejection', onRejection);
  }
  return caught;
}

void test('production audio does not branch on the Node runtime', () => {
  const source = readFileSync(
    new URL('../lib/audio-output.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /nodeOfflineRuntime|versions\?\.node|process\.versions/,
  );
});

function invalidState(message: string): DOMException {
  return new DOMException(message, 'InvalidStateError');
}

void test('an offline context without suspend pre-schedules the fade', () => {
  const context = new SwitchContext();
  Object.defineProperty(context, 'suspend', { value: undefined });
  const chain = createOutputChain(context as unknown as BaseAudioContext);
  chain.setDrone(true, 0, 0);
  chain.setDrone(false, 0.2, 0.02);
  assert.equal(context.suspends.length, 0);
  assert.equal(chain.voicingTarget(), context.destination);
  chain.disconnect();
});

void test('a pending future switch does not surface when suspend rejects', async () => {
  const context = new SwitchContext();
  context.suspendError = invalidState(
    'suspend rejected while the switch is ahead',
  );
  const chain = createOutputChain(context as unknown as BaseAudioContext);
  chain.setDrone(true, 0, 0);
  assert.equal(chain.voicingTarget(), chain.chordInput);
  const caught = await rejectionsDuring(() => {
    chain.setDrone(false, 0.2, 0.02);
  });
  assert.deepEqual(caught, []);
  assert.equal(context.currentTime, 0);
  assert.deepEqual(context.suspends, [0.22]);
  assert.ok(0.22 > context.currentTime);
  assert.equal(chain.voicingTarget(), context.destination);
  chain.disconnect();
});

void test('a suspend rejection after the switch time still changes the route', async () => {
  const context = new SwitchContext();
  context.suspendError = invalidState('render clock passed the switch');
  context.onSuspend = () => {
    context.currentTime = 1;
  };
  const chain = createOutputChain(context as unknown as BaseAudioContext);
  chain.setDrone(true, 0, 0);
  const caught = await rejectionsDuring(() => {
    chain.setDrone(false, 0.2, 0.02);
  });
  assert.deepEqual(caught, []);
  assert.equal(context.suspends[0], 0.22);
  assert.ok(context.currentTime > context.suspends[0]);
  assert.equal(chain.voicingTarget(), context.destination);
  chain.disconnect();
});

void test('a suspend rejection that is not InvalidStateError is warned and surfaces', () => {
  const child = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--unhandled-rejections=strict',
      '-e',
      `
        import { createOutputChain } from './lib/audio-output.ts';
        const context = {
          state: 'running',
          currentTime: 0,
          length: 48000,
          sampleRate: 48000,
          destination: { connections: [], connect() {}, disconnect() {} },
          createGain() {
            return { connect() { return this; }, disconnect() {}, gain: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
          },
          createWaveShaper() {
            return { connect() { return this; }, disconnect() {}, curve: null, oversample: 'none' };
          },
          createDelay() {
            return { connect() { return this; }, disconnect() {}, delayTime: { value: 0, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {} } };
          },
          suspend() { return Promise.reject(new Error('the render graph broke')); },
          resume() { return Promise.resolve(); },
        };
        const chain = createOutputChain(context);
        chain.setDrone(true, 0, 0);
        chain.setDrone(false, 0.2, 0.02);
        setTimeout(() => chain.disconnect(), 30);
      `,
    ],
    { encoding: 'utf8', cwd: new URL('..', import.meta.url) },
  );
  const output = `${child.stdout}\n${child.stderr}`;
  assert.match(output, /Output route switch failed/);
  assert.match(output, /the render graph broke/);
  assert.notEqual(child.status, 0);
});
