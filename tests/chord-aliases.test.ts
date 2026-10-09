import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChord, parseProgression, type Chord } from '../lib/harmony.ts';

function result(symbol: string): Omit<Chord, 'original'> {
  const { original: _original, ...chord } = parseChord(symbol);
  return chord;
}

void test('alternate spellings resolve to the same chord as the canonical symbol', () => {
  const pairs: [string, string][] = [
    ['C-', 'Cm'],
    ['C−', 'Cm'],
    ['Cmi', 'Cm'],
    ['Cmin', 'Cm'],
    ['Cminor', 'Cm'],
    ['F#mi', 'F#m'],
    ['B♭-', 'Bbm'],
    ['C-7', 'Cm7'],
    ['C−7', 'Cm7'],
    ['Cmi7', 'Cm7'],
    ['Cmin7', 'Cm7'],
    ['Cminor7', 'Cm7'],
    ['Eb-7', 'Ebm7'],
    ['C-7/Bb', 'Cm7/Bb'],
    ['F##mi7', 'F##m7'],
    ['C-6', 'Cm6'],
    ['Cmi6', 'Cm6'],
    ['Cmin6', 'Cm6'],
    ['Cminor6', 'Cm6'],
    ['C-9', 'Cm9'],
    ['Cmi9', 'Cm9'],
    ['Cmin9', 'Cm9'],
    ['Cminor9', 'Cm9'],
    ['C-11', 'Cm11'],
    ['Cmi11', 'Cm11'],
    ['Cmin11', 'Cm11'],
    ['C-13', 'Cm13'],
    ['Cmi13', 'Cm13'],
    ['Cmin13', 'Cm13'],
    ['Cm7(b5)', 'Cm7b5'],
    ['Cm7(-5)', 'Cm7b5'],
    ['Cmin7(b5)', 'Cm7b5'],
    ['Cmi7(b5)', 'Cm7b5'],
    ['C-7(b5)', 'Cm7b5'],
    ['C−7(b5)', 'Cm7b5'],
    ['C-7b5', 'Cm7b5'],
    ['Cminor7(b5)', 'Cm7b5'],
    ['Cmi7b5', 'Cm7b5'],
    ['Cmin7b5', 'Cm7b5'],
    ['Cm7♭5', 'Cm7b5'],
    ['Cø', 'Cm7b5'],
    ['Cø7', 'Cm7b5'],
    ['C(add9)', 'Cadd9'],
    ['Cadd(9)', 'Cadd9'],
    ['CM(add9)', 'Cadd9'],
    ['Cmaj(add9)', 'Cadd9'],
    ['CMaj(add9)', 'Cadd9'],
    ['Cma(add9)', 'Cadd9'],
    ['Cm(add9)', 'Cmadd9'],
    ['Cmi(add9)', 'Cmadd9'],
    ['Cmin(add9)', 'Cmadd9'],
    ['C-(add9)', 'Cmadd9'],
    ['Cminor(add9)', 'Cmadd9'],
    ['CΔ', 'Cmaj7'],
    ['C∆', 'Cmaj7'],
    ['CΔ7', 'Cmaj7'],
    ['CM7', 'Cmaj7'],
    ['CMaj7', 'Cmaj7'],
    ['CMAJ7', 'Cmaj7'],
    ['CMa7', 'Cmaj7'],
    ['CMA7', 'Cmaj7'],
    ['Cma7', 'Cmaj7'],
    ['CΔ9', 'Cmaj9'],
    ['C∆9', 'Cmaj9'],
    ['CMaj9', 'Cmaj9'],
    ['CMa9', 'Cmaj9'],
    ['Cma9', 'Cmaj9'],
    ['CM9', 'Cmaj9'],
    ['CMaj11', 'Cmaj11'],
    ['CMa11', 'Cmaj11'],
    ['CM11', 'Cmaj11'],
    ['CMaj13', 'Cmaj13'],
    ['CM13', 'Cmaj13'],
    ['Cma13', 'Cmaj13'],
    ['CMaj7#11', 'Cmaj7#11'],
    ['CMa7(#11)', 'Cmaj7#11'],
    ['CM7(#11)', 'Cmaj7#11'],
    ['C∆7(#11)', 'Cmaj7#11'],
    ['CMaj9(#11)', 'Cmaj9#11'],
    ['CMaj', 'C'],
    ['CMAJ', 'C'],
    ['CMAJOR', 'C'],
    ['Cmajor', 'C'],
    ['CMa', 'C'],
    ['CMA', 'C'],
    ['Cma', 'C'],
    ['CM', 'C'],
    ['Cmaj', 'C'],
    ['Cmajor7', 'Cmaj7'],
    ['CMAJOR7', 'Cmaj7'],
    ['Cmajor7#11', 'Cmaj7#11'],
    ['Cmajor(add9)', 'Cadd9'],
    ['CMI7', 'Cm7'],
    ['CMIN7', 'Cm7'],
    ['CMinor7', 'Cm7'],
    ['CMI', 'Cm'],
    ['Cm7-5', 'Cm7b5'],
    ['C-7-5', 'Cm7b5'],
    ['Cmi7-5', 'Cm7b5'],
    ['Cm7(−5)', 'Cm7b5'],
    ['Cmadd(9)', 'Cmadd9'],
    ['Cmiadd(9)', 'Cmadd9'],
    ['C7(−9)', 'C7b9'],
    ['C7-9', 'C7b9'],
    ['C7−9', 'C7b9'],
    ['C7-13', 'C7b13'],
    ['Cmaj6', 'C6'],
    ['CM6', 'C6'],
    ['CMa6', 'C6'],
    ['Cmajor6', 'C6'],
    ['Csus', 'Csus4'],
    ['Dsus', 'Dsus4'],
    ['Co', 'Cdim'],
    ['Co7', 'Cdim7'],
    ['C°', 'Cdim'],
    ['C°7', 'Cdim7'],
    ['C(#5)', 'Caug'],
    ['C+', 'Caug'],
    ['C7(-9)', 'C7b9'],
    ['C7(-13)', 'C7b13'],
    ['C7(b9)', 'C7b9'],
    ['G-7/F', 'Gm7/F'],
    ['Bbmi7(b5)', 'Bbm7b5'],
  ];
  for (const [alias, canonical] of pairs) {
    assert.deepEqual(result(alias), result(canonical), alias);
    assert.equal(parseChord(alias).original, alias);
  }
});

void test('aliases stay distinct from neighboring chord symbols', () => {
  assert.equal(parseChord('Eb7').symbol, 'Eb7');
  assert.equal(parseChord('Eb7').quality.id, '7');
  assert.equal(parseChord('E-7').symbol, 'Em7');
  assert.equal(parseChord('Eb-7').symbol, 'Ebm7');
  assert.equal(parseChord('Ebb7').symbol, 'Ebb7');
  assert.equal(parseChord('C-7').quality.id, 'm7');
  assert.equal(parseChord('C7').quality.id, '7');
  assert.equal(parseChord('CM7').quality.id, 'maj7');
  assert.equal(parseChord('Cm7').quality.id, 'm7');
  assert.equal(parseChord('Cmi').quality.id, 'minor');
  assert.equal(parseChord('Cma').quality.id, 'major');
  assert.equal(parseChord('CΔ').quality.id, 'maj7');
  assert.equal(parseChord('Cmaj').quality.id, 'major');
  assert.equal(parseChord('C').quality.id, 'major');
  assert.equal(parseChord('Csus').quality.id, 'sus4');
  assert.equal(parseChord('Csus2').quality.id, 'sus2');
  assert.equal(parseChord('Csus4').quality.id, 'sus4');
  assert.equal(parseChord('C(add9)').quality.id, 'add9');
  assert.equal(parseChord('Cm(add9)').quality.id, 'madd9');
  assert.equal(parseChord('Cadd9').quality.id, 'add9');
  assert.equal(parseChord('Cm7(b5)').quality.id, 'm7b5');
  assert.notEqual(parseChord('Cm7(b5)').quality.id, 'm7');
  assert.notEqual(parseChord('Cm7(b5)').quality.id, 'dim7');
  assert.equal(parseChord('Co').quality.id, 'dim');
  assert.equal(parseChord('Co7').quality.id, 'dim7');
  assert.equal(parseChord('C+').quality.id, 'aug');
  assert.equal(parseChord('C-9').quality.id, 'm9');
  assert.equal(parseChord('C7(-9)').quality.id, '7b9');
  assert.equal(parseChord('C7-9').quality.id, '7b9');
  assert.notEqual(parseChord('C-9').quality.id, '7b9');
  assert.equal(parseChord('Cm6').quality.id, 'm6');
  assert.equal(parseChord('Cmaj6').quality.id, '6');
  assert.equal(parseChord('C6/D').symbol, 'C6/D');
  assert.equal(parseChord('C6/D').quality.id, '6');
  assert.equal(parseChord('C#5').symbol, 'C#5');
  assert.equal(parseChord('C#5').quality.id, '5');
  assert.equal(parseChord('C(#5)').quality.id, 'aug');
  const progression = parseProgression('C-7 G7 | Fmaj7');
  assert.deepEqual(
    progression.chords.map((chord) => chord.symbol),
    ['Cm7', 'G7', 'Fmaj7'],
  );
  assert.equal(progression.errors.length, 0);
  // En dash remains a progression separator, not a minor-chord hyphen.
  const split = parseProgression('C–7');
  assert.equal(split.chords.length, 1);
  assert.equal(split.chords[0].symbol, 'C');
  assert.equal(split.errors.length, 1);
  const emDash = parseProgression('C—7');
  assert.equal(emDash.chords.length, 1);
  assert.equal(emDash.chords[0].symbol, 'C');
  assert.equal(emDash.errors.length, 1);
});

void test('unsupported new chord types are still rejected', () => {
  const unsupportedQuality = [
    'C7sus4',
    'C7sus',
    'C9sus4',
    'Csus9',
    'Cm(maj7)',
    'Cmin(maj7)',
    'Cmi(maj7)',
    'C-(maj7)',
    'CmMaj7',
    'Cmmaj7',
    'C-maj7',
    'CmM7',
    'C69',
    'C6add9',
    'C7#5',
    'C7b5',
    'C7(#5)',
    'C7(b5)',
    'C7(-5)',
    'C7-5',
    'C7-11',
    'C9#5',
    'C9b5',
    'C+7',
    'C7+',
    'C7alt',
    'Calt',
    'C2',
    'C4',
    'C13(#11)',
    'C7(-11)',
    'C9(-11)',
    'Cm7(b9)',
    'C(b5)',
    'Cm(maj7)/G',
  ];
  for (const symbol of unsupportedQuality) {
    assert.throws(
      () => parseChord(symbol),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          `“${symbol}” has an unsupported chord quality. Use the chord builder to see supported choices.`,
      symbol,
    );
  }
  for (const symbol of ['C6/9', 'Cm6/9', 'C6/9/E']) {
    assert.throws(
      () => parseChord(symbol),
      (error: unknown) =>
        error instanceof Error &&
        error.message ===
          `“${symbol}” is not a recognized chord. Try Am, G7, or D/F#.`,
      symbol,
    );
  }
  const progression = parseProgression('C7sus4 Cm(maj7) C6/9 C7#5');
  assert.equal(progression.chords.length, 0);
  assert.equal(progression.errors.length, 4);
});
