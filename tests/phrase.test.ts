import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, TUNING, type Note } from '../lib/music.ts';
import {
  PHRASE_PLANNER_TIMEOUT_MS,
  PHRASE_RANGE,
  availableCadences,
  cadenceRole,
  contourHeight,
  defaultChordNotes,
  generatePhrase,
  landingPitchClasses,
  generatePhraseWithPlanner,
  isStrongBeat,
  melodicMotion,
  beatAtSeconds,
  fullSwingRatio,
  onsetSeconds,
  parseSeed,
  phraseFretMarks,
  phraseOnsets,
  phrasePeriodBeats,
  phraseRuleReport,
  phraseSnapshot,
  rulePlan,
  swingRatioForAmount,
  SWING_AMOUNT_DEFAULT,
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_AMOUNT_STEP,
  SWING_ANCHOR_FAST_BPM,
  SWING_ANCHOR_FAST_RATIO,
  SWING_ANCHOR_MID_HIGH_BPM,
  SWING_ANCHOR_MID_LOW_BPM,
  SWING_ANCHOR_MID_RATIO,
  SWING_ANCHOR_SLOW_BPM,
  SWING_ANCHOR_SLOW_RATIO,
  SWING_FULL_RATIO_STEP_EPSILON,
  SWING_RATIO_STRAIGHT,
  SWING_SHORT_EIGHTH_MIN_SEC,
  type CadenceTarget,
  type Contour,
  type Phrase,
  type PhrasePlanner,
} from '../lib/phrase.ts';

const CONTEXTS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['A', 'harmonic-minor', 'E7'],
  ['C', 'minor-pentatonic', 'Cm'],
  ['C', 'minor-blues', 'C7'],
  ['Bb', 'mixolydian', 'Bb7'],
];
const SEEDS = Array.from({ length: 24 }, (_, index) => index + 1);
const BARS = [2, 4] as const;

function scaleOf(root: string, id: string): Note[] {
  const scale = SCALES.find((item) => item.id === id);
  assert.ok(scale, id);
  return spell(root, scale.formula);
}

function contextInput(root: string, scaleId: string, symbol: string) {
  const scaleNotes = scaleOf(root, scaleId);
  const chordNotes = parseChord(symbol).notes;
  return { scaleNotes, chordNotes };
}

function phrases(): {
  phrase: Phrase;
  scaleNotes: Note[];
  chordNotes: Note[];
}[] {
  const found = [];
  for (const [root, scaleId, symbol] of CONTEXTS) {
    const input = contextInput(root, scaleId, symbol);
    for (const bars of BARS) {
      for (const seed of SEEDS) {
        const result = generatePhrase({ seed, bars, ...input });
        assert.equal(
          result.ok,
          true,
          `${symbol} ${scaleId} seed ${seed} ${bars}`,
        );
        if (result.ok) found.push({ phrase: result.phrase, ...input });
      }
    }
  }
  return found;
}

function thirdMeans(midis: readonly number[]): [number, number, number] {
  const third = Math.max(1, Math.floor(midis.length / 3));
  const mean = (slice: readonly number[]) =>
    slice.reduce((sum, midi) => sum + midi, 0) / slice.length;
  return [
    mean(midis.slice(0, third)),
    mean(midis.slice(third, third * 2)),
    mean(midis.slice(third * 2)),
  ];
}

void test('timing, cadence roles, and seeds are deterministic tables', () => {
  assert.equal(PHRASE_RANGE, 18);
  assert.equal(PHRASE_PLANNER_TIMEOUT_MS, 800);
  assert.equal(cadenceRole('1'), 'root');
  assert.equal(cadenceRole('8'), 'root');
  assert.equal(cadenceRole('b3'), 'third');
  assert.equal(cadenceRole('#5'), 'fifth');
  assert.equal(cadenceRole('b7'), null);
  assert.equal(isStrongBeat(0), true);
  assert.equal(isStrongBeat(2), true);
  assert.equal(isStrongBeat(4), true);
  assert.equal(isStrongBeat(0.5), false);
  assert.equal(isStrongBeat(1), false);
  assert.equal(isStrongBeat(3.5), false);
  assert.deepEqual(phraseOnsets('quarters', 2), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(phraseOnsets('eighths', 2).length, 17);
  assert.equal(phraseOnsets('long-short', 4).at(-1), 16);
  assert.equal(phrasePeriodBeats(2), 10);
  assert.equal(phrasePeriodBeats(4), 18);
  assert.equal(onsetSeconds(0, 120, 'swing'), 0);
  assert.equal(onsetSeconds(1, 120, 'straight'), 0.5);
  assert.equal(onsetSeconds(0.5, 120, 'straight'), 0.25);
  assert.equal(onsetSeconds(0.5, 120, 'swing'), (2 / 3) * 0.5);
  assert.equal(onsetSeconds(2.5, 96, 'swing'), (2 + 2 / 3) * (60 / 96));
  assert.equal(parseSeed('42'), 42);
  assert.equal(parseSeed('0'), 0);
  assert.equal(parseSeed('4294967295'), 0xffffffff);
  assert.equal(parseSeed(''), null);
  assert.equal(parseSeed('1.5'), null);
  assert.equal(parseSeed('4294967296'), null);
  assert.equal(parseSeed('-1'), null);

  const open = rulePlan(7, ['root', 'third', 'fifth']);
  const locked = rulePlan(7, ['root', 'third', 'fifth'], { contour: 'wave' });
  assert.equal(locked.contour, 'wave');
  assert.equal(locked.rhythm, open.rhythm);
  assert.equal(locked.register, open.register);
  assert.equal(locked.cadence, open.cadence);
  assert.equal(rulePlan(3, ['root'], { cadence: 'fifth' }).cadence, 'root');
});

void test('swing amount follows the tempo anchors and keeps a 100 ms short eighth', () => {
  assert.equal(SWING_AMOUNT_MIN, 0);
  assert.equal(SWING_AMOUNT_MAX, 1);
  assert.equal(SWING_AMOUNT_DEFAULT, 0.6);
  assert.equal(SWING_RATIO_STRAIGHT, 1);
  assert.equal(SWING_ANCHOR_SLOW_BPM, 100);
  assert.equal(SWING_ANCHOR_SLOW_RATIO, 1.75);
  assert.equal(SWING_ANCHOR_MID_LOW_BPM, 150);
  assert.equal(SWING_ANCHOR_MID_HIGH_BPM, 200);
  assert.equal(SWING_ANCHOR_MID_RATIO, 1.4);
  assert.equal(SWING_ANCHOR_FAST_BPM, 250);
  assert.equal(SWING_ANCHOR_FAST_RATIO, 1.1);
  assert.equal(SWING_FULL_RATIO_STEP_EPSILON, 0.01);
  assert.equal(SWING_SHORT_EIGHTH_MIN_SEC, 0.1);

  assert.equal(fullSwingRatio(60), SWING_ANCHOR_SLOW_RATIO);
  assert.equal(fullSwingRatio(100), SWING_ANCHOR_SLOW_RATIO);
  assert.equal(fullSwingRatio(150), SWING_ANCHOR_MID_RATIO);
  assert.equal(fullSwingRatio(180), SWING_ANCHOR_MID_RATIO);
  assert.equal(fullSwingRatio(200), SWING_ANCHOR_MID_RATIO);
  assert.equal(fullSwingRatio(250), SWING_ANCHOR_FAST_RATIO);
  assert.equal(fullSwingRatio(280), SWING_ANCHOR_FAST_RATIO);
  const at120 =
    SWING_ANCHOR_SLOW_RATIO +
    (SWING_ANCHOR_MID_RATIO - SWING_ANCHOR_SLOW_RATIO) *
      ((120 - SWING_ANCHOR_SLOW_BPM) /
        (SWING_ANCHOR_MID_LOW_BPM - SWING_ANCHOR_SLOW_BPM));
  assert.equal(fullSwingRatio(120), at120);
  assert.ok(Math.abs(at120 - 1.61) < 1e-12);
  const at225 =
    SWING_ANCHOR_MID_RATIO +
    (SWING_ANCHOR_FAST_RATIO - SWING_ANCHOR_MID_RATIO) * 0.5;
  assert.equal(fullSwingRatio(225), at225);
  assert.ok(Math.abs(at225 - 1.25) < 1e-12);

  for (const tempo of [60, 120, 180, 280]) {
    assert.equal(swingRatioForAmount(tempo, 0), 1);
    const full = fullSwingRatio(tempo);
    assert.equal(swingRatioForAmount(tempo, 0.6), 1 + (full - 1) * 0.6);
    assert.equal(swingRatioForAmount(tempo, 1), full);
  }

  const fastQuarter = 60 / 300;
  const unclamped = fullSwingRatio(300);
  const unclampedShort = fastQuarter / (unclamped + 1);
  assert.ok(unclampedShort < 0.1);
  const clamped = swingRatioForAmount(300, 1);
  const clampedShort = fastQuarter / (clamped + 1);
  const clampDrop = unclamped - clamped;
  assert.ok(Math.abs(clampedShort - 0.1) < 1e-9);
  assert.ok(Math.abs(clampDrop - 0.1) < 1e-12);
  console.log(
    JSON.stringify({
      swingStepEpsilon: SWING_FULL_RATIO_STEP_EPSILON,
      clampAt300: { unclamped, clamped, clampDrop },
    }),
  );

  const floorQuarter = 60 / 290;
  const floorRatio = swingRatioForAmount(290, 1);
  const floorShort = floorQuarter / (floorRatio + 1);
  assert.ok(floorQuarter / 2 > 0.1);
  assert.ok(floorQuarter / (fullSwingRatio(290) + 1) < 0.1);
  assert.ok(Math.abs(floorShort - 0.1) < 1e-9);
  assert.ok(floorRatio > 1);

  // 60% is blended first, then clamped. Clamping the full ratio and then
  // taking 60% of that would leave the short eighth longer than 100 ms.
  const partialTempo = 292;
  const partialQuarter = 60 / partialTempo;
  const partialCap = partialQuarter / SWING_SHORT_EIGHTH_MIN_SEC - 1;
  const partialLinear = 1 + (fullSwingRatio(partialTempo) - 1) * 0.6;
  assert.ok(partialLinear > partialCap);
  const partial = swingRatioForAmount(partialTempo, 0.6);
  assert.ok(Math.abs(partial - partialCap) < 1e-9);
  const clampedThenBlended = 1 + (partialCap - 1) * 0.6;
  assert.ok(Math.abs(partial - clampedThenBlended) > 0.02);
  assert.ok(
    Math.abs(partialQuarter / (partial + 1) - SWING_SHORT_EIGHTH_MIN_SEC) <
      1e-9,
  );

  // Half speed hears the halved tempo, so 180 BPM in half time is the slow anchor.
  assert.equal(swingRatioForAmount(180, 1), SWING_ANCHOR_MID_RATIO);
  assert.equal(swingRatioForAmount(180 / 2, 1), SWING_ANCHOR_SLOW_RATIO);

  for (const beat of [0, 0.5, 1, 4, 8]) {
    for (const tempo of [90, 160, 225, 290]) {
      for (const amount of [0, 0.6, 1]) {
        const at = onsetSeconds(beat, tempo, amount);
        assert.ok(
          Math.abs(beatAtSeconds(at, tempo, amount) - beat) < 1e-6,
          `${tempo} ${amount} beat ${beat}`,
        );
        if (Number.isInteger(beat)) {
          assert.equal(at, beat * (60 / tempo));
        }
      }
    }
  }
  assert.equal(swingRatioForAmount(120, Number.NaN), 1);
});

void test('the full-swing target falls smoothly and eighth pairs stay one beat', () => {
  const sweepMin = 40;
  const sweepMax = 300;
  let previous = fullSwingRatio(sweepMin);
  let maxStep = 0;
  for (let bpm = sweepMin + 1; bpm <= sweepMax; bpm++) {
    const target = fullSwingRatio(bpm);
    const drop = previous - target;
    maxStep = Math.max(maxStep, drop);
    assert.ok(
      target <= previous,
      `${bpm} BPM target ${target} rose above ${previous}`,
    );
    assert.ok(
      drop <= SWING_FULL_RATIO_STEP_EPSILON,
      `${bpm} BPM target dropped ${drop}, past ${SWING_FULL_RATIO_STEP_EPSILON}`,
    );
    previous = target;
  }

  const beatPairEpsilonSec = 1e-12;
  const amountSteps = Math.round(
    (SWING_AMOUNT_MAX - SWING_AMOUNT_MIN) / SWING_AMOUNT_STEP,
  );
  const amounts = Array.from(
    { length: amountSteps + 1 },
    (_, index) => SWING_AMOUNT_MIN + index * SWING_AMOUNT_STEP,
  );
  for (let bpm = sweepMin; bpm <= sweepMax; bpm++) {
    const quarter = 60 / bpm;
    for (const amount of amounts) {
      for (const beat of [0, 1, 2, 3]) {
        const down = onsetSeconds(beat, bpm, amount);
        const off = onsetSeconds(beat + 0.5, bpm, amount);
        const next = onsetSeconds(beat + 1, bpm, amount);
        assert.equal(down, beat * quarter, `${bpm} ${amount} downbeat ${beat}`);
        assert.equal(next, (beat + 1) * quarter);
        const pair = off - down + (next - off);
        // Both downbeats are on n * (60/BPM). Their difference can miss
        // that quotient by an ulp; the eighths still fill that grid beat.
        assert.ok(Math.abs(pair - (next - down)) <= beatPairEpsilonSec);
        assert.ok(Math.abs(pair - quarter) <= beatPairEpsilonSec);
        assert.ok(off >= down && off <= next);
      }
    }
  }
  const quarter300 = 60 / 300;
  const down = onsetSeconds(0, 300, 1);
  const off = onsetSeconds(0.5, 300, 1);
  const next = onsetSeconds(1, 300, 1);
  const pair300 = off - down + (next - off);
  assert.ok(Math.abs(pair300 - quarter300) <= beatPairEpsilonSec);
  assert.equal(down, 0);
  assert.equal(next, quarter300);
  console.log(
    JSON.stringify({
      swingSweep: {
        from: sweepMin,
        to: sweepMax,
        epsilon: SWING_FULL_RATIO_STEP_EPSILON,
        maxStep,
      },
    }),
  );
});

void test('a low wave keeps the bottom octave of the cadence', () => {
  const result = generatePhrase({
    seed: 4,
    bars: 2,
    ...contextInput('C', 'major', 'C'),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.phrase.plan.contour, 'wave');
  assert.equal(result.phrase.plan.register, 'low');
  assert.equal(result.phrase.notes.at(-1)?.midi, 48);
  assert.equal(result.phrase.notes.at(-1)?.name, 'C');
});

void test('a slash bass can land on a strong beat and cannot be the cadence', () => {
  assert.equal(cadenceRole('bass'), null);
  const scaleNotes = scaleOf('A', 'dorian');
  const triad = parseChord('Am').notes;
  const withBass = [...triad, { name: 'G', pc: 7, degree: 'bass' }];
  assert.equal(landingPitchClasses(triad, scaleNotes).has(7), false);
  assert.equal(landingPitchClasses(withBass, scaleNotes).has(7), true);
  assert.deepEqual(
    availableCadences(withBass, scaleNotes),
    availableCadences(triad, scaleNotes),
  );
  const phrase = generatePhrase({
    seed: 8,
    bars: 2,
    scaleNotes,
    chordNotes: withBass,
  });
  assert.equal(phrase.ok, true);
  if (!phrase.ok) return;
  assert.notEqual(phrase.phrase.plan.cadence, undefined);
  assert.ok(['root', 'third', 'fifth'].includes(phrase.phrase.plan.cadence));
  const roles = new Set(
    scaleNotes
      .filter((note) => cadenceRole(note.degree) === phrase.phrase.plan.cadence)
      .map((note) => note.pc),
  );
  assert.equal(roles.has(phrase.phrase.notes.at(-1)!.pc), true);
  assert.notEqual(phrase.phrase.notes.at(-1)!.pc, 7);
});

void test('a harmonic-minor augmented second is a scale step', () => {
  const notes = scaleOf('A', 'harmonic-minor');
  const pcs = new Set(notes.map((note) => note.pc));
  assert.deepEqual(
    notes.map((note) => note.name),
    ['A', 'B', 'C', 'D', 'E', 'F', 'G#'],
  );
  assert.equal(melodicMotion(65, 68, pcs), 'step');
  assert.equal(melodicMotion(60, 64, new Set([0, 2, 4, 5, 7, 9, 11])), 'leap');
  assert.equal(melodicMotion(60, 60, pcs), 'unison');
});

void test('the same seed replays the same phrase, and many seeds keep the rules', () => {
  const corpus = phrases();
  assert.equal(corpus.length, CONTEXTS.length * SEEDS.length * BARS.length);
  let strong = 0;
  let strongChord = 0;
  let steps = 0;
  let leaps = 0;
  let semitoneSteps = 0;
  let semitoneMoves = 0;
  let maxRange = 0;
  let cadence = 0;
  let shifts = 0;
  let maxShifts = 0;
  const contourHits: Record<Contour, { hit: number; total: number }> = {
    arch: { hit: 0, total: 0 },
    rise: { hit: 0, total: 0 },
    fall: { hit: 0, total: 0 },
    wave: { hit: 0, total: 0 },
  };
  const ratios: number[] = [];

  for (const { phrase, scaleNotes, chordNotes } of corpus) {
    const again = generatePhrase({
      seed: phrase.seed,
      bars: phrase.bars,
      scaleNotes,
      chordNotes,
    });
    assert.equal(again.ok, true);
    if (again.ok) assert.deepEqual(again.phrase, phrase);

    const report = phraseRuleReport(phrase, scaleNotes, chordNotes);
    assert.equal(report.unisons, 0);
    assert.equal(report.unresolved, 0);
    assert.equal(report.cadenceHit, true);
    assert.ok(report.range <= PHRASE_RANGE);
    assert.ok(report.strong > 0);
    assert.ok(report.strongChord / report.strong >= 0.7);
    strong += report.strong;
    strongChord += report.strongChord;
    steps += report.steps;
    leaps += report.leaps;
    semitoneSteps += report.semitoneSteps;
    semitoneMoves += report.semitoneSteps + report.semitoneLeaps;
    maxRange = Math.max(maxRange, report.range);
    cadence += 1;
    if (report.steps + report.leaps > 0)
      ratios.push(report.steps / (report.steps + report.leaps));

    const names = new Set(scaleNotes.map((note) => note.name));
    const low = { low: 48, mid: 55, high: 64 }[phrase.plan.register];
    let phraseShifts = 0;
    for (let index = 0; index < phrase.notes.length; index++) {
      const note = phrase.notes[index];
      assert.ok(names.has(note.name), `${note.name} leaves the scale spelling`);
      assert.ok(note.midi >= low && note.midi <= low + PHRASE_RANGE);
      assert.equal(note.midi, TUNING[note.string] + note.fret);
      assert.ok(note.fret >= 0 && note.fret <= 24);
      assert.ok(note.finger >= 0 && note.finger <= 4);
      assert.equal(note.strong, isStrongBeat(note.beat));
      if (note.strong) assert.equal(note.chordTone, true);
      if (note.fret === 0) assert.equal(note.finger, 0);
      else {
        assert.equal(note.finger, note.fret - note.position + 1);
        assert.ok(note.fret >= note.position && note.fret <= note.position + 3);
      }
      const shifted =
        index > 0 && note.position !== phrase.notes[index - 1].position;
      assert.equal(note.shift, shifted);
      if (shifted) phraseShifts += 1;
    }
    shifts += phraseShifts;
    maxShifts = Math.max(maxShifts, phraseShifts);
    assert.ok(phraseShifts <= 2);
    assert.equal(phrase.notes.at(-1)?.duration, 2);
    assert.equal(phrase.source, 'rules');

    const [first, middle, last] = thirdMeans(
      phrase.notes.map((note) => note.midi),
    );
    const contour = phrase.plan.contour;
    contourHits[contour].total += 1;
    const hit =
      contour === 'rise'
        ? last > first
        : contour === 'fall'
          ? first > last
          : contour === 'arch'
            ? middle > first && middle > last
            : middle < first && middle < last;
    if (hit) contourHits[contour].hit += 1;
  }

  const stepRatio = steps / (steps + leaps);
  const semitoneRatio = semitoneSteps / semitoneMoves;
  const strongRatio = strongChord / strong;
  console.log(
    JSON.stringify({
      phrases: corpus.length,
      scaleSteps: steps,
      scaleLeaps: leaps,
      scaleStepRatio: stepRatio,
      semitoneSteps,
      semitoneMoves,
      semitoneRatio,
      minScaleStepRatio: Math.min(...ratios),
      allScaleSteps: ratios.filter((ratio) => ratio === 1).length,
      shifts,
      maxShifts,
      contours: contourHits,
      invariants: {
        strongChord,
        strong,
        strongRatio,
        maxRange,
        cadence,
      },
    }),
  );
  assert.ok(strongRatio >= 0.7);
  assert.ok(stepRatio >= 0.66 && stepRatio <= 0.75, `step ratio ${stepRatio}`);
  assert.equal(cadence, corpus.length);
  assert.ok(maxRange <= PHRASE_RANGE);
  assert.ok(maxShifts <= 2);
  for (const contour of Object.keys(contourHits) as Contour[]) {
    const bucket = contourHits[contour];
    assert.ok(bucket.total > 0, contour);
    assert.ok(
      bucket.hit / bucket.total >= 0.7,
      `${contour} ${bucket.hit}/${bucket.total}`,
    );
  }
  for (const contour of ['arch', 'rise', 'fall', 'wave'] as const) {
    assert.ok(contourHeight(contour, 0) >= 0);
    assert.ok(contourHeight(contour, 1) <= 1);
  }
});

void test('F# major keeps scale spelling and a tonic default still lands', () => {
  const scaleNotes = scaleOf('F#', 'major');
  const result = generatePhrase({
    seed: 11,
    bars: 4,
    scaleNotes,
    chordNotes: parseChord('F#maj7').notes,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const allowed = new Set(['F#', 'G#', 'A#', 'B', 'C#', 'D#', 'E#']);
  for (const note of result.phrase.notes) assert.ok(allowed.has(note.name));

  const tonic = defaultChordNotes(scaleOf('C', 'major'));
  assert.deepEqual(
    tonic.map((note) => note.degree),
    ['1', '3', '5'],
  );
  const fallback = generatePhrase({
    seed: 4,
    bars: 2,
    scaleNotes: scaleOf('C', 'major'),
    chordNotes: tonic,
  });
  assert.equal(fallback.ok, true);
});

void test('hidden dots, snapshots, and a chord outside the scale', () => {
  const input = contextInput('C', 'major', 'C');
  const result = generatePhrase({ seed: 9, bars: 2, ...input });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(phraseFretMarks(result.phrase.notes, 'hidden', 0), []);
  const shown = phraseFretMarks(result.phrase.notes, 'shown', 0);
  assert.ok(shown.length > 0);
  assert.equal(
    shown.some((mark) => mark.current),
    true,
  );

  const snapshot = phraseSnapshot({
    seed: 9,
    bars: 2,
    feel: 'swing',
    tempo: 96,
    slow: true,
    scaleRoot: 'C',
    scaleId: 'major',
    chordSymbol: 'C',
    plan: result.phrase.plan,
    locks: { rhythm: 'quarters' },
  });
  assert.equal(snapshot.version, 1);
  assert.equal(snapshot.locks.rhythm, 'quarters');

  const outside = generatePhrase({
    seed: 1,
    bars: 2,
    scaleNotes: scaleOf('C', 'major'),
    chordNotes: parseChord('C#5').notes,
  });
  assert.deepEqual(outside, { ok: false, reason: 'no-shared-tones' });
});

void test('the planner makes one call, times out, and loses to locks', async () => {
  const input = contextInput('C', 'major', 'C');
  const rules = generatePhrase({ seed: 5, bars: 2, ...input });
  assert.equal(rules.ok, true);
  const bare = await generatePhraseWithPlanner({ seed: 5, bars: 2, ...input });
  assert.deepEqual(bare, rules);

  let calls = 0;
  const hanging: PhrasePlanner = {
    propose() {
      calls += 1;
      return new Promise(() => undefined);
    },
  };
  const started = Date.now();
  const timed = await generatePhraseWithPlanner({
    seed: 5,
    bars: 2,
    ...input,
    planner: hanging,
    timeoutMs: 30,
  });
  assert.equal(calls, 1);
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(timed, rules);

  const failing: PhrasePlanner = {
    propose() {
      calls += 1;
      throw new Error('planner down');
    },
  };
  const failed = await generatePhraseWithPlanner({
    seed: 5,
    bars: 2,
    ...input,
    planner: failing,
    timeoutMs: 30,
  });
  assert.deepEqual(failed, rules);

  const proposing: PhrasePlanner = {
    propose(request) {
      calls += 1;
      assert.equal(request.signal.aborted, false);
      assert.equal(request.seed, 5);
      return Promise.resolve({
        contour: 'rise',
        rhythm: 'eighths',
        register: 'high',
        cadence: 'ninth' as CadenceTarget,
      });
    },
  };
  const planned = await generatePhraseWithPlanner({
    seed: 5,
    bars: 2,
    ...input,
    planner: proposing,
    locks: { rhythm: 'quarters' },
    chordSymbol: 'C',
    scaleLabel: 'C major',
  });
  assert.equal(planned.ok, true);
  if (planned.ok) {
    assert.equal(planned.phrase.source, 'planner');
    assert.equal(planned.phrase.plan.contour, 'rise');
    assert.equal(planned.phrase.plan.rhythm, 'quarters');
    assert.equal(planned.phrase.plan.register, 'high');
    assert.ok(['root', 'third', 'fifth'].includes(planned.phrase.plan.cadence));
  }
  assert.equal(calls, 3);

  const source = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('XMLHttpRequest'), false);
  assert.equal(source.includes('voicing-audio'), false);
  assert.equal(source.includes('drone'), false);
});
