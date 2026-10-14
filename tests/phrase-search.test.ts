import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  PHRASE_SEARCH_STEP_CAP,
  canonicalSeed,
  generatePhrase,
  parseSeed,
  phraseSearchStepCount,
  type RhythmId,
} from '../lib/phrase.ts';

/**
 * Measured on the 975fe75 engine: every contour, rhythm, register,
 * cadence, and these 12 roots, at 4 bars. Both peaks are over the cap.
 */
const OLD_MINOR_BLUES_4_STEPS = 5398;
const OLD_WHOLE_TONE_4_STEPS = 5402;
const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const RHYTHMS: RhythmId[] = ['quarters', 'eighths', 'long-short', 'push'];

void test('seeds are checked in one place and bar counts are only 2 or 4', () => {
  assert.equal(canonicalSeed(0), 0);
  assert.equal(canonicalSeed(0xffffffff), 0xffffffff);
  assert.equal(canonicalSeed(-1), null);
  assert.equal(canonicalSeed(1.5), null);
  assert.equal(canonicalSeed(0x100000000), null);
  assert.equal(parseSeed(' 4 '), 4);
  assert.equal(parseSeed('4294967295'), 0xffffffff);
  assert.equal(parseSeed('4294967296'), null);
  assert.equal(parseSeed('-1'), null);
  assert.equal(parseSeed('1.5'), null);
  const scale = spell('C', ['1', '2', '3', '4', '5', '6', '7']);
  const chord = parseChord('C').notes;
  assert.equal(
    generatePhrase({ seed: -1, bars: 2, scaleNotes: scale, chordNotes: chord })
      .ok,
    false,
  );
  assert.equal(
    generatePhrase({
      seed: 1,
      bars: 3 as 2,
      scaleNotes: scale,
      chordNotes: chord,
    }).ok,
    false,
  );
  const bad = generatePhrase({
    seed: 1,
    bars: 3 as 2,
    scaleNotes: scale,
    chordNotes: chord,
  });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.reason, 'bad-input');
});

void test(
  'every scale, root, and bar count stays under the search step cap',
  { timeout: 180000 },
  () => {
    assert.ok(PHRASE_SEARCH_STEP_CAP < OLD_MINOR_BLUES_4_STEPS);
    assert.ok(PHRASE_SEARCH_STEP_CAP < OLD_WHOLE_TONE_4_STEPS);
    let worstSteps = 0;
    let worstMs = 0;
    let worstLabel = '';
    let cases = 0;
    for (const scale of SCALES) {
      for (const root of ROOTS) {
        const scaleNotes = spell(root, scale.formula);
        const chordNotes = parseChord(root).notes;
        for (const bars of [2, 4] as const) {
          for (const rhythm of RHYTHMS) {
            cases += 1;
            const started = performance.now();
            const result = generatePhrase({
              seed: 1,
              bars,
              scaleNotes,
              chordNotes,
              locks: { rhythm },
            });
            const ms = performance.now() - started;
            const steps = phraseSearchStepCount();
            assert.ok(
              steps <= PHRASE_SEARCH_STEP_CAP,
              `${scale.id} ${root} ${bars} ${rhythm} used ${steps} steps`,
            );
            if (result.ok) {
              for (const note of result.phrase.notes) {
                assert.ok(note.fret >= 0 && note.fret <= 24);
              }
            }
            if (steps > worstSteps) {
              worstSteps = steps;
              worstLabel = `${scale.id} ${root} ${bars} ${rhythm}`;
            }
            if (ms > worstMs) worstMs = ms;
          }
        }
      }
    }
    console.log(
      JSON.stringify({
        cap: PHRASE_SEARCH_STEP_CAP,
        oldEngine: {
          minorBlues4: OLD_MINOR_BLUES_4_STEPS,
          wholeTone4: OLD_WHOLE_TONE_4_STEPS,
        },
        cases,
        worstSteps,
        worstMs,
        worstLabel,
      }),
    );
  },
);

void test('a thousand seeds log time and memory without a time gate', () => {
  const scale = SCALES.find((item) => item.id === 'dorian');
  assert.ok(scale);
  const scaleNotes = spell('A', scale.formula);
  const chordNotes = parseChord('Am').notes;
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  let worstMs = 0;
  let worstSteps = 0;
  for (let seed = 0; seed < 1000; seed++) {
    const caseStarted = performance.now();
    const result = generatePhrase({
      seed,
      bars: seed % 2 === 0 ? 2 : 4,
      scaleNotes,
      chordNotes,
    });
    const ms = performance.now() - caseStarted;
    const steps = phraseSearchStepCount();
    if (ms > worstMs) worstMs = ms;
    if (steps > worstSteps) worstSteps = steps;
    assert.equal(result.ok, true, `seed ${seed}`);
    assert.ok(steps <= PHRASE_SEARCH_STEP_CAP);
  }
  console.log(
    JSON.stringify({
      seeds: 1000,
      ms: performance.now() - started,
      worstMs,
      worstSteps,
      heapDelta: process.memoryUsage().heapUsed - heapBefore,
    }),
  );
});

void test('unusual chords and symmetric scales still land on the fretboard', () => {
  const cases = [
    { scale: 'whole-half-diminished', symbol: 'Cdim7' },
    { scale: 'whole-tone', symbol: 'Caug' },
    { scale: 'locrian', symbol: 'Cm7b5' },
    { scale: 'altered', symbol: 'C7b9' },
    { scale: 'half-whole-diminished', symbol: 'C13' },
    { scale: 'minor-blues', symbol: 'Cm' },
  ];
  for (const item of cases) {
    const scale = SCALES.find((entry) => entry.id === item.scale);
    assert.ok(scale, item.scale);
    const result = generatePhrase({
      seed: 4,
      bars: 4,
      scaleNotes: spell('C', scale.formula),
      chordNotes: parseChord(item.symbol).notes,
    });
    assert.equal(result.ok, true, item.symbol);
    if (!result.ok) continue;
    for (const note of result.phrase.notes) {
      assert.ok(
        note.fret >= 0 && note.fret <= 24,
        `${item.symbol} fret ${note.fret}`,
      );
      assert.equal(
        note.midi,
        [40, 45, 50, 55, 59, 64][note.string] + note.fret,
      );
    }
    assert.ok(phraseSearchStepCount() <= PHRASE_SEARCH_STEP_CAP, item.symbol);
  }
});
