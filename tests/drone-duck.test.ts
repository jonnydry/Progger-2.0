import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AudioWorkletNode, OfflineAudioContext } from 'node-web-audio-api';

globalThis.AudioWorkletNode = AudioWorkletNode;
import {
  DRONE_DUCK_FLOOR,
  createDroneStage,
} from '../lib/audio-output.ts';
import { scheduleVoicing } from '../lib/voicing-audio.ts';

/**
 * Peak-to-peak inside one cycle of a low guitar string, during the decay.
 * A smooth release moves only a little in 8 ms. The old 70 Hz smoother
 * swung several tenths inside that same span.
 */
function envelopeRipple(gain: Float32Array, sampleRate: number): number {
  const window = Math.round(0.008 * sampleRate);
  const step = Math.round(0.002 * sampleRate);
  const start = Math.round(0.35 * sampleRate);
  const end = Math.round(2.2 * sampleRate);
  let worst = 0;
  for (let origin = start; origin + window < end; origin += step) {
    let low = Infinity;
    let high = -Infinity;
    for (let index = 0; index < window; index += 1) {
      const value = gain[origin + index] ?? 0;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    worst = Math.max(worst, high - low);
  }
  return worst;
}

void test('a real strum ducks the drone to the floor without ripple or a phase flip', async () => {
  const rate = 48000;
  const seconds = 3;
  const context = new OfflineAudioContext(1, Math.ceil(rate * seconds), rate);
  const sink = context.createGain();
  sink.gain.value = 0;
  const stage = createDroneStage(context, sink);
  await stage.installDuck();
  assert.ok(stage.duck);
  stage.duck.connect(context.destination);
  scheduleVoicing(context, [0, 2, 2, 1, 0, 0], 0.05, stage.chordInput);
  const rendered = await context.startRendering();
  const offset = rendered.getChannelData(0);
  let lowest = Infinity;
  for (let index = 0; index < offset.length; index += 1) {
    const gain = 1 + (offset[index] ?? 0);
    if (gain < lowest) lowest = gain;
  }
  const ripple = envelopeRipple(
    Float32Array.from(offset, (sample) => 1 + sample),
    rate,
  );
  assert.ok(
    lowest >= DRONE_DUCK_FLOOR - 1e-3,
    `gain fell to ${lowest}, floor is ${DRONE_DUCK_FLOOR}`,
  );
  assert.ok(lowest > 0, `the duck flipped phase at ${lowest}`);
  assert.ok(
    lowest <= DRONE_DUCK_FLOOR + 0.02,
    `the strum never reached the floor (lowest ${lowest})`,
  );
  assert.ok(ripple < 0.05, `duck ripple ${ripple}`);
  console.log(
    JSON.stringify({
      lowestGain: lowest,
      floor: DRONE_DUCK_FLOOR,
      floorDb: 20 * Math.log10(lowest),
      ripple,
    }),
  );
});
