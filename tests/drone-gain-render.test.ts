import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  REED_GAINS,
  REED_TIMING,
  exponentialRampValue,
  holdGainThenFade,
  scheduleSwell,
  type GainRamp,
} from '../lib/drone-audio.ts';

const SAMPLE_RATE = 48000;
const LEAD = 0.05;
const STEP_LIMIT = 1e-3;

type GainParam = Parameters<typeof holdGainThenFade>[0] & {
  setValueAtTime: (value: number, startTime: number) => unknown;
  exponentialRampToValueAtTime: (value: number, endTime: number) => unknown;
};

function addVoice(context: OfflineAudioContext, start: number): GainParam {
  const buffer = context.createBuffer(1, 1, SAMPLE_RATE);
  buffer.getChannelData(0)[0] = 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const gain = context.createGain();
  source.connect(gain);
  gain.connect(context.destination);
  source.start(start);
  return gain.gain as GainParam;
}

function render(
  duration: number,
  schedule: (context: OfflineAudioContext) => void,
): Promise<Float32Array> {
  const length = Math.ceil(duration * SAMPLE_RATE);
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  schedule(context);
  return context.startRendering().then((rendered) => {
    const channel = rendered.getChannelData(0);
    return channel.slice();
  });
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
    next: true,
  },
  {
    name: 'settled key change',
    into: REED_TIMING.playAttack + 0.75,
    stopDelay: 0.02,
    fade: REED_TIMING.switchFade,
    next: true,
  },
  {
    name: 'settled toggle off',
    into: REED_TIMING.playAttack + 0.75,
    stopDelay: 0,
    fade: REED_TIMING.stopFade,
    next: false,
  },
  {
    name: 'settled view leave',
    into: REED_TIMING.playAttack + 0.75,
    stopDelay: 0,
    fade: REED_TIMING.hideFade,
    next: false,
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
    const clean = await render(duration, (context) => {
      const voice = addVoice(context, LEAD);
      scheduleSwell(voice, LEAD, REED_TIMING.playAttack);
    });
    const stopped = await render(duration, (context) => {
      const voice = addVoice(context, LEAD);
      scheduleSwell(voice, LEAD, REED_TIMING.playAttack);
      holdGainThenFade(voice, ramp, stopAt, release, now, SAMPLE_RATE);
      if (!item.next) return;
      const next = addVoice(context, stopAt);
      scheduleSwell(next, stopAt, REED_TIMING.switchAttack);
    });
    const cut = Math.round(now * SAMPLE_RATE);
    const end = Math.round((stopAt + release) * SAMPLE_RATE);
    const spliced = new Float32Array(stopped.length);
    for (let index = 0; index < spliced.length; index += 1) {
      spliced[index] = index < cut ? clean[index] : stopped[index];
    }
    const step = maxAbsStep(spliced, cut - Math.floor(SAMPLE_RATE * 0.02), end);
    const expected = exponentialRampValue(ramp, now);
    assert.ok(step < STEP_LIMIT, `${item.name} max step ${step}`);
    assert.ok(
      closest(stopped, cut, expected) < STEP_LIMIT,
      `${item.name} anchor ${stopped[cut]} expected ${expected}`,
    );
    if (now >= ramp.endTime) assert.equal(expected, REED_GAINS.envelope);
  }
});

function spliceAt(
  clean: Float32Array,
  stopped: Float32Array,
  cut: number,
): Float32Array {
  const out = new Float32Array(stopped.length);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = index < cut ? clean[index] : stopped[index];
  }
  return out;
}

function addBuffers(parts: Float32Array[]): Float32Array {
  const out = new Float32Array(parts[0].length);
  for (const part of parts) {
    for (let index = 0; index < out.length; index += 1)
      out[index] += part[index];
  }
  return out;
}

void test('repeated crossfades stay within one thousandth, including both voices', async () => {
  const release = Math.max(REED_TIMING.switchFade, 0.015);
  for (let index = 0; index < 200; index += 1) {
    const chained = index < 128;
    const align = chained ? index : index - 128;
    const lead = (64 + align) / SAMPLE_RATE;
    const into = 0.18;
    const now = lead + into;
    const stopAt = now + 0.02;
    const secondNow = stopAt + into;
    const secondStop = secondNow + 0.02;
    const end = (chained ? secondStop : stopAt) + release + 0.05;
    const ramp: GainRamp = {
      start: REED_GAINS.silence,
      target: REED_GAINS.envelope,
      startTime: lead,
      endTime: lead + REED_TIMING.playAttack,
    };
    const cleanOld = await render(end, (context) => {
      scheduleSwell(addVoice(context, lead), lead, REED_TIMING.playAttack);
    });
    const stoppedOld = await render(end, (context) => {
      const voice = addVoice(context, lead);
      scheduleSwell(voice, lead, REED_TIMING.playAttack);
      holdGainThenFade(voice, ramp, stopAt, release, now, SAMPLE_RATE);
    });
    const cleanYoung = await render(end, (context) => {
      scheduleSwell(
        addVoice(context, stopAt),
        stopAt,
        REED_TIMING.switchAttack,
      );
    });
    const parts = [
      spliceAt(cleanOld, stoppedOld, Math.round(now * SAMPLE_RATE)),
    ];
    if (chained) {
      const youngRamp: GainRamp = {
        start: REED_GAINS.silence,
        target: REED_GAINS.envelope,
        startTime: stopAt,
        endTime: stopAt + REED_TIMING.switchAttack,
      };
      const stoppedYoung = await render(end, (context) => {
        const voice = addVoice(context, stopAt);
        scheduleSwell(voice, stopAt, REED_TIMING.switchAttack);
        holdGainThenFade(
          voice,
          youngRamp,
          secondStop,
          release,
          secondNow,
          SAMPLE_RATE,
        );
      });
      const next = await render(end, (context) => {
        scheduleSwell(
          addVoice(context, secondStop),
          secondStop,
          REED_TIMING.switchAttack,
        );
      });
      parts.push(
        spliceAt(cleanYoung, stoppedYoung, Math.round(secondNow * SAMPLE_RATE)),
        next,
      );
    } else {
      parts.push(cleanYoung);
    }
    const sum = addBuffers(parts);
    const step = maxAbsStep(sum, 1, sum.length - 1);
    const label = chained
      ? `key change 0.18s into a later swell, align ${align}`
      : `key change 0.18s into the swell, align ${align}`;
    assert.ok(step < STEP_LIMIT, `${label} max step ${step}`);
  }
});
