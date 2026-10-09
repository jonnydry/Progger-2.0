import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { patterns, SCALES, spell } from '../lib/music.ts';
import { connectedFormForScale, formAtFret } from '../lib/connected-neck.ts';
import { QUALITIES, voicings } from '../lib/harmony.ts';
import { voicingIndexForChange } from '../lib/voicing-navigation.ts';

const scale = (id: string) => SCALES.find((item) => item.id === id)!;
const formStart = (root: string, id: string, progress: number) =>
  patterns(spell(root, scale(id).formula))[
    connectedFormForScale(root, scale(id).formula, progress)
  ].start;

void test('openMatch and explore_scale call the connected-form handoff', () => {
  const source = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const tool = source.slice(
    source.indexOf("name: 'explore_scale'"),
    source.indexOf('function choose'),
  );
  const openMatch = source.slice(source.indexOf('function openMatch'));
  const strings = source.slice(
    source.indexOf('onStringsChange'),
    source.indexOf('onBassChange'),
  );
  const bass = source.slice(
    source.indexOf('onBassChange'),
    source.indexOf('onReset'),
  );
  assert.match(tool, /connectedFormForScale\(/);
  assert.match(openMatch, /connectedFormForScale\(/);
  assert.doesNotMatch(tool, /nearestConnectedForm\(/);
  assert.doesNotMatch(openMatch, /nearestConnectedForm\(/);
  assert.match(strings, /voicingIndexForChange\([\s\S]*'strings'/);
  assert.match(bass, /voicingIndexForChange\([\s\S]*'bass'/);
  assert.match(
    source.slice(
      source.indexOf('function choose'),
      source.indexOf('function navigate'),
    ),
    /voicingIndexForChange\([\s\S]*'root'/,
  );
  assert.match(source, /voicingIndexForChange\([\s\S]*'quality'/);
  assert.match(source, /voicingIndexForChange\([\s\S]*'chord-tab'/);
});

void test('Match and the scale tool land on the connected form already in view', () => {
  assert.equal(formStart('A', 'dorian', 0), 0);
  assert.equal(formStart('A', 'dorian', 1), 19);
  assert.equal(formStart('A', 'dorian', 0.3), 5);
  const forms = patterns(spell('A', scale('dorian').formula));
  const center = (index: number) => (forms[index].min + forms[index].max) / 2;
  const progressFor = (fret: number) =>
    (fret - center(0)) / (center(forms.length - 1) - center(0));
  const followed = forms.findIndex((form) => form.start === 5);
  const nearer = forms.findIndex((form) => form.start === 7);
  const fret = (center(followed) + center(nearer)) / 2 + 0.1;
  assert.equal(forms[formAtFret(forms, fret, followed)].start, 5);
  assert.equal(formStart('A', 'dorian', progressFor(fret)), 7);
  assert.equal(formStart('C', 'major', 0.8), 15);
  assert.equal(connectedFormForScale('C', scale('whole-tone').formula, 0.4), 0);
});

void test('string-set and bass changes keep a shape that still matches', () => {
  const major = voicings(
    'C',
    QUALITIES.find((item) => item.id === 'major')!,
  );
  const strings = { bass: 'all', strings: '1,2,3,4,5', nearFret: null };
  assert.deepEqual(
    major[voicingIndexForChange(major, strings, 1, 'strings')].frets,
    [null, 3, 5, 5, 5, 3],
  );
  assert.deepEqual(
    major[voicingIndexForChange(major, strings, 2, 'strings')].frets,
    [null, 3, 2, 0, 1, 0],
  );
  const bassG = { bass: '7', strings: 'all', nearFret: null };
  assert.deepEqual(
    major[voicingIndexForChange(major, bassG, 19, 'bass')].frets,
    [3, 3, 2, null, null, null],
  );
  assert.deepEqual(
    major[voicingIndexForChange(major, bassG, 1, 'bass')].frets,
    [null, null, null, 0, 1, 0],
  );
  assert.deepEqual(
    major[voicingIndexForChange(major, bassG, 19, 'root')].frets,
    [null, null, null, 0, 1, 0],
  );
  assert.equal(
    voicingIndexForChange(
      major,
      { bass: '4', strings: '0,5', nearFret: null },
      2,
      'bass',
    ),
    2,
  );
});

void test('root, quality, and the chord tab restart at the first matching shape', () => {
  const major = voicings(
    'C',
    QUALITIES.find((item) => item.id === 'major')!,
  );
  const strings = { bass: 'all', strings: '1,2,3,4,5', nearFret: null };
  for (const change of ['root', 'quality', 'chord-tab'] as const) {
    assert.deepEqual(
      major[voicingIndexForChange(major, strings, 1, change)].frets,
      [null, 3, 2, 0, 1, 0],
    );
  }
  assert.deepEqual(
    major[voicingIndexForChange(major, strings, 1, 'strings')].frets,
    [null, 3, 5, 5, 5, 3],
  );
});
