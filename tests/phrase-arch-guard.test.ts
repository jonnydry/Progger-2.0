import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import { generateShapedPhrase, type PhrasePlan } from '../lib/phrase.ts';

/**
 * Eight contexts, 2 and 4 bars, seeds 1–168: 2688 phrases.
 * Removing shapeFloor's arch rejection changes these 24.
 * Removing shapedNotesHold's arch block changes these 4.
 * Removing harmsArch's flatten clause changes the two minor-blues lines.
 * The lists are the whole set on that corpus, so deleting the guard fails
 * the matching test.
 */
type GuardCase = {
  root: string;
  scaleId: string;
  chord: string;
  bars: 2 | 4;
  seed: number;
  contour: PhrasePlan['contour'];
  shape: PhrasePlan['shape'] | null;
  midis: number[];
};

const fixture = JSON.parse(
  readFileSync(new URL('./fixtures/phrase-arch-guards.json', import.meta.url), 'utf8'),
) as {
  shapeFloorArch: GuardCase[];
  shapedNotesHoldArch: GuardCase[];
  archFlatten: GuardCase[];
};

function played(item: GuardCase) {
  const scale = SCALES.find((entry) => entry.id === item.scaleId);
  if (!scale) throw new Error(item.scaleId);
  const result = generateShapedPhrase({
    seed: item.seed,
    bars: item.bars,
    scaleNotes: spell(item.root, scale.formula),
    chordNotes: parseChord(item.chord).notes,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(`${item.root} ${item.scaleId} ${item.seed}`);
  return result.phrase;
}

void test('shapeFloor arch rejection keeps the 24 lines the search would replace', () => {
  assert.equal(fixture.shapeFloorArch.length, 24);
  for (const item of fixture.shapeFloorArch) {
    const phrase = played(item);
    assert.equal(phrase.plan.contour, 'arch');
    assert.deepEqual(phrase.plan.shape ?? null, item.shape);
    assert.deepEqual(
      phrase.notes.map((note) => note.midi),
      item.midis,
    );
  }
});

void test('shapedNotesHold drops the 4 arch shapes whose contour or peak falls', () => {
  assert.equal(fixture.shapedNotesHoldArch.length, 4);
  for (const item of fixture.shapedNotesHoldArch) {
    const phrase = played(item);
    assert.equal(phrase.plan.contour, 'arch');
    assert.equal(phrase.plan.shape, undefined);
    assert.deepEqual(
      phrase.notes.map((note) => note.midi),
      item.midis,
    );
  }
});

void test('an arch repair that keeps the peak still may not flatten the line', () => {
  assert.equal(fixture.archFlatten.length, 2);
  for (const item of fixture.archFlatten) {
    const phrase = played(item);
    assert.equal(phrase.plan.contour, 'arch');
    assert.equal(phrase.plan.shape, undefined);
    assert.deepEqual(
      phrase.notes.map((note) => note.midi),
      item.midis,
    );
  }
});
