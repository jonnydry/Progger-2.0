import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  REED_GAINS,
  REED_TIMING,
  scheduleFade,
  scheduleSwell,
} from '../lib/drone-audio.ts';

const SAMPLE_RATE = 48000;
const STEP_LIMIT = 1e-3;

function render(
  duration: number,
  schedule: (context: OfflineAudioContext) => void,
): Promise<Float32Array> {
  const length = Math.ceil(duration * SAMPLE_RATE);
  const context = new OfflineAudioContext(1, length, SAMPLE_RATE);
  schedule(context);
  return context
    .startRendering()
    .then((rendered) => rendered.getChannelData(0).slice());
}

function maxAbsStep(
  data: Float32Array,
  from = 1,
  to = data.length - 1,
): number {
  let max = 0;
  const start = Math.max(1, from);
  const end = Math.min(data.length - 1, to);
  for (let index = start; index <= end; index += 1) {
    max = Math.max(max, Math.abs(data[index] - data[index - 1]));
  }
  return max;
}

function addVoice(
  context: OfflineAudioContext,
  start: number,
  attack: number,
): { stop: (time: number, fade: number) => void } {
  const buffer = context.createBuffer(1, 1, SAMPLE_RATE);
  buffer.getChannelData(0)[0] = 1;
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const envelope = context.createGain();
  const fade = context.createGain();
  fade.gain.value = 1;
  const bellows = context.createOscillator();
  bellows.type = 'sine';
  bellows.frequency.value = 0.16;
  const depth = context.createGain();
  source.connect(envelope);
  envelope.connect(fade);
  fade.connect(context.destination);
  bellows.connect(depth);
  depth.connect(envelope.gain);
  scheduleSwell(envelope.gain, start, attack);
  depth.gain.setValueAtTime(0, start);
  depth.gain.linearRampToValueAtTime(
    REED_GAINS.bellows,
    start + attack + REED_TIMING.bellowsRise,
  );
  source.start(start);
  bellows.start(start);
  return {
    stop(time: number, fadeTime: number) {
      const release = Math.max(fadeTime, 0.015);
      const end = time + release;
      scheduleFade(fade.gain, time, end, 1);
      source.stop(end);
      bellows.stop(end);
    },
  };
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

void test('a rendered stop leaves the swell playing under the fade, including the bellows', async () => {
  for (const item of cases) {
    const lead = 0.05;
    const now = lead + item.into;
    const stopAt = now + item.stopDelay;
    const time = Math.min(now, stopAt);
    const release = Math.max(item.fade, 0.015);
    const end = time + release;
    const duration = end + 0.08;
    const stopped = await render(duration, (context) => {
      const voice = addVoice(context, lead, REED_TIMING.playAttack);
      voice.stop(time, item.fade);
      if (!item.next) return;
      addVoice(context, stopAt, REED_TIMING.switchAttack);
    });
    const step = maxAbsStep(stopped);
    const tailFrom = Math.ceil((end + 0.02) * SAMPLE_RATE);
    let tail = 0;
    for (let index = tailFrom; index < stopped.length; index += 1) {
      tail = Math.max(tail, Math.abs(stopped[index]));
    }
    assert.ok(step < STEP_LIMIT, `${item.name} max step ${step}`);
    if (!item.next) assert.ok(tail < STEP_LIMIT, `${item.name} tail ${tail}`);
  }
});

void test('repeated crossfades stay within one thousandth, including both voices', async () => {
  const release = Math.max(REED_TIMING.switchFade, 0.015);
  for (let index = 0; index < 64; index += 1) {
    const align = index;
    const lead = (64 + align) / SAMPLE_RATE;
    const into = 0.18;
    const now = lead + into;
    const stopAt = now + 0.02;
    const time = Math.min(now, stopAt);
    const end = time + release + 0.05;
    const sum = await render(end, (context) => {
      const voice = addVoice(context, lead, REED_TIMING.playAttack);
      voice.stop(time, REED_TIMING.switchFade);
      addVoice(context, stopAt, REED_TIMING.switchAttack);
    });
    const step = maxAbsStep(sum);
    assert.ok(
      step < STEP_LIMIT,
      `key change 0.18s into the swell, align ${align} max step ${step}`,
    );
  }
});
