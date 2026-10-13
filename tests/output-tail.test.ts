import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { ROOM_SECONDS, TAIL_MARGIN } from '../lib/drone-audio.ts';
import { TUNING } from '../lib/music.ts';
import {
  OUTPUT_TAIL,
  outputTailSeconds,
} from '../lib/audio-output.ts';
import { scheduleVoicing } from '../lib/voicing-audio.ts';

function sourceNumber(source: string, pattern: RegExp): number {
  const found = source.match(pattern);
  if (!found?.[1]) throw new Error(`Missing ${pattern}`);
  return Number(found[1]);
}

void test('the output tail is the longest voicing plus the room', () => {
  const voicing = readFileSync(
    new URL('../lib/voicing-audio.ts', import.meta.url),
    'utf8',
  );
  const strum = sourceNumber(voicing, /const STRUM_GAP = ([0-9.]+)/);
  const decay = sourceNumber(voicing, /const DECAY = ([0-9.]+)/);
  const release = sourceNumber(
    voicing,
    /linearRampToValueAtTime\(0, at \+ DECAY \+ ([0-9.]+)\)/,
  );
  const expected =
    (TUNING.length - 1) * strum + decay + release + ROOM_SECONDS + TAIL_MARGIN;
  assert.equal(outputTailSeconds(), expected);
  assert.equal(OUTPUT_TAIL, expected);
  assert.ok(OUTPUT_TAIL > 2.6);
});

void test('a six-note chord is still sounding at 2.6 s and silent by the output tail', async () => {
  const seconds = OUTPUT_TAIL + 0.4;
  const rate = 48000;
  const render = async (muteAt: number | null) => {
    const context = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
    const bus = context.createGain();
    bus.connect(context.destination);
    if (muteAt !== null) {
      bus.gain.setValueAtTime(1, 0);
      bus.gain.setValueAtTime(0, muteAt);
    }
    scheduleVoicing(context, [0, 2, 2, 1, 0, 0], 0, bus);
    const rendered = await context.startRendering();
    return rendered.getChannelData(0);
  };
  const full = await render(null);
  const early = await render(2.6);
  const held = await render(OUTPUT_TAIL);
  const lastAudible = (data: Float32Array, floor = 1e-6) => {
    for (let index = data.length - 1; index >= 0; index -= 1) {
      if (Math.abs(data[index] ?? 0) > floor) return index / rate;
    }
    return 0;
  };
  const alive = lastAudible(full);
  assert.ok(alive > 2.6, `chord fell silent at ${alive}`);
  assert.ok(alive < OUTPUT_TAIL, `chord still audible at ${alive}`);
  let earlyGap = 0;
  let heldGap = 0;
  for (let index = 0; index < full.length; index += 1) {
    earlyGap = Math.max(earlyGap, Math.abs((full[index] ?? 0) - (early[index] ?? 0)));
    heldGap = Math.max(heldGap, Math.abs((full[index] ?? 0) - (held[index] ?? 0)));
  }
  assert.ok(earlyGap > 1e-5, `muting at 2.6 s changed the chord by ${earlyGap}`);
  assert.ok(heldGap === 0, `muting at the output tail changed the chord by ${heldGap}`);
});
