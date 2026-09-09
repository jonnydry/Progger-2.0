import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUALITIES, voicings } from '../lib/harmony.ts';
import { voicingMidi } from '../lib/voicing-audio.ts';

void test('open C auditions sounding octaves and repeated chord tones', () => {
  // x32010: C3 E3 G3 C4 E4, not a deduplicated C-major pitch set.
  assert.deepEqual(voicingMidi([null, 3, 2, 0, 1, 0]), [48, 52, 55, 60, 64]);
});

void test('an inversion auditions its displayed bass instead of inserting the root', () => {
  // Open D/F#: F#2 A2 D3 A3 D4 F#4.
  assert.deepEqual(voicingMidi([2, 0, 0, 2, 3, 2]), [42, 45, 50, 57, 62, 66]);
});

void test('a rooted E13 grip sounds only its displayed guide tones and extension', () => {
  // E2 D3 G#3 C#4: omit the fifth, ninth, and eleventh.
  assert.deepEqual(voicingMidi([0, null, 0, 1, 2, null]), [40, 50, 56, 61]);
});

void test('production rootless voicings preserve their independently specified pitches', () => {
  const fixtures = [
    { quality: '13', frets: [0, 1, 0, 2, null, null], midi: [40, 46, 50, 57] }, // E2 Bb2 D3 A3
    {
      quality: '9#11',
      frets: [null, null, 4, 3, 3, 0],
      midi: [54, 58, 62, 64],
    }, // F#3 Bb3 D4 E4
    {
      quality: 'maj13',
      frets: [null, null, null, 2, 0, 0],
      midi: [57, 59, 64],
    }, // A3 B3 E4
  ];
  for (const fixture of fixtures) {
    const quality = QUALITIES.find((item) => item.id === fixture.quality);
    assert.ok(quality);
    const shape = voicings('C', quality).find((item) =>
      item.frets.every((fret, index) => fret === fixture.frets[index]),
    );
    assert.ok(shape, `Catalog contains C${fixture.quality} fixture`);
    assert.equal(shape.rootless, true);
    assert.deepEqual(voicingMidi(shape.frets), fixture.midi);
  }
});

void test('strum order follows strings even when their pitches cross or coincide', () => {
  assert.deepEqual(voicingMidi([7, 0, null, null, null, null]), [47, 45]);
  assert.deepEqual(voicingMidi([5, 0, null, null, null, null]), [45, 45]);
});

void test('open strings and the 24th fret retain concert pitch', () => {
  assert.deepEqual(voicingMidi([0, 0, 0, 0, 0, 0]), [40, 45, 50, 55, 59, 64]);
  assert.deepEqual(voicingMidi([24, null, null, null, null, 24]), [64, 88]);
});

void test('malformed or silent shapes are rejected before audio scheduling', () => {
  const invalid = [
    [],
    [0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0],
    [null, null, null, null, null, null],
    [-1, null, null, null, null, null],
    [25, null, null, null, null, null],
    [0.5, null, null, null, null, null],
    [Number.NaN, null, null, null, null, null],
    [Number.POSITIVE_INFINITY, null, null, null, null, null],
  ];
  for (const frets of invalid) assert.throws(() => voicingMidi(frets));
});
