import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DRONE_MAX_LINEAR_GAIN } from '../lib/drone-audio.ts';

const FULL_SCALE_MARGIN = 10 ** (-1 / 20);

type SizeRow = {
  strings: number;
  label: string;
  coherent: { peak: number };
};

void test('coherent reed plus every voicing size stays at or under -1 dBFS', () => {
  const report = JSON.parse(
    readFileSync(new URL('./fixtures/reed-headroom.json', import.meta.url), 'utf8'),
  ) as {
    gain: number;
    passes: boolean;
    bySize: SizeRow[];
  };
  assert.equal(report.gain, DRONE_MAX_LINEAR_GAIN);
  assert.deepEqual(
    report.bySize.map((row) => row.strings),
    [1, 2, 3, 4, 5, 6],
  );
  for (const row of report.bySize) {
    assert.ok(
      row.coherent.peak <= FULL_SCALE_MARGIN,
      `${row.strings} strings (${row.label}) coherent peak ${row.coherent.peak}`,
    );
  }
  assert.equal(report.passes, true);
});
