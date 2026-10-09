import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qualityGroup } from '../lib/chord-presentation.ts';
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
const groupedQualities = QUALITIES.map((quality) => ({
  value: quality.id,
  label: quality.name,
  group: qualityGroup(quality),
}));
const searchGroupedQualities = (query: string) =>
  groupedQualities
    .filter((choice) => matchesMusicChoice(choice, query, 'quality'))
    .map((choice) => choice.value);
const coreIds = [
  'major',
  'minor',
  '7',
  'maj7',
  'm7',
  '5',
  'sus2',
  'sus4',
  'dim',
  'aug',
  '6',
  'm6',
  'm7b5',
  'dim7',
];
const dominantIds = [
  '7',
  'dim',
  '9',
  '11',
  '13',
  '7b9',
  '7#9',
  '7#11',
  '7b13',
  '9#11',
];
const dominant7Ids = ['7', 'dim7', '7b9', '7#9', '7#11', '7b13'];

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
  assert.deepEqual(searchQualities('Cmi'), ['minor']);
  assert.deepEqual(searchQualities('C-7'), ['m7']);
  assert.deepEqual(searchQualities('Csus'), ['sus4']);
  assert.deepEqual(searchQualities('Co'), ['dim']);
  assert.ok(searchQualities('Do').includes('dim'));
  assert.equal(searchQualities('Do').includes('major'), false);
  assert.ok(searchQualities('do').includes('7'));
  assert.equal(searchQualities('do').includes('major'), false);
  assert.ok(searchQualities('Do').includes('13'));
  assert.ok(searchQualities('Dom').includes('7'));
  assert.equal(searchQualities('Dom').includes('dim'), false);
  assert.deepEqual(searchQualities('Co7'), ['dim7']);
  assert.deepEqual(searchQualities('C(add9)'), ['add9']);
  assert.deepEqual(searchQualities('C(#5)'), ['aug']);
  assert.ok(searchQualities('dominant').includes('7'));
  assert.ok(searchQualities('Dominant').includes('9'));
});

void test('letter o keeps diminished symbols and the name or group they prefix', () => {
  assert.deepEqual(
    groupedQualities
      .filter((choice) => choice.group === 'Core chords')
      .map((choice) => choice.value),
    coreIds,
  );
  assert.deepEqual(
    groupedQualities
      .filter((choice) => choice.label.startsWith('Dominant'))
      .map((choice) => choice.value),
    ['7', '9', '11', '13', '7b9', '7#9', '7#11', '7b13', '9#11'],
  );
  assert.deepEqual(searchGroupedQualities('co'), coreIds);
  assert.deepEqual(searchGroupedQualities('cor'), coreIds);
  assert.deepEqual(searchGroupedQualities('core'), coreIds);
  for (const query of ['do', 'Do', 'DO', 'dO']) {
    assert.deepEqual(searchGroupedQualities(query), dominantIds, query);
  }
  for (const query of ['do7', 'Do7', 'DO7', 'dO7']) {
    assert.deepEqual(searchGroupedQualities(query), dominant7Ids, query);
  }
  for (const letter of ['a', 'b', 'e', 'f', 'g']) {
    assert.deepEqual(searchGroupedQualities(`${letter}o`), ['dim'], letter);
  }
  assert.deepEqual(searchGroupedQualities('Co'), ['dim']);
  assert.deepEqual(searchGroupedQualities('Co7'), ['dim7']);
  assert.deepEqual(searchGroupedQualities('co7'), ['dim7']);
});

void test('a space before a chord-word number matches the unspaced symbol', () => {
  const same = (spaced: string, compact: string) =>
    assert.deepEqual(
      searchGroupedQualities(spaced),
      searchGroupedQualities(compact),
      spaced,
    );
  for (const query of ['do 7', 'Do 7', 'DO 7', 'dO 7', 'do  7'])
    same(query, query.replace(/\s+/g, ''));
  assert.deepEqual(searchGroupedQualities('do 7'), dominant7Ids);
  same('Co 7', 'Co7');
  same('co 7', 'co7');
  same('maj 7', 'maj7');
  same('min 7', 'min7');
  same('dim 7', 'dim7');
  same('sus 4', 'sus4');
  same('add 9', 'add9');
  same('m 7', 'm7');
  same('C 7', 'C7');
  same('Ab 7', 'Ab7');
  assert.deepEqual(searchGroupedQualities('Co'), ['dim']);
  assert.deepEqual(searchGroupedQualities('co'), coreIds);
  assert.deepEqual(searchGroupedQualities('cor'), coreIds);
  assert.deepEqual(searchGroupedQualities('core'), coreIds);
  assert.deepEqual(searchGroupedQualities('do 13'), ['13', '7b13']);
  assert.ok(searchGroupedQualities('dominant 7').includes('7'));
  assert.ok(searchGroupedQualities('major 7').includes('maj7'));
  assert.equal(searchGroupedQualities('major 7').includes('dim'), false);
});

void test('descriptions show engine symbols without changing values or labels', () => {
  const halfDiminished = qualities.find((quality) => quality.value === 'm7b5')!;
  assert.equal(musicChoiceDescription(halfDiminished, 'quality'), 'm7♭5');
  assert.equal(halfDiminished.label, 'Half-diminished');
  assert.equal(musicChoiceDescription(scales[0], 'scale'), undefined);
});
