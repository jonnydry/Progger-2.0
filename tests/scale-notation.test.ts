import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ROOTS, SCALES, patterns, pitchClass, spell, type Note } from '../lib/music.ts';
import { noteDescription, readableNoteName } from '../lib/note-presentation.ts';

// Authored semitone fixtures, independent of the catalog interval formulas.
// Minor modes can also be checked by rotating the C minor parent collections;
// the two octatonic modes alternate 1/2 or 2/1, and whole tone repeats 2.
const semitones: Record<string, number[]> = {
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

// This list is deliberately separate from pitchClass() and ROOTS so accidental
// parsing cannot validate itself by assigning the same wrong root pitch twice.
const rootPitches: Record<string, number> = {
  C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5,
  'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
};

function scaleNotes(root: string, id: string): Note[] {
  const definition = SCALES.find(scale => scale.id === id);
  assert.ok(definition, `Missing scale ${id}`);
  return spell(root, definition.formula);
}

void test('all catalog scales match independent semitone fixtures in every selectable spelling', () => {
  assert.deepEqual(SCALES.map(scale => scale.id).sort(), Object.keys(semitones).sort());
  assert.deepEqual([...ROOTS].sort(), Object.keys(rootPitches).sort());
  for (const root of ROOTS) for (const scale of SCALES) {
    const notes = spell(root, scale.formula);
    const expected = semitones[scale.id].map(distance => (rootPitches[root] + distance) % 12);
    assert.deepEqual(notes.map(note => note.pc), expected, `${root} ${scale.id}`);
    assert.equal(new Set(notes.map(note => note.pc)).size, expected.length, `${root} ${scale.id}: duplicate pitch`);
    for (const note of notes) assert.equal(pitchClass(note.name), note.pc, `${root} ${scale.id}: ${note.name}`);
  }
});

void test('harmonic minor, altered and ultralocrian show practical names without changing their theory', () => {
  const fixtures = [
    { root: 'Gb', id: 'harmonic-minor', written: 'Gb Ab Bbb Cb Db Ebb F', readable: 'Gb Ab A Cb Db D F', degrees: '1 2 b3 4 5 b6 7' },
    { root: 'Db', id: 'harmonic-minor', written: 'Db Eb Fb Gb Ab Bbb C', readable: 'Db Eb Fb Gb Ab A C', degrees: '1 2 b3 4 5 b6 7' },
    { root: 'G#', id: 'harmonic-minor', written: 'G# A# B C# D# E F##', readable: 'G# A# B C# D# E G', degrees: '1 2 b3 4 5 b6 7' },
    { root: 'C', id: 'ultralocrian', written: 'C Db Eb Fb Gb Ab Bbb', readable: 'C Db Eb Fb Gb Ab A', degrees: '1 b2 b3 b4 b5 b6 bb7' },
    { root: 'Gb', id: 'ultralocrian', written: 'Gb Abb Bbb Cbb Dbb Ebb Fbb', readable: 'Gb G A Bb C D Eb', degrees: '1 b2 b3 b4 b5 b6 bb7' },
    { root: 'E', id: 'altered', written: 'E F F## G# A# C D', readable: 'E F G G# A# C D', degrees: '1 b9 #9 3 #11 b13 b7' },
    { root: 'F#', id: 'major', written: 'F# G# A# B C# D# E#', readable: 'F# G# A# B C# D# E#', degrees: '1 2 3 4 5 6 7' },
  ];
  for (const fixture of fixtures) {
    const notes = scaleNotes(fixture.root, fixture.id);
    assert.deepEqual(notes.map(note => note.name), fixture.written.split(' '));
    assert.deepEqual(notes.map(readableNoteName), fixture.readable.split(' '));
    assert.deepEqual(notes.map(note => note.degree), fixture.degrees.split(' '));
    assert.deepEqual(notes.map(note => note.name), fixture.written.split(' '), 'Presentation must not overwrite canonical notes');
  }
});

void test('readable labels retain every pitch, canonical degree and fret pattern across the complete catalog', () => {
  for (const root of ROOTS) for (const scale of SCALES) {
    const notes = spell(root, scale.formula);
    const original = structuredClone(notes);
    const originalPatterns = patterns(notes);
    // Freeze the inputs too: attempted in-place respelling must fail this check.
    notes.forEach(Object.freeze);
    const displayNotes = notes.map(note => ({ ...note, name: readableNoteName(note) }));
    for (const [index, note] of notes.entries()) {
      const readable = displayNotes[index].name;
      assert.match(readable, /^[A-G][#b]?$/, `${root} ${scale.id}: ${readable}`);
      assert.equal(pitchClass(readable), semitones[scale.id].map(distance => (rootPitches[root] + distance) % 12)[index]);
      if (note.name.length <= 2) assert.equal(readable, note.name, 'Single-accidental interval spelling stays intact');
      assert.equal(displayNotes[index].degree, original[index].degree);
      noteDescription(note);
    }
    assert.deepEqual(notes, original);
    assert.deepEqual(patterns(displayNotes), originalPatterns, `${root} ${scale.id}: display aliases changed the neck`);
  }
});

void test('enharmonic descriptions disclose the written note and retain functional double-flat degrees', () => {
  assert.equal(noteDescription({ name: 'Bbb', pc: 9, degree: 'bb7' }), 'A (written B♭♭)');
  assert.equal(noteDescription({ name: 'F##', pc: 7, degree: '#9' }), 'G (written F♯♯)');
  assert.equal(noteDescription({ name: 'E#', pc: 5, degree: '7' }), 'E♯');
  assert.equal(noteDescription({ name: 'Fb', pc: 4, degree: 'b4' }), 'F♭');
  const seventh = scaleNotes('C', 'ultralocrian').at(-1)!;
  assert.equal(readableNoteName(seventh), 'A');
  assert.equal(seventh.degree, 'bb7', 'The alias is not permission to relabel the diminished seventh as degree 6');
});

void test('theoretical roots and deeper accidental chains receive bounded display aliases', () => {
  const fixtures: [string, number, string][] = [
    ['Cbb', 10, 'Bb'], ['B##', 1, 'C#'], ['Fbb', 3, 'Eb'],
    ['C##', 2, 'D'], ['Dbb', 0, 'C'], ['C###', 3, 'D#'],
    ['Ebbb', 1, 'Db'], ['F###', 8, 'G#'], ['Bbbb', 8, 'Ab'],
  ];
  for (const [name, pc, expected] of fixtures) {
    const note = Object.freeze({ name, pc, degree: '1' });
    assert.equal(readableNoteName(note), expected);
    assert.equal(pitchClass(expected), pc);
    assert.deepEqual(note, { name, pc, degree: '1' });
  }
});
