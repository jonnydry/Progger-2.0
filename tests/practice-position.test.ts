import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patterns, SCALES, spell } from '../lib/music.ts';
import { nearestPatternIndex } from '../lib/practice-position.ts';

void test('scale changes keep a valid nearby low-E starting fret', () => {
  const major = patterns(
    spell('C', SCALES.find((s) => s.id === 'major')!.formula),
  );
  assert.equal(major[nearestPatternIndex(major, 5)].start, 5);
  assert.equal(major[nearestPatternIndex(major, 6)].start, 5);
  assert.equal(
    major[nearestPatternIndex(major, 24)].start,
    major.at(-1)!.start,
  );
  const minor = patterns(
    spell('A', SCALES.find((s) => s.id === 'minor-pentatonic')!.formula),
  );
  assert.equal(minor[nearestPatternIndex(minor, 5)].start, 5);
  assert.equal(nearestPatternIndex([], 12), 0);
});
