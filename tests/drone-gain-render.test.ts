import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  REED_GAINS,
  REED_TIMING,
  exponentialRampValue,
  holdGainThenFade,
  type GainRamp,
} from '../lib/drone-audio.ts';

const SAMPLE_RATE = 48000;
const LEAD = 0.05;

type GainParam = Parameters<typeof holdGainThenFade>[0] & {
  setValueAtTime: (value: number, startTime: number) => unknown;
  exponentialRampToValueAtTime: (value: number, endTime: number) => unknown;
};

function renderGain(
  duration: number,
  schedule: (param: GainParam) => void,
): Promise<Float32Array> {
  const length = Math.ceil(duration * SAMPLE_RATE);
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  const buffer = context.createBuffer(1, 1, SAMPLE_RATE);
  buffer.getChannelData(0)[0] = 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = context.createGain();
  source.connect(gain);
  gain.connect(context.destination);
  schedule(gain.gain as GainParam);
  source.start(0);
  return context
    .startRendering()
    .then((rendered) => rendered.getChannelData(0));
}

function maxAbsStep(data: Float32Array, from: number, to: number): number {
  let max = 0;
  const start = Math.max(1, from);
  const end = Math.min(data.length - 1, to);
  for (let index = start; index <= end; index += 1) {
    max = Math.max(max, Math.abs(data[index] - data[index - 1]));
  }
  return max;
}

function closest(data: Float32Array, index: number, expected: number): number {
  let best = Number.POSITIVE_INFINITY;
  const from = Math.max(0, index - 2);
  const to = Math.min(data.length - 1, index + 2);
  for (let cursor = from; cursor <= to; cursor += 1) {
    best = Math.min(best, Math.abs(data[cursor] - expected));
  }
  return best;
}

const cases = [
  {
    name: 'mid-swell key change',
    into: 1.5,
    stopDelay: 0.02,
    fade: REED_TIMING.switchFade,
  },
  {
    name: 'settled key change',
    into: REED_TIMING.playAttack + 0.75,
    stopDelay: 0.02,
    fade: REED_TIMING.switchFade,
  },
  {
    name: 'settled toggle off',
    into: REED_TIMING.playAttack + 0.75,
    stopDelay: 0,
    fade: REED_TIMING.stopFade,
  },
  {
    name: 'settled view leave',
    into: REED_TIMING.playAttack + 0.75,
    stopDelay: 0,
    fade: REED_TIMING.hideFade,
  },
] as const;

void test('a rendered stop stays continuous through the swell and after it', async () => {
  for (const item of cases) {
    const now = LEAD + item.into;
    const stopAt = now + item.stopDelay;
    const release = Math.max(item.fade, 0.015);
    const duration = stopAt + release + 0.05;
    const ramp: GainRamp = {
      start: REED_GAINS.silence,
      target: REED_GAINS.envelope,
      startTime: LEAD,
      endTime: LEAD + REED_TIMING.playAttack,
    };
    const scheduleRamp = (param: GainParam) => {
      param.setValueAtTime(ramp.start, ramp.startTime);
      param.exponentialRampToValueAtTime(ramp.target, ramp.endTime);
    };
    const clean = await renderGain(duration, scheduleRamp);
    const stopped = await renderGain(duration, (param) => {
      scheduleRamp(param);
      holdGainThenFade(param, ramp, stopAt, release, now);
    });
    const cut = Math.round(now * SAMPLE_RATE);
    const end = Math.round((stopAt + release) * SAMPLE_RATE);
    const spliced = new Float32Array(stopped.length);
    for (let index = 0; index < spliced.length; index += 1) {
      spliced[index] = index < cut ? clean[index] : stopped[index];
    }
    const step = maxAbsStep(spliced, cut - Math.floor(SAMPLE_RATE * 0.02), end);
    const expected = exponentialRampValue(ramp, now);
    assert.ok(step < 0.01, `${item.name} max step ${step}`);
    assert.ok(
      closest(stopped, cut, expected) < 0.03,
      `${item.name} anchor ${stopped[cut]} expected ${expected}`,
    );
    if (now >= ramp.endTime) assert.equal(expected, REED_GAINS.envelope);
  }
});
