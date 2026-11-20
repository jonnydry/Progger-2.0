import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PHRASE_TEMPO_MIN } from '../lib/phrase-audio.ts';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, TUNING, type Note } from '../lib/music.ts';
import {
  PHRASE_RANGE,
  REGISTER_LOW,
  availableCadences,
  cadenceRole,
  contourHeight,
  defaultChordNotes,
  generatePhrase,
  handShiftCost,
  landingPitchClasses,
  isStrongBeat,
  melodicMotion,
  beatAtSeconds,
  fullSwingRatio,
  onsetSeconds,
  parseSeed,
  phraseFretMarks,
  phrasePeriodBeats,
  phraseRuleReport,
  rulePlan,
  withinHand,
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
  type Contour,
  type Phrase,
  type PhraseSnapshot,
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
  assert.equal(phrasePeriodBeats(2), 10);
  assert.equal(phrasePeriodBeats(4), 18);
  const full120 =
    SWING_ANCHOR_SLOW_RATIO +
    (SWING_ANCHOR_MID_RATIO - SWING_ANCHOR_SLOW_RATIO) *
      ((120 - SWING_ANCHOR_SLOW_BPM) /
        (SWING_ANCHOR_MID_LOW_BPM - SWING_ANCHOR_SLOW_BPM));
  const light120 = 1 + (full120 - 1) * SWING_AMOUNT_DEFAULT;
  const light96 = 1 + (SWING_ANCHOR_SLOW_RATIO - 1) * SWING_AMOUNT_DEFAULT;
  assert.equal(onsetSeconds(0, 120, SWING_AMOUNT_DEFAULT), 0);
  assert.equal(onsetSeconds(1, 120, 'straight'), 0.5);
  assert.equal(onsetSeconds(0.5, 120, 'straight'), 0.25);
  assert.equal(
    onsetSeconds(0.5, 120, SWING_AMOUNT_DEFAULT),
    (light120 / (light120 + 1)) * 0.5,
  );
  assert.equal(
    onsetSeconds(2.5, 96, SWING_AMOUNT_DEFAULT),
    (2 + light96 / (light96 + 1)) * (60 / 96),
  );
  assert.ok(
    Math.abs(onsetSeconds(0.5, 120, SWING_AMOUNT_DEFAULT) - (2 / 3) * 0.5) >
      0.02,
  );
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
  const rhythmLocked = rulePlan(7, ['root', 'third', 'fifth'], {
    rhythm: 'eighths',
  });
  assert.equal(rhythmLocked.rhythm, 'eighths');
  assert.equal(rhythmLocked.contour, open.contour);
  assert.equal(rhythmLocked.register, open.register);
  assert.equal(rhythmLocked.cadence, open.cadence);
  assert.equal(rulePlan(3, ['root'], { cadence: 'fifth' }).cadence, 'root');
});

void test('a new session defaults to straight swing', () => {
  assert.equal(SWING_AMOUNT_DEFAULT, 0);
  assert.equal(
    swingRatioForAmount(120, SWING_AMOUNT_DEFAULT),
    SWING_RATIO_STRAIGHT,
  );
  assert.equal(onsetSeconds(1, 120, SWING_AMOUNT_DEFAULT), 0.5);
  assert.equal(onsetSeconds(0.5, 120, SWING_AMOUNT_DEFAULT), 0.25);
});

void test('swing amount follows the tempo anchors and keeps a 100 ms short eighth', () => {
  assert.equal(SWING_AMOUNT_MIN, 0);
  assert.equal(SWING_AMOUNT_MAX, 1);
  assert.equal(SWING_AMOUNT_DEFAULT, 0);
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
  const sweepMin = PHRASE_TEMPO_MIN;
  assert.equal(sweepMin, 40);
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

function assertNoteWindow(midi: number, low: number): void {
  if (midi >= low && midi <= low + PHRASE_RANGE) return;
  assert.ok(
    [midi - 12, midi + 12].some(
      (partner) => partner >= low && partner <= low + PHRASE_RANGE,
    ),
    `${midi} leaves the register window by a non-octave`,
  );
}

function assertPhraseReach(phrase: {
  plan: { register: 'low' | 'mid' | 'high' };
  notes: { midi: number }[];
}): void {
  const low = { low: 40, mid: 55, high: 64 }[phrase.plan.register];
  for (const note of phrase.notes) assertNoteWindow(note.midi, low);
}

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
  let coreRange = 0;
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
    assert.equal(report.cadenceHit, true);
    assertPhraseReach(phrase);
    assert.ok(report.strong > 0);
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
    const low = { low: 40, mid: 55, high: 64 }[phrase.plan.register];
    const high = low + PHRASE_RANGE;
    const midis = phrase.notes.map((note) => note.midi);
    const inside = midis.filter((midi) => midi >= low && midi <= high);
    if (inside.length > 0) {
      coreRange = Math.max(
        coreRange,
        Math.max(...inside) - Math.min(...inside),
      );
    }
    // A span past the window is an octave copy sitting outside it.
    // The notes that stay in the window still cover at most PHRASE_RANGE.
    if (report.range > PHRASE_RANGE) {
      const outside = midis.filter((midi) => midi < low || midi > high);
      assert.ok(
        outside.length > 0,
        `range ${report.range} without an octave copy`,
      );
    }
    let phraseShifts = 0;
    for (let index = 0; index < phrase.notes.length; index++) {
      const note = phrase.notes[index];
      assert.ok(names.has(note.name), `${note.name} leaves the scale spelling`);
      assertNoteWindow(note.midi, low);
      assert.equal(note.midi, TUNING[note.string] + note.fret);
      assert.ok(note.fret >= 0 && note.fret <= 24);
      assert.ok(note.finger >= 0 && note.finger <= 4);
      assert.equal(note.strong, isStrongBeat(note.beat));
      assert.ok(Math.abs(note.beat * 2 - Math.round(note.beat * 2)) < 1e-6);
      if (index + 1 < phrase.notes.length) {
        const gap = phrase.notes[index + 1].beat - note.beat;
        assert.ok(note.duration > 0 && note.duration <= gap + 1e-9);
      }
      if (note.fret === 0) assert.equal(note.finger, 0);
      else {
        assert.equal(note.finger, note.fret - note.position + 1);
        assert.ok(note.fret >= note.position && note.fret <= note.position + 3);
      }
      const moved =
        index > 0
          ? Math.abs(note.position - phrase.notes[index - 1].position)
          : 0;
      const shifted = moved >= 4;
      assert.equal(note.shift, shifted);
      if (shifted) phraseShifts += 1;
    }
    shifts += phraseShifts;
    maxShifts = Math.max(maxShifts, phraseShifts);
    assert.ok(phraseShifts <= 2);
    assert.equal(phrase.notes.at(-1)?.beat, phrase.bars * 4);
    assert.equal(phrase.notes.at(-1)?.duration, 2);
    assert.ok(
      phrase.notes.slice(0, -1).every((note) => note.beat < phrase.bars * 4),
    );
    assert.equal(phrasePeriodBeats(phrase.bars), phrase.bars * 4 + 2);

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
  assert.ok(strongRatio >= 0.5, `strong chord ${strongRatio}`);
  assert.ok(strongRatio <= 0.88, `strong chord ${strongRatio}`);
  assert.ok(stepRatio >= 0.5, `step ratio ${stepRatio}`);
  assert.equal(cadence, corpus.length);
  // Octave copies may leave the window. Everything else stays inside, so
  // the in-window span stays at PHRASE_RANGE. A raw span of 36 is not allowed.
  assert.ok(coreRange <= PHRASE_RANGE, `core range ${coreRange}`);
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

  const snapshot: PhraseSnapshot = {
    version: 1,
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
  };
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

void test('the generator stays pure: no network, audio, or drone imports', () => {
  const source = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('fetch('), false);
  assert.equal(source.includes('XMLHttpRequest'), false);
  assert.equal(source.includes('voicing-audio'), false);
  assert.equal(source.includes('drone'), false);
  // The planner seam was removed rather than left as an unused promise.
  assert.equal(source.includes('Planner'), false);
  assert.equal(source.includes('phraseSnapshot'), false);
});

void test('a reach of three frets costs a shift, and an eighth costs ten more', () => {
  // Staying put is free. Any real move pays the shift cost plus the frets
  // traveled. The label still starts at 4: three frets is not a shift.
  // Onto an eighth the shift cost is paid again ten times.
  assert.equal(handShiftCost(0, false), 0);
  assert.equal(handShiftCost(0, true), 0);
  assert.equal(handShiftCost(3, false), 23);
  assert.equal(handShiftCost(-3, false), 23);
  assert.equal(handShiftCost(3, true), 223);
  assert.equal(handShiftCost(4, false), 24);
  assert.equal(handShiftCost(-5, false), 25);
  assert.equal(handShiftCost(4, true), 224);
});

void test('C major seed 3 stays in one hand on quarter notes', () => {
  const result = generatePhrase({
    seed: 3,
    bars: 2,
    scaleNotes: scaleOf('C', 'major'),
    chordNotes: parseChord('C').notes,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.phrase.plan.rhythm, 'quarters');
  assert.equal(
    result.phrase.notes.some((note) => note.shift),
    false,
  );
  for (const note of result.phrase.notes) {
    assert.ok(note.fret >= 0 && note.fret <= 24);
    if (note.fret === 0) assert.equal(note.finger, 0);
    else assert.equal(note.finger, note.fret - note.position + 1);
  }
  assert.equal(result.phrase.notes.at(-1)?.beat, 8);
  assert.equal(result.phrase.notes.at(-1)?.duration, 2);
});

const FINGER_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'Eb'] as const;
const FINGER_SCALES = [
  'major',
  'dorian',
  'mixolydian',
  'minor',
  'minor-blues',
  'minor-pentatonic',
  'harmonic-minor',
] as const;
const FINGER_FIFTH: Record<string, string> = {
  C: 'G',
  D: 'A',
  E: 'B',
  F: 'C',
  G: 'D',
  A: 'E',
  Bb: 'F',
  Eb: 'Bb',
};
const FINGER_FOURTH: Record<string, string> = {
  C: 'F',
  D: 'G',
  E: 'A',
  F: 'Bb',
  G: 'C',
  A: 'D',
  Bb: 'Eb',
  Eb: 'Ab',
};

function fingerSymbols(root: string, scaleId: string): string[] {
  if (scaleId === 'major') return [root, FINGER_FOURTH[root]];
  if (scaleId === 'mixolydian') return [`${root}7`, FINGER_FOURTH[root]];
  if (scaleId === 'minor-blues') return [`${root}m7`, `${FINGER_FIFTH[root]}7`];
  return [`${root}m`, `${FINGER_FIFTH[root]}7`];
}

void test('no eighth is played by sliding the same finger', () => {
  let sameFingerEighth = 0;
  for (const root of FINGER_ROOTS) {
    for (const scaleId of FINGER_SCALES) {
      const scaleNotes = scaleOf(root, scaleId);
      for (const symbol of fingerSymbols(root, scaleId)) {
        const chordNotes = parseChord(symbol).notes;
        for (const bars of [2, 4] as const) {
          for (let seed = 1; seed <= 12; seed++) {
            const result = generatePhrase({
              seed,
              bars,
              scaleNotes,
              chordNotes,
            });
            assert.equal(result.ok, true);
            if (!result.ok) continue;
            const notes = result.phrase.notes;
            for (let index = 1; index < notes.length; index++) {
              const from = notes[index - 1];
              const to = notes[index];
              if (
                from.finger > 0 &&
                to.finger === from.finger &&
                to.fret !== from.fret &&
                to.duration <= 0.5
              )
                sameFingerEighth += 1;
            }
          }
        }
      }
    }
  }
  assert.equal(sameFingerEighth, 0);
});

void test('a locked rhythm does not slide one finger onto an eighth', () => {
  const rhythms = ['quarters', 'eighths', 'long-short', 'push'] as const;
  const slides = { quarters: 0, eighths: 0, 'long-short': 0, push: 0 };
  for (const rhythm of rhythms) {
    for (const root of FINGER_ROOTS) {
      for (const scaleId of FINGER_SCALES) {
        const scaleNotes = scaleOf(root, scaleId);
        for (const symbol of fingerSymbols(root, scaleId)) {
          const chordNotes = parseChord(symbol).notes;
          for (const bars of [2, 4] as const) {
            for (let seed = 1; seed <= 12; seed++) {
              const result = generatePhrase({
                seed,
                bars,
                scaleNotes,
                chordNotes,
                locks: { rhythm },
              });
              assert.equal(result.ok, true);
              if (!result.ok) continue;
              const notes = result.phrase.notes;
              for (let index = 1; index < notes.length; index++) {
                const from = notes[index - 1];
                const to = notes[index];
                if (
                  from.finger > 0 &&
                  to.finger === from.finger &&
                  to.fret !== from.fret &&
                  to.duration <= 0.5
                )
                  slides[rhythm] += 1;
              }
            }
          }
        }
      }
    }
  }
  assert.equal(slides.quarters, 0);
  assert.equal(slides.eighths, 0);
  assert.equal(slides['long-short'], 0);
  assert.equal(slides.push, 0);
});

void test('a cadence lock lands on the chord root', () => {
  const result = generatePhrase({
    seed: 8,
    bars: 2,
    scaleNotes: scaleOf('D', 'dorian'),
    chordNotes: parseChord('A7').notes,
    locks: { cadence: 'root' },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.phrase.plan.cadence, 'root');
  const notes = result.phrase.notes;
  assert.equal(notes.at(-1)?.pc, 9);
  assert.equal(notes.at(-1)?.beat, 8);
  assert.equal(notes.at(-1)?.duration, 2);
  for (let index = 1; index < notes.length; index++) {
    const from = notes[index - 1];
    const to = notes[index];
    if (to.duration <= 0.5 && !to.shift)
      assert.equal(withinHand(to.midi, from.position, 3), true);
  }
});

void test('an eighth reaches three frets and a quarter may slide one box', () => {
  // G4 sits in the position-5 box. Three frets of slack still reaches it.
  assert.equal(withinHand(67, 8, 3), true);
  // B4's closest box is 4 frets from position 0: an eighth cannot shift
  // that far, and a quarter can slide the five frets.
  assert.equal(withinHand(71, 0, 3), false);
  assert.equal(withinHand(71, 0, 5), true);
  assert.equal(withinHand(71, 4, 3), true);
});

void test('Bb minor seed 4 keeps the low wave plan', () => {
  const scaleNotes = scaleOf('Bb', 'minor');
  const chordNotes = parseChord('F7').notes;
  const result = generatePhrase({
    seed: 4,
    bars: 4,
    scaleNotes,
    chordNotes,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.phrase.plan.contour, 'wave');
  assert.equal(result.phrase.plan.rhythm, 'eighths');
  assert.equal(result.phrase.plan.register, 'low');
  const report = phraseRuleReport(result.phrase, scaleNotes, chordNotes);
  assert.equal(report.unisons, 0);
  assert.equal(report.cadenceHit, true);
  for (const note of result.phrase.notes) {
    assert.ok(Math.abs(note.beat * 2 - Math.round(note.beat * 2)) < 1e-6);
  }
});

void test('middle and high registers avoid stray open strings', () => {
  const contexts = [
    ['C', 'major', 'C'],
    ['A', 'dorian', 'Am'],
    ['E', 'minor', 'Em'],
    ['G', 'mixolydian', 'G7'],
  ] as const;
  let midTotal = 0;
  let midOpen = 0;
  let highTotal = 0;
  let highOpen = 0;
  for (const [root, scaleId, chord] of contexts) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(chord).notes;
    for (let seed = 1; seed <= 30; seed++) {
      for (const register of ['mid', 'high'] as const) {
        const result = generatePhrase({
          seed,
          bars: 2,
          scaleNotes,
          chordNotes,
          locks: { register },
        });
        assert.equal(result.ok, true);
        if (!result.ok) continue;
        const hasOpen = result.phrase.notes.some((note) => note.fret === 0);
        if (register === 'mid') {
          midTotal += 1;
          if (hasOpen) midOpen += 1;
        } else {
          highTotal += 1;
          if (hasOpen) highOpen += 1;
        }
      }
    }
  }
  assert.equal(highOpen, 0, `high register leaked open strings in ${highOpen}/${highTotal} phrases`);
  assert.ok(
    midOpen / midTotal < 0.03,
    `mid register leaked open strings in ${midOpen}/${midTotal} phrases`,
  );
});

void test('modal scales feature their characteristic color tone and pentatonic scales resolve by scale step', () => {
  const modalCases = [
    ['D', 'dorian', 'Dm', '6'],
    ['F', 'lydian', 'F', '#4'],
    ['E', 'phrygian', 'Em', 'b2'],
    ['G', 'mixolydian', 'G7', 'b7'],
  ] as const;
  for (const [root, scaleId, chord, color] of modalCases) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(chord).notes;
    let hits = 0;
    const total = 40;
    for (let seed = 1; seed <= total; seed++) {
      const result = generatePhrase({ seed, bars: 2, scaleNotes, chordNotes });
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      if (result.phrase.notes.slice(0, -1).some((note) => note.degree === color))
        hits += 1;
    }
    assert.ok(
      hits / total >= 0.75,
      `${root} ${scaleId} omitted color ${color}: only ${hits}/${total}`,
    );
  }
  const pentNotes = scaleOf('A', 'minor-pentatonic');
  const pentPcs = new Set(pentNotes.map((note) => note.pc));
  const amNotes = parseChord('Am').notes;
  let stepCadences = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const result = generatePhrase({
      seed,
      bars: 2,
      scaleNotes: pentNotes,
      chordNotes: amNotes,
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    const notes = result.phrase.notes;
    const prev = notes[notes.length - 2];
    const last = notes[notes.length - 1];
    if (prev && last && melodicMotion(prev.midi, last.midi, pentPcs) === 'step')
      stepCadences += 1;
  }
  assert.ok(
    stepCadences >= 34,
    `A minor pentatonic resolved by scale step only ${stepCadences}/40 times`,
  );
});

void test('phrases breathe with quarter rests and true beat-crossing offbeat pushes', () => {
  const scaleNotes = scaleOf('C', 'major');
  const chordNotes = parseChord('C').notes;
  let quarterRestPhrases = 0;
  let pushSustainedPhrases = 0;
  for (let seed = 1; seed <= 80; seed++) {
    const result = generatePhrase({ seed, bars: 2, scaleNotes, chordNotes });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    const notes = result.phrase.notes;
    let hasQuarterRest = false;
    let hasOffbeatPush = false;
    for (let i = 0; i < notes.length - 1; i++) {
      const note = notes[i];
      const next = notes[i + 1];
      if (next.beat - (note.beat + note.duration) >= 1 - 1e-6)
        hasQuarterRest = true;
      if (Math.abs((note.beat % 1) - 0.5) < 0.01 && note.duration > 0.5 + 1e-6)
        hasOffbeatPush = true;
    }
    if (hasQuarterRest) quarterRestPhrases += 1;
    if (hasOffbeatPush) pushSustainedPhrases += 1;
  }
  assert.ok(
    quarterRestPhrases >= 10,
    `expected >= 10 phrases with quarter-or-longer rests, got ${quarterRestPhrases}`,
  );
  assert.ok(
    pushSustainedPhrases >= 10,
    `expected >= 10 phrases with beat-crossing offbeat pushes, got ${pushSustainedPhrases}`,
  );
});

void test('low register reaches open low E2 and 6/8-note box forms keep spans compact', () => {
  const eMinor = scaleOf('E', 'minor');
  const emChord = parseChord('Em').notes;
  let belowC3 = 0;
  let openLowE = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const result = generatePhrase({
      seed,
      bars: 2,
      scaleNotes: eMinor,
      chordNotes: emChord,
      locks: { register: 'low' },
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    for (const note of result.phrase.notes) {
      if (note.midi < 48) belowC3 += 1;
      if (note.midi === 40 && note.string === 0 && note.fret === 0) {
        openLowE += 1;
      }
    }
  }
  assert.ok(belowC3 > 20, `low register barely reached below C3: ${belowC3}`);
  assert.ok(openLowE > 0, 'low register never used open low E2');

  const blues = scaleOf('A', 'minor-blues');
  const am7 = parseChord('Am7').notes;
  let wideSpan = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const result = generatePhrase({
      seed,
      bars: 2,
      scaleNotes: blues,
      chordNotes: am7,
      locks: { register: 'mid' },
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    const fretted = result.phrase.notes
      .map((note) => note.fret)
      .filter((fret) => fret > 0);
    if (fretted.length && Math.max(...fretted) - Math.min(...fretted) > 5) {
      wideSpan += 1;
    }
  }
  assert.ok(
    wideSpan <= 3,
    `blues mid-register box forms exceeded 5-fret span too often: ${wideSpan}/30`,
  );
});

void test('optional chromatic approaches stay off by default and resolve by half step when enabled', () => {
  const cMajor = scaleOf('C', 'major');
  const scalePcs = new Set(cMajor.map((note) => note.pc));
  const cmaj7 = parseChord('Cmaj7').notes;
  let chromaticPhrases = 0;
  let chromaticNotes = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const plain = generatePhrase({
      seed,
      bars: 4,
      scaleNotes: cMajor,
      chordNotes: cmaj7,
    });
    assert.equal(plain.ok, true);
    if (!plain.ok) continue;
    assert.equal(
      plain.phrase.notes.some((note) => note.degree === 'chr'),
      false,
      `default phrase should remain strictly diatonic (seed ${seed})`,
    );
    const enriched = generatePhrase({
      seed,
      bars: 4,
      scaleNotes: cMajor,
      chordNotes: cmaj7,
      locks: { chromatic: true },
    });
    assert.equal(enriched.ok, true);
    if (!enriched.ok) continue;
    assert.equal(enriched.phrase.plan.chromatic, true);
    let hits = 0;
    const enrichedNotes = enriched.phrase.notes;
    for (let i = 0; i < enrichedNotes.length; i++) {
      const current = enrichedNotes[i];
      if (!current || current.degree !== 'chr') continue;
      hits += 1;
      chromaticNotes += 1;
      assert.equal(current.chordTone, false);
      assert.equal(scalePcs.has(current.pc), false);
      const target = enrichedNotes[i + 1];
      assert.ok(target, 'chromatic approach must resolve to a following note');
      assert.equal(Math.abs(target.midi - current.midi), 1);
      if (target.midi > current.midi) {
        assert.equal(
          current.name.includes('b'),
          false,
          `ascending chromatic ${current.name} -> ${target.name} should not use flat`,
        );
      } else {
        assert.equal(
          current.name.includes('#'),
          false,
          `descending chromatic ${current.name} -> ${target.name} should not use sharp`,
        );
      }
    }
    if (hits > 0) chromaticPhrases += 1;
    assert.ok(hits <= 2, `too many chromatic approaches in 4 bars: ${hits}`);
  }
  assert.ok(
    chromaticPhrases >= 12,
    `expected >= 12/40 chromatic phrases, got ${chromaticPhrases} (${chromaticNotes} notes)`,
  );
});

void test('optional pickup start enters on the upbeat after beat 1 and anchors note 2 on a chord tone', () => {
  const dDorian = scaleOf('D', 'dorian');
  const dm7 = parseChord('Dm7').notes;
  let anchored = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const result = generatePhrase({
      seed,
      bars: 2,
      scaleNotes: dDorian,
      chordNotes: dm7,
      locks: { pickup: true },
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.phrase.plan.pickup, true);
    const first = result.phrase.notes[0];
    const second = result.phrase.notes[1];
    assert.ok(first && second);
    assert.ok(
      first.beat >= 0.5 - 1e-6 && first.beat < 1.5,
      `expected upbeat pickup start, got beat ${first.beat} (seed ${seed})`,
    );
    if (second.chordTone) anchored += 1;
  }
  assert.ok(
    anchored >= 22,
    `expected >= 22/30 pickups to anchor note 2 on a chord tone, got ${anchored}`,
  );
});

void test('optional two-chord turnaround targets chord 2 in bars 3-4 and resolves home to chord 1', () => {
  const cMajor = scaleOf('C', 'major');
  const cmaj7 = parseChord('Cmaj7').notes;
  const g7 = parseChord('G7').notes;
  const cmaj7Pcs = new Set(cmaj7.map((note) => note.pc));
  const g7Pcs = new Set(g7.map((note) => note.pc));
  let bar3G7Hits = 0;
  let bar3G7Total = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const result = generatePhrase({
      seed,
      bars: 4,
      scaleNotes: cMajor,
      chordNotes: cmaj7,
      turnaroundChordNotes: g7,
      turnaroundSymbol: 'G7',
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.phrase.plan.turnaround, 'G7');
    const notes = result.phrase.notes;
    const landing = notes[notes.length - 1];
    assert.ok(
      cmaj7Pcs.has(landing.pc),
      `turnaround should resolve home to Cmaj7, got ${landing.name}`,
    );
    const bar34 = notes.filter((note) => note.beat >= 8 && note.beat < 16);
    assert.ok(bar34.length > 0);
    for (const note of bar34) {
      assert.equal(
        note.chordTone,
        g7Pcs.has(note.pc),
        `bar 3-4 chordTone flag should match G7 (note ${note.name} at beat ${note.beat})`,
      );
      if (note.strong) {
        bar3G7Total += 1;
        if (g7Pcs.has(note.pc)) bar3G7Hits += 1;
      }
    }
  }
  const ratio = bar3G7Hits / Math.max(1, bar3G7Total);
  assert.ok(
    ratio >= 0.65,
    `expected >= 65% strong beats in bars 3-4 on G7 chord tones, got ${(ratio * 100).toFixed(1)}%`,
  );
});

void test('adversarial guards: pickup seams, chromatic contours/spelling, turnaround bar-3 anchor, and fretted positions', () => {
  const cMajor = scaleOf('C', 'major');
  const cChord = parseChord('C').notes;
  const gChord = parseChord('G').notes;
  const gPcs = new Set(gChord.map((note) => note.pc));

  // 1. Pickup loop seams obey non-unison, <= octave, and <= fourth onto fast pickup.
  for (let seed = 1; seed <= 60; seed++) {
    const res = generatePhrase({
      seed,
      bars: 2,
      scaleNotes: cMajor,
      chordNotes: cChord,
      locks: { pickup: true },
    });
    assert.equal(res.ok, true);
    if (!res.ok) continue;
    const first = res.phrase.notes[0];
    const body = res.phrase.notes.filter((note) => note.beat < 8);
    const last = body[body.length - 1];
    assert.ok(first && last);
    const gap = Math.abs(first.midi - last.midi);
    assert.ok(gap > 0 && gap <= 12, `illegal pickup seam gap ${gap} (seed ${seed})`);
  }

  // 2. Chromatic approaches preserve enharmonic spelling in extreme sharp/flat keys and stay inside register.
  const exotic: readonly (readonly [string, string, string])[] = [
    ['C#', 'major-pentatonic', 'C#'],
    ['Db', 'locrian', 'Dbdim'],
    ['Ab', 'locrian', 'Abdim'],
    ['Gb', 'locrian', 'Gbdim'],
  ];
  for (const [root, sid, sym] of exotic) {
    const scale = scaleOf(root, sid);
    const chord = parseChord(sym).notes;
    for (let seed = 1; seed <= 10; seed++) {
      const res = generatePhrase({
        seed,
        bars: 4,
        scaleNotes: scale,
        chordNotes: chord,
        locks: { chromatic: true },
      });
      if (!res.ok) continue;
      const low = REGISTER_LOW[res.phrase.plan.register];
      const notes = res.phrase.notes;
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i];
        assert.ok(
          note.midi >= low && note.midi <= low + 18,
          `chromatic note escaped register [${low}, ${low + 18}]: ${note.midi}`,
        );
        if (note.degree === 'chr') {
          const target = notes[i + 1];
          assert.ok(target);
          assert.notEqual(`${note.name}->${target.name}`, 'Gb->E#');
          assert.notEqual(`${note.name}->${target.name}`, 'D#->Fb');
          assert.notEqual(`${note.name}->${target.name}`, 'A#->Cb');
          assert.notEqual(`${note.name}->${target.name}`, 'G#->Bbb');
        }
      }
    }
  }

  // 3. Turnaround Bar 3 first note reliably anchors on Chord 2.
  let bar3Anchored = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const res = generatePhrase({
      seed,
      bars: 4,
      scaleNotes: cMajor,
      chordNotes: cChord,
      turnaroundChordNotes: gChord,
      turnaroundSymbol: 'G',
    });
    assert.equal(res.ok, true);
    if (!res.ok) continue;
    const bar3First = res.phrase.notes.find((note) => note.beat >= 8);
    assert.ok(bar3First);
    if (gPcs.has(bar3First.pc)) bar3Anchored += 1;
  }
  assert.ok(
    bar3Anchored >= 54,
    `expected >= 54/60 bar-3 turnaround anchors on G, got ${bar3Anchored}`,
  );

  // 4. No fretted note ever receives position 0, and mid-register blues/whole-tone avoid open strings.
  const wholeTone = scaleOf('A', 'whole-tone');
  const a7 = parseChord('A7').notes;
  for (let seed = 1; seed <= 20; seed++) {
    for (const register of ['low', 'mid'] as const) {
      const res = generatePhrase({
        seed,
        bars: 2,
        scaleNotes: wholeTone,
        chordNotes: a7,
        locks: { register },
      });
      if (!res.ok) continue;
      for (const note of res.phrase.notes) {
        if (note.fret > 0) {
          assert.ok(
            note.position >= 1,
            `fretted note fret=${note.fret} had position=${note.position}`,
          );
        }
        if (register === 'mid') {
          assert.ok(
            note.fret > 0,
            `mid-register whole-tone leaked open string (seed ${seed})`,
          );
        }
      }
    }
  }
});
