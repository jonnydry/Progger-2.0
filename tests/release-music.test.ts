import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALES } from '../lib/music.ts';
import { parseChord, matchScales, diatonicChords } from '../lib/harmony.ts';

// Authored semitone fixtures deliberately do not use spell(), quality formulas,
// or the engine's pitch-class helpers to establish the expected collections.
const roots = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const chordIntervals: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  '5': [0, 7],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  '6': [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  m7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9],
  add9: [0, 2, 4, 7],
  madd9: [0, 2, 3, 7],
  '9': [0, 2, 4, 7, 10],
  maj9: [0, 2, 4, 7, 11],
  m9: [0, 2, 3, 7, 10],
  '11': [0, 2, 4, 5, 7, 10],
  maj11: [0, 2, 4, 5, 7, 11],
  m11: [0, 2, 3, 5, 7, 10],
  '13': [0, 2, 4, 5, 7, 9, 10],
  maj13: [0, 2, 4, 5, 7, 9, 11],
  m13: [0, 2, 3, 5, 7, 9, 10],
  '7b9': [0, 1, 4, 7, 10],
  '7#9': [0, 3, 4, 7, 10],
  '7#11': [0, 4, 6, 7, 10],
  '7b13': [0, 4, 7, 8, 10],
  '9#11': [0, 2, 4, 6, 7, 10],
  'maj7#11': [0, 4, 6, 7, 11],
  'maj9#11': [0, 2, 4, 6, 7, 11],
};
const scaleIntervals: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  locrian: [0, 1, 3, 5, 6, 8, 10],
  'major-pentatonic': [0, 2, 4, 7, 9],
  'minor-pentatonic': [0, 3, 5, 7, 10],
  'major-blues': [0, 2, 3, 4, 7, 9],
  'minor-blues': [0, 3, 5, 6, 7, 10],
  'harmonic-minor': [0, 2, 3, 5, 7, 8, 11],
  'locrian-natural6': [0, 1, 3, 5, 6, 9, 10],
  'ionian-augmented': [0, 2, 4, 5, 8, 9, 11],
  'dorian-sharp4': [0, 2, 3, 6, 7, 9, 10],
  'phrygian-dominant': [0, 1, 4, 5, 7, 8, 10],
  'lydian-sharp2': [0, 3, 4, 6, 7, 9, 11],
  ultralocrian: [0, 1, 3, 4, 6, 8, 9],
  'melodic-minor': [0, 2, 3, 5, 7, 9, 11],
  'dorian-b2': [0, 1, 3, 5, 7, 9, 10],
  'lydian-augmented': [0, 2, 4, 6, 8, 9, 11],
  'lydian-dominant': [0, 2, 4, 6, 7, 9, 10],
  'mixolydian-b6': [0, 2, 4, 5, 7, 8, 10],
  'locrian-natural2': [0, 2, 3, 5, 6, 8, 10],
  altered: [0, 1, 3, 4, 6, 8, 10],
  'whole-tone': [0, 2, 4, 6, 8, 10],
  'half-whole-diminished': [0, 1, 3, 4, 6, 7, 9, 10],
  'whole-half-diminished': [0, 2, 3, 5, 6, 8, 9, 11],
};
const mask = (notes: number[]) =>
  notes.reduce((bits, note) => bits | (1 << note), 0);
const transposed = (notes: number[], root: number) =>
  notes.map((note) => (note + root) % 12);

void test('exact matching is complete against independent bitmask collections, including every slash bass', () => {
  const expectedScales = Object.entries(scaleIntervals).flatMap(
    ([id, intervals]) =>
      roots.map((_, root) => ({
        id,
        root,
        mask: mask(transposed(intervals, root)),
      })),
  );
  assert.deepEqual(
    SCALES.map((scale) => scale.id).sort(),
    Object.keys(scaleIntervals).sort(),
  );
  for (const [root, name] of roots.entries()) {
    for (const [suffix, intervals] of Object.entries(chordIntervals)) {
      for (let bass = -1; bass < 12; bass++) {
        const symbol = name + suffix + (bass < 0 ? '' : '/' + roots[bass]);
        const required = mask([
          ...transposed(intervals, root),
          ...(bass < 0 ? [] : [bass]),
        ]);
        const parsed = parseChord(symbol);
        assert.equal(mask(parsed.pcs), required, symbol);
        const expected = expectedScales
          .filter((scale) => (scale.mask & required) === required)
          .map((scale) => `${scale.root}:${scale.id}`)
          .sort();
        const actual = matchScales([parsed])
          .flatMap((group) => group.candidates)
          .map((candidate) => `${candidate.notes[0].pc}:${candidate.scale.id}`)
          .sort();
        assert.deepEqual(actual, expected, symbol);
      }
    }
  }
});

void test('third-stacked triads retain the independently authored parent-key qualities and spellings', () => {
  for (const [root, id, symbols] of [
    ['F#', 'major', 'F# G#m A#m B C# D#m E#dim'],
    ['Gb', 'major', 'Gb Abm Bbm Cb Db Ebm Fdim'],
    ['A', 'harmonic-minor', 'Am Bdim Caug Dm E F G#dim'],
    ['A', 'melodic-minor', 'Am Bm Caug D E F#dim G#dim'],
    ['C', 'ultralocrian', 'Cdim Dbm Ebdim Fbaug Gbm Ab Bbb'],
  ]) {
    const scale = SCALES.find((scale) => scale.id === id)!;
    assert.deepEqual(
      diatonicChords(root, scale).map((chord) => chord.symbol),
      symbols.split(' '),
    );
  }
});

void test('repeated chord-tone inversions keep the same chord-scale priorities', () => {
  for (const [symbol, basses, firstChoice] of [
    ['Cdim7', ['C', 'Eb', 'Gb', 'Bbb'], 'whole-half-diminished'],
    ['Cm7b5', ['C', 'Eb', 'Gb', 'Bb'], 'locrian-natural2'],
    ['Caug', ['C', 'E', 'G#'], 'whole-tone'],
    ['C7b13', ['C', 'E', 'G', 'Bb', 'Ab'], 'mixolydian-b6'],
  ] as const) {
    const original = parseChord(symbol);
    const expected = matchScales([original]);
    assert.equal(expected[0].candidates[0].scale.id, firstChoice);
    for (const bass of basses) {
      const inversion = parseChord(`${symbol}/${bass}`);
      assert.deepEqual(
        matchScales([original, inversion]),
        expected,
        `${symbol}/${bass}`,
      );
      assert.deepEqual(
        matchScales([inversion, original]),
        expected,
        `${symbol}/${bass} first`,
      );
    }
  }
  // Enharmonic roots still identify the same harmony; preserve the user's
  // explicit spelling without requiring equal display text.
  const enharmonic = matchScales([
    parseChord('C#dim7'),
    parseChord('Dbdim7/Db'),
  ]);
  assert.equal(enharmonic[0].candidates[0].root, 'Db');
  assert.equal(enharmonic[0].candidates[0].scale.id, 'whole-half-diminished');
});

void test('a new external slash bass still changes coverage and does not count as repeated harmony', () => {
  const original = parseChord('Cdim7');
  const changed = parseChord('Cdim7/Db');
  const groups = matchScales([original, changed]);
  assert.ok(groups.length > 0);
  assert.ok(
    groups
      .flatMap((group) => group.candidates)
      .every((candidate) => candidate.notes.some((note) => note.pc === 1)),
  );
  assert.ok(
    !groups
      .flatMap((group) => group.candidates)
      .some(
        (candidate) =>
          candidate.root === 'C' &&
          candidate.scale.id === 'whole-half-diminished',
      ),
  );
  // C Ultralocrian contains the external Db; changing harmony must not receive
  // the repeating-diminished-chord bonus it would receive for Cdim7/Db alone.
  const findUltralocrian = (chords: ReturnType<typeof parseChord>[]) =>
    matchScales(chords)
      .flatMap((group) => group.candidates)
      .find(
        (candidate) =>
          candidate.root === 'C' && candidate.scale.id === 'ultralocrian',
      )!;
  assert.equal(findUltralocrian([original, changed]).score, 13);
  assert.equal(findUltralocrian([changed]).score, 22);
  // The equal pitch collections of symmetric chords do not erase distinct roots.
  const differentRoot = matchScales([original, parseChord('Ebdim7')])
    .flatMap((group) => group.candidates)
    .find(
      (candidate) =>
        candidate.root === 'C' &&
        candidate.scale.id === 'whole-half-diminished',
    )!;
  assert.equal(differentRoot.score, 10);
  // Equal pitch collections with a different named quality remain distinct, too.
  const differentQuality = matchScales([parseChord('C6'), parseChord('Am7')])
    .flatMap((group) => group.candidates)
    .find(
      (candidate) => candidate.root === 'C' && candidate.scale.id === 'major',
    )!;
  assert.equal(differentQuality.score, 13);
});
