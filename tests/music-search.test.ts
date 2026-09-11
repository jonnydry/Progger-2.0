import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITIES } from '../lib/harmony.ts';
import { SCALES } from '../lib/music.ts';
import {
  matchesMusicChoice,
  musicChoiceDescription,
} from '../lib/music-search.ts';

const scales = SCALES.map((scale) => ({
  value: scale.id,
  label: scale.name,
  group: scale.family,
}));
const qualities = QUALITIES.map((quality) => ({
  value: quality.id,
  label: quality.name,
}));
const searchScales = (query: string) =>
  scales
    .filter((choice) => matchesMusicChoice(choice, query, 'scale'))
    .map((choice) => choice.value);
const searchQualities = (query: string) =>
  qualities
    .filter((choice) => matchesMusicChoice(choice, query, 'quality'))
    .map((choice) => choice.value);

void test('scale search recognizes familiar aliases and ASCII / written accidentals', () => {
  assert.deepEqual(searchScales('Aeolian'), ['minor']);
  assert.ok(searchScales('Ionian').includes('major'));
  assert.ok(searchScales('super locrian').includes('altered'));
  assert.deepEqual(searchScales('Dorian sharp 4'), ['dorian-sharp4']);
  assert.deepEqual(searchScales('Dorian #4'), ['dorian-sharp4']);
  assert.deepEqual(searchScales('Dorian ♯4'), ['dorian-sharp4']);
  assert.deepEqual(searchScales('Locrian natural 2'), ['locrian-natural2']);
  assert.ok(searchScales('harmonic minor').includes('ultralocrian'));
  assert.equal(searchScales('').length, SCALES.length);
});

void test('chord search keeps major / minor shorthand distinct and recognizes supported symbols', () => {
  assert.deepEqual(searchQualities('M7'), ['maj7', 'maj7#11']);
  assert.deepEqual(searchQualities('MAJ7'), ['maj7', 'maj7#11']);
  assert.deepEqual(searchQualities('Maj7'), ['maj7', 'maj7#11']);
  assert.deepEqual(searchQualities('m7'), ['m7', 'm7b5']);
  assert.deepEqual(searchQualities('ø7'), ['m7b5']);
  assert.deepEqual(searchQualities('m7♭5'), ['m7b5']);
  assert.deepEqual(searchQualities('Δ9'), ['maj9', 'maj9#11']);
  assert.deepEqual(searchQualities('°7'), ['dim7']);
  assert.deepEqual(searchQualities('7(#11)'), ['7#11']);
  assert.ok(searchQualities('minor').includes('m13'));
  assert.ok(searchQualities('major').includes('maj13'));
  assert.deepEqual(searchQualities('suspended'), ['sus2', 'sus4']);
  assert.deepEqual(searchQualities('susp'), ['sus2', 'sus4']);
  assert.deepEqual(searchQualities('SUS4'), ['sus4']);
  assert.deepEqual(searchQualities('added'), ['add9', 'madd9']);
  assert.deepEqual(searchQualities('m(add9)'), ['madd9']);
  for (const quality of QUALITIES) {
    assert.ok(
      searchQualities(quality.symbol || 'maj').includes(quality.id),
      quality.id,
    );
  }
});

void test('full symbols resolve only after parsing the complete supported chord', () => {
  assert.deepEqual(searchQualities('Cmaj7'), ['maj7']);
  assert.deepEqual(searchQualities('cmaj7'), ['maj7']);
  assert.deepEqual(searchQualities('cm7'), ['m7']);
  assert.deepEqual(searchQualities('D/F#'), ['major']);
  assert.deepEqual(searchQualities('F♯m7♭5'), ['m7b5']);
  assert.deepEqual(searchQualities('Bb7(#9)'), ['7#9']);
  assert.deepEqual(searchQualities('C7alt'), []);
  assert.deepEqual(searchQualities('7sus4'), []);
  assert.deepEqual(searchQualities('Cmaj7b9'), []);
});

void test('descriptions show engine symbols without changing values or labels', () => {
  const halfDiminished = qualities.find((quality) => quality.value === 'm7b5')!;
  assert.equal(musicChoiceDescription(halfDiminished, 'quality'), 'm7♭5');
  assert.equal(halfDiminished.label, 'Half-diminished');
  assert.equal(musicChoiceDescription(scales[0], 'scale'), undefined);
});
