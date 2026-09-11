import { test } from 'node:test';
import assert from 'node:assert/strict';
import { comparePalette } from '../lib/palette-comparison.ts';
import { parseChord } from '../lib/harmony.ts';
import type { Note } from '../lib/music.ts';

// Authored notes, pitch classes, and expected differences. These fixtures do
// not derive expected collections from scale formulas, spell(), or matching.
const notes = (values: [string, number, string][]): Note[] =>
  values.map(([name, pc, degree]) => ({ name, pc, degree }));
const aDorian = {
  notes: notes([
    ['A', 9, '1'],
    ['B', 11, '2'],
    ['C', 0, 'b3'],
    ['D', 2, '4'],
    ['E', 4, '5'],
    ['F#', 6, '6'],
    ['G', 7, 'b7'],
  ]),
};
const aMelodicMinor = {
  notes: notes([
    ['A', 9, '1'],
    ['B', 11, '2'],
    ['C', 0, 'b3'],
    ['D', 2, '4'],
    ['E', 4, '5'],
    ['F#', 6, '6'],
    ['G#', 8, '7'],
  ]),
};
const aDorianFlat2 = {
  notes: notes([
    ['A', 9, '1'],
    ['Bb', 10, 'b2'],
    ['C', 0, 'b3'],
    ['D', 2, '4'],
    ['E', 4, '5'],
    ['F#', 6, '6'],
    ['G', 7, 'b7'],
  ]),
};
const names = (values: { name: string }[]) => values.map((note) => note.name);

void test('Am–D distinguishes entered chord tones from optional notes and precise replacements', () => {
  const chords = [parseChord('Am'), parseChord('D')];
  const dorian = comparePalette(aDorian, chords, aDorian);
  assert.deepEqual(names(dorian.chordTones), ['A', 'C', 'D', 'E', 'F#']);
  assert.deepEqual(names(dorian.melodicNotes), ['B', 'G']);
  assert.deepEqual(dorian.missingChordTones, []);
  assert.deepEqual(dorian.difference, { added: [], removed: [] });

  const melodic = comparePalette(aMelodicMinor, chords, aDorian);
  assert.deepEqual(names(melodic.melodicNotes), ['B', 'G#']);
  assert.deepEqual(names(melodic.difference!.added), ['G#']);
  assert.deepEqual(names(melodic.difference!.removed), ['G']);
  assert.deepEqual(names(melodic.chordTones), ['A', 'C', 'D', 'E', 'F#']);

  const flat2 = comparePalette(aDorianFlat2, chords, aDorian);
  assert.deepEqual(names(flat2.melodicNotes), ['Bb', 'G']);
  assert.deepEqual(names(flat2.difference!.added), ['Bb']);
  assert.deepEqual(names(flat2.difference!.removed), ['B']);
});

void test('flat-root comparison preserves the distinct written pitches', () => {
  const dorian = {
    notes: notes([
      ['Bb', 10, '1'],
      ['C', 0, '2'],
      ['Db', 1, 'b3'],
      ['Eb', 3, '4'],
      ['F', 5, '5'],
      ['G', 7, '6'],
      ['Ab', 8, 'b7'],
    ]),
  };
  const melodic = {
    notes: notes([
      ['Bb', 10, '1'],
      ['C', 0, '2'],
      ['Db', 1, 'b3'],
      ['Eb', 3, '4'],
      ['F', 5, '5'],
      ['G', 7, '6'],
      ['A', 9, '7'],
    ]),
  };
  const result = comparePalette(
    melodic,
    [parseChord('Bbm'), parseChord('Eb')],
    dorian,
  );
  assert.deepEqual(names(result.chordTones), ['Bb', 'Db', 'Eb', 'F', 'G']);
  assert.deepEqual(names(result.melodicNotes), ['C', 'A']);
  assert.deepEqual(names(result.difference!.removed), ['Ab']);
  assert.deepEqual(names(result.difference!.added), ['A']);
});

void test('enharmonic names retain their spelling but do not invent a pitch replacement', () => {
  const flat = {
    notes: notes([
      ['Db', 1, '1'],
      ['F', 5, '3'],
      ['Ab', 8, '5'],
    ]),
  };
  const sharp = {
    notes: notes([
      ['C#', 1, '1'],
      ['E#', 5, '3'],
      ['G#', 8, '5'],
    ]),
  };
  const result = comparePalette(flat, [parseChord('C#')], sharp);
  assert.deepEqual(names(result.chordTones), ['Db', 'F', 'Ab']);
  assert.deepEqual(result.melodicNotes, []);
  assert.deepEqual(result.missingChordTones, []);
  assert.deepEqual(result.difference, { added: [], removed: [] });
});

void test('an added slash bass is an entered tone rather than an optional melody note', () => {
  const result = comparePalette(aDorian, [parseChord('Am/D')]);
  assert.deepEqual(names(result.chordTones), ['A', 'C', 'D', 'E']);
  assert.deepEqual(names(result.melodicNotes), ['B', 'F#', 'G']);
  assert.deepEqual(result.missingChordTones, []);
  const missingBass = comparePalette(aDorian, [parseChord('Am/G#')]);
  assert.deepEqual(names(missingBass.missingChordTones), ['G#']);
});

void test('a non-exact palette reports omitted chord tones and compares collections of different sizes', () => {
  const pentatonic = {
    notes: notes([
      ['C', 0, '1'],
      ['D', 2, '2'],
      ['E', 4, '3'],
      ['G', 7, '5'],
      ['A', 9, '6'],
    ]),
  };
  const mixolydian = {
    notes: notes([
      ['C', 0, '1'],
      ['D', 2, '2'],
      ['E', 4, '3'],
      ['F', 5, '4'],
      ['G', 7, '5'],
      ['A', 9, '6'],
      ['Bb', 10, 'b7'],
    ]),
  };
  const result = comparePalette(pentatonic, [parseChord('C13')], mixolydian);
  assert.deepEqual(names(result.missingChordTones), ['Bb', 'F']);
  assert.deepEqual(result.melodicNotes, []);
  assert.deepEqual(names(result.difference!.removed), ['F', 'Bb']);
  assert.deepEqual(result.difference!.added, []);
});

void test('empty input has no chord-dependent optional-note claim or invented comparison', () => {
  const result = comparePalette(aDorian, []);
  assert.equal(result.hasChords, false);
  assert.deepEqual(result.chordTones, []);
  assert.deepEqual(result.melodicNotes, []);
  assert.deepEqual(result.missingChordTones, []);
  assert.equal(result.difference, undefined);
  const emptyPalette = comparePalette({ notes: [] }, [parseChord('Am')]);
  assert.deepEqual(names(emptyPalette.missingChordTones), ['A', 'C', 'E']);
});
