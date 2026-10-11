import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FULL_SCALE_MARGIN,
  loudestReedPeaks,
  loudestSoundPeaks,
} from '../lib/drone-levels.ts';

function pluckAttackLevel(): number {
  const source = readFileSync(
    new URL('../lib/voicing-audio.ts', import.meta.url),
    'utf8',
  );
  const bus = source.match(
    /bus\.gain\.value = ([0-9]*\.?[0-9]+) \/ pitches\.length/,
  );
  const attack = source.match(
    /envelope\.gain\.linearRampToValueAtTime\(([0-9]*\.?[0-9]+), at \+ 0\.006\)/,
  );
  if (!bus || !attack) {
    throw new Error(
      'Pluck bus or attack level is not in lib/voicing-audio.ts.',
    );
  }
  return Number(bus[1]) * Number(attack[1]);
}

void test('coherent reed plus a pluck, including a key-change overlap, stays at or under -1 dBFS', () => {
  const pluck = pluckAttackLevel();
  const reed = loudestReedPeaks();
  const steady = reed.steady + pluck;
  const overlap = reed.overlap + pluck;
  assert.ok(reed.steady > 0, 'steady reed peak was not measured');
  assert.ok(reed.overlap > 0, 'crossfade overlap was not measured');
  assert.ok(pluck > 0, 'pluck level was not measured');
  assert.ok(
    steady <= FULL_SCALE_MARGIN,
    `${reed.root} ${reed.modeId} ${reed.octave} steady ${reed.steady} + pluck ${pluck} = ${steady}`,
  );
  assert.ok(
    overlap <= FULL_SCALE_MARGIN,
    `${reed.root} ${reed.modeId} ${reed.octave} overlap ${reed.overlap} + pluck ${pluck} = ${overlap}`,
  );
  for (const sound of ['reed', 'bow', 'cello'] as const) {
    const peak = loudestSoundPeaks(sound);
    const loudestPluck = Math.max(pluck, peak.walk);
    const sum = peak.overlap + loudestPluck;
    assert.ok(
      sum <= FULL_SCALE_MARGIN,
      `${sound} ${peak.root} ${peak.modeId} ${peak.octave} overlap ${peak.overlap} + loudest pluck ${loudestPluck} (walk ${peak.walk}) = ${sum}`,
    );
    assert.ok(peak.overlap + peak.walk <= FULL_SCALE_MARGIN);
  }
});
