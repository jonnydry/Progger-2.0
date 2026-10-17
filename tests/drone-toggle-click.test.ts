import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createOutputChain, OUTPUT_CROSSFADE } from '../lib/audio-output.ts';
import { scheduleVoicing } from '../lib/voicing-audio.ts';
import { offlineContextWithoutSuspend } from './firefox-offline.ts';

const RATE = 48000;
const FRETS = [0, 2, 2, 1, 0, 0] as const;

function channels(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, index) =>
    buffer.getChannelData(index),
  );
}

function windowPeak(data: Float32Array[], from: number, until: number): number {
  let peak = 0;
  const start = Math.max(0, Math.floor(from * RATE));
  const end = Math.min(data[0]?.length ?? 0, Math.ceil(until * RATE));
  for (const channel of data) {
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }
  return peak;
}

function windowStep(data: Float32Array[], from: number, until: number): number {
  let step = 0;
  const start = Math.max(0, Math.floor(from * RATE));
  const end = Math.min((data[0]?.length ?? 1) - 1, Math.ceil(until * RATE));
  for (const channel of data) {
    for (let index = start; index < end; index += 1) {
      step = Math.max(
        step,
        Math.abs((channel[index + 1] ?? 0) - (channel[index] ?? 0)),
      );
    }
  }
  return step;
}

function quietest(
  data: Float32Array[],
  from: number,
  until: number,
): { value: number; step: number; at: number } {
  let value = Infinity;
  let step = 0;
  let at = 0;
  const start = Math.max(1, Math.floor(from * RATE));
  const end = Math.min((data[0]?.length ?? 1) - 1, Math.ceil(until * RATE));
  for (const channel of data) {
    for (let index = start; index < end; index += 1) {
      const sample = Math.abs(channel[index] ?? 0);
      if (sample < value) {
        value = sample;
        at = index / RATE;
        step = Math.abs((channel[index] ?? 0) - (channel[index - 1] ?? 0));
      }
    }
  }
  return { value, step, at };
}

async function renderChord(toggle: boolean): Promise<Float32Array[]> {
  const seconds = 1.05;
  const context = offlineContextWithoutSuspend(
    2,
    Math.ceil(RATE * seconds),
    RATE,
  );
  assert.equal(typeof context.suspend, 'undefined');
  const chain = createOutputChain(context);
  chain.setDrone(true, 0, 0);
  scheduleVoicing(context, FRETS, 0.05, chain.chordInput);
  if (toggle) {
    chain.setDrone(false, 0.3, OUTPUT_CROSSFADE);
    chain.setDrone(true, 0.56, OUTPUT_CROSSFADE);
  }
  return channels(await context.startRendering());
}

void test('toggling the drone while a chord rings fades through silence', async () => {
  const steady = await renderChord(false);
  const toggled = await renderChord(true);
  const before = windowPeak(toggled, 0.16, 0.28);
  const between = windowPeak(toggled, 0.4, 0.52);
  const after = windowPeak(toggled, 0.68, 0.9);
  const offHole = quietest(toggled, 0.3, 0.36);
  const onHole = quietest(toggled, 0.56, 0.64);
  const offStep = windowStep(toggled, 0.3, 0.36);
  const onStep = windowStep(toggled, 0.56, 0.64);
  const steadyDuring = windowPeak(steady, 0.2, 0.35);
  console.log(
    JSON.stringify({
      before,
      between,
      after,
      offHole,
      onHole,
      offStep,
      onStep,
      steadyDuring,
    }),
  );
  assert.ok(before > 0.05, `chord before the toggle ${before}`);
  assert.ok(
    steadyDuring > 0.05,
    `untoggled chord through the switch ${steadyDuring}`,
  );
  assert.ok(between > 0.02, `chord after the limiter comes out ${between}`);
  assert.ok(after > 0.01, `chord after the limiter returns ${after}`);
  assert.ok(offHole.value < 1e-5, `off switch was not silent ${offHole.value}`);
  assert.ok(onHole.value < 1e-5, `on switch was not silent ${onHole.value}`);
  assert.ok(offHole.step < 0.001, `off switch step ${offHole.step}`);
  assert.ok(onHole.step < 0.001, `on switch step ${onHole.step}`);
  assert.ok(
    offStep < before * 0.25,
    `off fade step ${offStep} against peak ${before}`,
  );
  assert.ok(
    onStep < before * 0.25,
    `on fade step ${onStep} against peak ${before}`,
  );
});
