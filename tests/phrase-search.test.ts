import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import {
  PHRASE_SEARCH_STEP_CAP,
  canonicalSeed,
  generatePhrase,
  parseSeed,
  phraseSearchStepCount,
  setPhraseSearchStepCapForTests,
  type CadenceTarget,
  type Contour,
  type RegisterName,
  type RhythmId,
} from '../lib/phrase.ts';

const ROOTS = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const RHYTHMS: RhythmId[] = ['quarters', 'eighths', 'long-short', 'push'];
const CONTOURS: Contour[] = ['arch', 'rise', 'fall', 'wave'];
const REGISTERS: RegisterName[] = ['low', 'mid', 'high'];
const CADENCES: CadenceTarget[] = ['root', 'third', 'fifth'];
/** major-blues, C, 4 bars, quarters / fall / low / root. */
const MAJOR_BLUES_PEAK_STEPS = 1803;

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

void test('the search cap refuses the step past 4000', () => {
  const source = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /function searchAtCap\(\)/);
  assert.match(source, /phraseSearchSteps >= phraseSearchLimit/);
  assert.equal(
    source.includes('phraseSearchSteps > PHRASE_SEARCH_STEP_CAP'),
    false,
  );
  assert.equal(source.includes('phraseSearchSteps > phraseSearchLimit'), false);
  assert.equal(PHRASE_SEARCH_STEP_CAP, 4000);
});

void test('a search that lands on the cap keeps the line it found', () => {
  const input = {
    seed: 0,
    bars: 4 as const,
    scaleNotes: spell('C', ['1', '2', '3', '4', '5', '6', '7']),
    chordNotes: parseChord('C').notes,
  };
  const open = generatePhrase(input);
  const steps = phraseSearchStepCount();
  assert.equal(open.ok, true);
  assert.ok(steps < PHRASE_SEARCH_STEP_CAP);
  try {
    setPhraseSearchStepCapForTests(steps);
    const atCap = generatePhrase(input);
    assert.deepEqual(atCap, open);
    assert.equal(phraseSearchStepCount(), steps);
    setPhraseSearchStepCapForTests(steps - 1);
    generatePhrase(input);
    assert.ok(phraseSearchStepCount() <= steps - 1);
  } finally {
    setPhraseSearchStepCapForTests(PHRASE_SEARCH_STEP_CAP);
  }
});

void test(
  'every scale, root, bar count, and plan stays under the search step cap',
  { timeout: 180000 },
  () => {
    let worstSteps = 0;
    let worstMs = 0;
    let worstLabel = '';
    let cases = 0;
    for (const scale of SCALES) {
      for (const root of ROOTS) {
        const scaleNotes = spell(root, scale.formula);
        const chordNotes = parseChord(root).notes;
        for (const bars of [2, 4] as const) {
          for (const contour of CONTOURS) {
            for (const rhythm of RHYTHMS) {
              for (const register of REGISTERS) {
                for (const cadence of CADENCES) {
                  cases += 1;
                  const started = performance.now();
                  const result = generatePhrase({
                    seed: 1,
                    bars,
                    scaleNotes,
                    chordNotes,
                    locks: { contour, rhythm, register, cadence },
                  });
                  const ms = performance.now() - started;
                  const steps = phraseSearchStepCount();
                  assert.ok(
                    steps <= PHRASE_SEARCH_STEP_CAP,
                    `${scale.id} ${root} ${bars} ${rhythm}/${contour}/${register}/${cadence} used ${steps} steps`,
                  );
                  if (result.ok) {
                    for (const note of result.phrase.notes) {
                      assert.ok(note.fret >= 0 && note.fret <= 24);
                    }
                  }
                  if (steps > worstSteps) {
                    worstSteps = steps;
                    worstLabel = `${scale.id} ${root} ${bars} ${rhythm}/${contour}/${register}/${cadence}`;
                  }
                  if (ms > worstMs) worstMs = ms;
                }
              }
            }
          }
        }
      }
    }
    assert.equal(worstSteps, MAJOR_BLUES_PEAK_STEPS);
    assert.equal(worstLabel, 'major-blues C 4 quarters/fall/low/root');
    console.log(
      JSON.stringify({
        cap: PHRASE_SEARCH_STEP_CAP,
        cases,
        worstSteps,
        worstMs,
        worstLabel,
      }),
    );
  },
);

void test('major blues at 4 bars stays under the search step cap', () => {
  const scale = SCALES.find((entry) => entry.id === 'major-blues');
  assert.ok(scale);
  let worstSteps = 0;
  for (const root of ROOTS) {
    const scaleNotes = spell(root, scale.formula);
    const chordNotes = parseChord(root).notes;
    for (const contour of CONTOURS) {
      for (const rhythm of RHYTHMS) {
        for (const register of REGISTERS) {
          for (const cadence of CADENCES) {
            generatePhrase({
              seed: 1,
              bars: 4,
              scaleNotes,
              chordNotes,
              locks: { contour, rhythm, register, cadence },
            });
            const steps = phraseSearchStepCount();
            assert.ok(
              steps <= PHRASE_SEARCH_STEP_CAP,
              `${root} ${rhythm}/${contour}/${register}/${cadence} used ${steps}`,
            );
            if (steps > worstSteps) worstSteps = steps;
          }
        }
      }
    }
  }
  const peak = generatePhrase({
    seed: 1,
    bars: 4,
    scaleNotes: spell('C', scale.formula),
    chordNotes: parseChord('C').notes,
    locks: {
      contour: 'fall',
      rhythm: 'quarters',
      register: 'low',
      cadence: 'root',
    },
  });
  assert.equal(peak.ok, true);
  assert.equal(phraseSearchStepCount(), MAJOR_BLUES_PEAK_STEPS);
  assert.equal(worstSteps, MAJOR_BLUES_PEAK_STEPS);
});

void test('an unplayable plan retries once with the next seed', () => {
  const scaleNotes: Note[] = [{ name: 'C', pc: 0, degree: '1' }];
  const chordNotes: Note[] = scaleNotes;
  const retried = generatePhrase({
    seed: 7,
    bars: 2,
    scaleNotes,
    chordNotes,
  });
  assert.equal(retried.ok, true);
  if (retried.ok) {
    assert.equal(retried.phrase.seed, 8);
    assert.equal(retried.phrase.plan.register, 'low');
  }
  const again = generatePhrase({
    seed: 7,
    bars: 2,
    scaleNotes,
    chordNotes,
  });
  assert.deepEqual(again, retried);
  assert.ok(phraseSearchStepCount() <= PHRASE_SEARCH_STEP_CAP);

  const still = generatePhrase({
    seed: 55,
    bars: 2,
    scaleNotes,
    chordNotes,
  });
  assert.deepEqual(still, { ok: false, reason: 'unplayable' });

  const outside = generatePhrase({
    seed: 4,
    bars: 2,
    scaleNotes,
    chordNotes: [{ name: 'F#', pc: 6, degree: '1' }],
  });
  assert.deepEqual(outside, { ok: false, reason: 'no-shared-tones' });

  const wrapped = generatePhrase({
    seed: 0xffffffff,
    bars: 2,
    scaleNotes: spell('C', ['1', '2', '3', '4', '5', '6', '7']),
    chordNotes: parseChord('C').notes,
  });
  assert.equal(wrapped.ok, true);
  if (wrapped.ok) assert.equal(wrapped.phrase.seed, 0xffffffff);
});

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
