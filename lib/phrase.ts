import { mod, TUNING, type Note } from './music.ts';
import type { PhraseFretMark } from './phrase-marks.ts';

/**
 * Rule-based phrase generator.
 *
 * Later steps can lock a plan (`PhraseLocks`), store a `PhraseSnapshot`,
 * hide fret dots (`PhraseDotVisibility`), or replace the plan with one
 * server planner call. The planner is optional: one attempt, a short
 * timeout, then the seeded rules. This module never calls the network.
 */

export const PHRASE_PLANNER_TIMEOUT_MS = 800;
export const PHRASE_RANGE = 18;
/**
 * Anchor search and gap search each count one step per call.
 * The memoized engine peaks at 1803 steps: major-blues, C, 4 bars,
 * quarters / fall / low / root. The cap stays under the old 975fe75
 * minor-blues and whole-tone peaks at 4 bars. A search that has used
 * the cap refuses another step, so the count never becomes 4001, and
 * keeps the best complete line found so far.
 */
export const PHRASE_SEARCH_STEP_CAP = 4000;

let phraseSearchSteps = 0;
/** Highest count among the attempts inside one generate call. */
let phraseSearchPeak = 0;
/** A step was asked for after the cap. That step is not counted. */
let phraseSearchRefused = false;
let phraseSearchLimit = PHRASE_SEARCH_STEP_CAP;

/** Steps used by the most recent `generatePhrase` attempt. */
export function phraseSearchStepCount(): number {
  return Math.max(phraseSearchSteps, phraseSearchPeak);
}

/**
 * Tests pin the budget to the cost of one phrase. Production leaves this
 * at {@link PHRASE_SEARCH_STEP_CAP}.
 */
export function setPhraseSearchStepCapForTests(cap: number): void {
  phraseSearchLimit = cap;
}

/** The search has spent its budget. The next step is refused. */
function searchAtCap(): boolean {
  return phraseSearchSteps >= phraseSearchLimit;
}

function countSearchStep(): boolean {
  if (searchAtCap()) {
    phraseSearchRefused = true;
    return true;
  }
  phraseSearchSteps += 1;
  return false;
}

function resetSearchCount(): void {
  phraseSearchSteps = 0;
  phraseSearchPeak = 0;
  phraseSearchRefused = false;
}

/** Start another attempt without letting the new count hide an earlier one. */
function nextSearchAttempt(): void {
  phraseSearchPeak = Math.max(phraseSearchPeak, phraseSearchSteps);
  phraseSearchSteps = 0;
  phraseSearchRefused = false;
}

export type Contour = 'arch' | 'rise' | 'fall' | 'wave';
export type RhythmId = 'quarters' | 'eighths' | 'long-short' | 'push';
export type RegisterName = 'low' | 'mid' | 'high';
export type CadenceTarget = 'root' | 'third' | 'fifth';
export type Feel = 'straight' | 'swing';
export type PhraseSource = 'rules' | 'planner';
export type PhraseDotVisibility = 'shown' | 'hidden';

export type PhrasePlan = {
  contour: Contour;
  rhythm: RhythmId;
  register: RegisterName;
  cadence: CadenceTarget;
};

/** Songwriting locks. A later step can pin any of these and save the rest. */
export type PhraseLocks = {
  contour?: Contour;
  rhythm?: RhythmId;
  register?: RegisterName;
  cadence?: CadenceTarget;
};

export type PhrasePlannerInput = {
  seed: number;
  bars: 2 | 4;
  scaleNotes: readonly Note[];
  chordNotes: readonly Note[];
  locks?: PhraseLocks;
  signal: AbortSignal;
  scaleLabel?: string;
  chordSymbol?: string;
};

/** One proposal per phrase. Invalid fields are ignored; a failure falls back. */
export type PhrasePlanner = {
  propose(input: PhrasePlannerInput): Promise<Partial<PhrasePlan> | null>;
};

export type PhraseNote = {
  name: string;
  pc: number;
  degree: string;
  midi: number;
  beat: number;
  duration: number;
  strong: boolean;
  chordTone: boolean;
};

export type FingeredNote = PhraseNote & {
  string: number;
  fret: number;
  finger: number;
  position: number;
  shift: boolean;
};

export type Phrase = {
  seed: number;
  bars: 2 | 4;
  plan: PhrasePlan;
  source: PhraseSource;
  notes: FingeredNote[];
};

export type PhraseSnapshot = {
  version: 1;
  seed: number;
  bars: 2 | 4;
  feel: Feel;
  tempo: number;
  slow: boolean;
  scaleRoot: string;
  scaleId: string;
  chordSymbol: string;
  plan: PhrasePlan;
  locks: PhraseLocks;
};

export type PhraseFailure = 'no-shared-tones' | 'unplayable' | 'bad-input';
export type PhraseResult =
  | { ok: true; phrase: Phrase }
  | { ok: false; reason: PhraseFailure };

const CONTOURS = ['arch', 'rise', 'fall', 'wave'] as const;
const RHYTHMS = ['quarters', 'eighths', 'long-short', 'push'] as const;
const REGISTERS = ['low', 'mid', 'high'] as const;
const CADENCES = ['root', 'third', 'fifth'] as const;
const REGISTER_LOW: Record<RegisterName, number> = {
  low: 48,
  mid: 55,
  high: 64,
};
const RHYTHM_ONSETS: Record<RhythmId, readonly number[]> = {
  quarters: [0, 1, 2, 3],
  eighths: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  'long-short': [0, 1.5, 2, 3.5],
  push: [0, 1, 1.5, 2, 3, 3.5],
};
const LEAP_SIZES = [2, 3, 4];
const SHIFT_COST = 20;

export const RHYTHM_LABEL: Record<RhythmId, string> = {
  quarters: 'quarter notes',
  eighths: 'eighth notes',
  'long-short': 'long–short',
  push: 'pushed eighths',
};
export const CONTOUR_LABEL: Record<Contour, string> = {
  arch: 'arch',
  rise: 'rise',
  fall: 'fall',
  wave: 'wave',
};
export const REGISTER_LABEL: Record<RegisterName, string> = {
  low: 'low',
  mid: 'middle',
  high: 'high',
};
export const CADENCE_LABEL: Record<CadenceTarget, string> = {
  root: 'root',
  third: '3rd',
  fifth: '5th',
};

type LadderTone = { midi: number; note: Note; chordTone: boolean };
type Spot = { string: number; fret: number; position: number; finger: number };

export function cadenceRole(degree: string): CadenceTarget | null {
  const match = /^([b#]*)(\d+)$/.exec(degree);
  if (!match) return null;
  const simple = ((Number(match[2]) - 1) % 7) + 1;
  if (simple === 1) return 'root';
  if (simple === 3) return 'third';
  if (simple === 5) return 'fifth';
  return null;
}

/** Tonic chord tones already spelled in the scale, used when no chord is selected. */
export function defaultChordNotes(scaleNotes: readonly Note[]): Note[] {
  return scaleNotes.filter((note) => cadenceRole(note.degree) !== null);
}

export function landingPitchClasses(
  chordNotes: readonly Note[],
  scaleNotes: readonly Note[],
): Set<number> {
  const scale = new Set(scaleNotes.map((note) => note.pc));
  const landing = new Set<number>();
  for (const note of chordNotes) if (scale.has(note.pc)) landing.add(note.pc);
  return landing;
}

export function availableCadences(
  chordNotes: readonly Note[],
  scaleNotes: readonly Note[],
): CadenceTarget[] {
  const scale = new Set(scaleNotes.map((note) => note.pc));
  const found = new Set<CadenceTarget>();
  for (const note of chordNotes) {
    const role = cadenceRole(note.degree);
    if (role && scale.has(note.pc)) found.add(role);
  }
  return CADENCES.filter((role) => found.has(role));
}

export function cadencePitchClasses(
  chordNotes: readonly Note[],
  role: CadenceTarget,
  scalePcs: ReadonlySet<number>,
): number[] {
  const pcs: number[] = [];
  for (const note of chordNotes) {
    if (
      cadenceRole(note.degree) === role &&
      scalePcs.has(note.pc) &&
      !pcs.includes(note.pc)
    )
      pcs.push(note.pc);
  }
  return pcs;
}

export function isStrongBeat(beat: number): boolean {
  const within = ((beat % 4) + 4) % 4;
  const half = Math.round(within * 2) / 2;
  return half === 0 || half === 2;
}

export function phraseOnsets(rhythm: RhythmId, bars: 2 | 4): number[] {
  const pattern = RHYTHM_ONSETS[rhythm];
  const beats: number[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const onset of pattern) beats.push(bar * 4 + onset);
  }
  beats.push(bars * 4);
  return beats;
}

/** The cadence holds for two beats, then a loop can restart on the next downbeat. */
export function phrasePeriodBeats(bars: 2 | 4): number {
  return bars * 4 + 2;
}

/** Slider amount. 0 is straight, 1 is the tempo's full swing. */
export const SWING_AMOUNT_MIN = 0;
export const SWING_AMOUNT_MAX = 1;
export const SWING_AMOUNT_STEP = 0.01;
export const SWING_AMOUNT_DEFAULT = 0.6;

/** Long eighth to short eighth. 1 is straight. */
export const SWING_RATIO_STRAIGHT = 1;
/** The previous on/off swing: the offbeat at two thirds of the quarter. */
export const SWING_RATIO_LEGACY = 2;

/** Full swing at or below this tempo. */
export const SWING_ANCHOR_SLOW_BPM = 100;
export const SWING_ANCHOR_SLOW_RATIO = 1.75;
/** Full swing from here through the next anchor. */
export const SWING_ANCHOR_MID_LOW_BPM = 150;
export const SWING_ANCHOR_MID_HIGH_BPM = 200;
export const SWING_ANCHOR_MID_RATIO = 1.4;
/** Full swing at or above this tempo. */
export const SWING_ANCHOR_FAST_BPM = 250;
export const SWING_ANCHOR_FAST_RATIO = 1.1;

/**
 * The full-swing target may drop by at most this much from one BPM to the next.
 * The steepest anchor span is 0.35 over 50 BPM (0.007).
 */
export const SWING_FULL_RATIO_STEP_EPSILON = 0.01;

/** The short eighth stays at least this long. The floor lowers the ratio only. */
export const SWING_SHORT_EIGHTH_MIN_SEC = 0.1;

export type SwingInput = Feel | number;

/**
 * Full-swing ratio for a tempo. Anchors are 1.75:1 at or below 100 BPM,
 * 1.4:1 from 150 through 200, and 1.1:1 at or above 250. Tempos between
 * anchors move in a straight line, so the target never jumps and never
 * rises as the tempo rises. The downbeat, including the cadence, stays on
 * the quarter. There is no extra swing on the phrase end.
 */
export function fullSwingRatio(tempo: number): number {
  const bpm = tempo > 0 ? tempo : 96;
  if (bpm <= SWING_ANCHOR_SLOW_BPM) return SWING_ANCHOR_SLOW_RATIO;
  if (bpm >= SWING_ANCHOR_FAST_BPM) return SWING_ANCHOR_FAST_RATIO;
  if (bpm <= SWING_ANCHOR_MID_LOW_BPM) {
    const along =
      (bpm - SWING_ANCHOR_SLOW_BPM) /
      (SWING_ANCHOR_MID_LOW_BPM - SWING_ANCHOR_SLOW_BPM);
    return (
      SWING_ANCHOR_SLOW_RATIO +
      (SWING_ANCHOR_MID_RATIO - SWING_ANCHOR_SLOW_RATIO) * along
    );
  }
  if (bpm <= SWING_ANCHOR_MID_HIGH_BPM) return SWING_ANCHOR_MID_RATIO;
  const along =
    (bpm - SWING_ANCHOR_MID_HIGH_BPM) /
    (SWING_ANCHOR_FAST_BPM - SWING_ANCHOR_MID_HIGH_BPM);
  return (
    SWING_ANCHOR_MID_RATIO +
    (SWING_ANCHOR_FAST_RATIO - SWING_ANCHOR_MID_RATIO) * along
  );
}

/** Blend from 1:1 up to the tempo's full ratio, then keep the short eighth audible. */
export function swingRatioForAmount(tempo: number, amount: number): number {
  const finite = Number.isFinite(amount) ? amount : SWING_AMOUNT_MIN;
  const blend = Math.min(SWING_AMOUNT_MAX, Math.max(SWING_AMOUNT_MIN, finite));
  const span = SWING_AMOUNT_MAX - SWING_AMOUNT_MIN;
  const target = fullSwingRatio(tempo);
  const desired =
    SWING_RATIO_STRAIGHT +
    (target - SWING_RATIO_STRAIGHT) * ((blend - SWING_AMOUNT_MIN) / span);
  return clampSwingRatio(tempo, desired);
}

/**
 * Keep the short eighth at least 100 ms by lowering the long:short ratio.
 * The quarter stays put, so the two eighths still add up to one beat.
 */
export function clampSwingRatio(tempo: number, ratio: number): number {
  const quarter = 60 / (tempo > 0 ? tempo : 96);
  const maxRatio = quarter / SWING_SHORT_EIGHTH_MIN_SEC - SWING_RATIO_STRAIGHT;
  const room = Math.max(SWING_RATIO_STRAIGHT, maxRatio);
  return Math.min(Math.max(ratio, SWING_RATIO_STRAIGHT), room);
}

export function swingRatioOf(tempo: number, swing: SwingInput): number {
  if (swing === 'swing') return SWING_RATIO_LEGACY;
  if (swing === 'straight') return SWING_RATIO_STRAIGHT;
  return swingRatioForAmount(tempo, swing);
}

/** Where the offbeat sits in the quarter. 1:1 is halfway; 2:1 is two thirds. */
export function swingOffbeatFraction(ratio: number): number {
  return ratio / (ratio + SWING_RATIO_STRAIGHT);
}

/** Inverse of `onsetSeconds` for a playhead. */
export function beatAtSeconds(
  seconds: number,
  tempo: number,
  swing: SwingInput,
): number {
  const quarter = 60 / (tempo > 0 ? tempo : 96);
  const ratio = swingRatioOf(tempo, swing);
  if (ratio === SWING_RATIO_STRAIGHT) return seconds / quarter;
  const long = swingOffbeatFraction(ratio);
  const short = 1 - long;
  const quarters = seconds / quarter;
  const whole = Math.floor(quarters + 1e-9);
  const fraction = quarters - whole;
  if (fraction <= long) return whole + (fraction / long) * 0.5;
  return whole + 0.5 + ((fraction - long) / short) * 0.5;
}

export function onsetSeconds(
  beat: number,
  tempo: number,
  swing: SwingInput,
): number {
  const quarter = 60 / (tempo > 0 ? tempo : 96);
  const ratio = swingRatioOf(tempo, swing);
  if (ratio === SWING_RATIO_STRAIGHT) return beat * quarter;
  const whole = Math.floor(beat + 1e-9);
  const fraction = beat - whole;
  if (fraction < 0.01) return whole * quarter;
  if (Math.abs(fraction - 0.5) < 0.01)
    return (whole + swingOffbeatFraction(ratio)) * quarter;
  return beat * quarter;
}

export function contourHeight(contour: Contour, t: number): number {
  const x = Math.min(1, Math.max(0, t));
  switch (contour) {
    case 'arch':
      return Math.sin(Math.PI * x);
    case 'rise':
      return x;
    case 'fall':
      return 1 - x;
    case 'wave':
      return 0.5 - 0.5 * Math.cos(4 * Math.PI * x);
  }
}

export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] || 1;
}

/** The one seed check. Text and numbers both come through here. */
export function canonicalSeed(seed: number): number | null {
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) return null;
  return seed;
}

export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  return canonicalSeed(Number(trimmed));
}

export function rulePlan(
  seed: number,
  available: readonly CadenceTarget[],
  locks?: PhraseLocks,
): PhrasePlan {
  const random = mulberry32(seed);
  const choices: readonly CadenceTarget[] = available.length
    ? available
    : ['root'];
  // Roll every field before applying locks so a lock does not reshuffle the rest.
  const rolled: PhrasePlan = {
    contour: CONTOURS[Math.floor(random() * CONTOURS.length)],
    rhythm: RHYTHMS[Math.floor(random() * RHYTHMS.length)],
    register: REGISTERS[Math.floor(random() * REGISTERS.length)],
    cadence: choices[Math.floor(random() * choices.length)] ?? 'root',
  };
  return applyLocks(rolled, locks, choices);
}

function sanitizePlan(
  partial: Partial<PhrasePlan> | null | undefined,
  available: readonly CadenceTarget[],
): Partial<PhrasePlan> {
  if (!partial || typeof partial !== 'object') return {};
  const plan: Partial<PhrasePlan> = {};
  if (CONTOURS.includes(partial.contour as Contour))
    plan.contour = partial.contour;
  if (RHYTHMS.includes(partial.rhythm as RhythmId))
    plan.rhythm = partial.rhythm;
  if (REGISTERS.includes(partial.register as RegisterName))
    plan.register = partial.register;
  if (
    CADENCES.includes(partial.cadence as CadenceTarget) &&
    available.includes(partial.cadence as CadenceTarget)
  )
    plan.cadence = partial.cadence;
  return plan;
}

function applyLocks(
  plan: PhrasePlan,
  locks: PhraseLocks | undefined,
  available: readonly CadenceTarget[],
): PhrasePlan {
  const cadence =
    locks?.cadence && available.includes(locks.cadence)
      ? locks.cadence
      : available.includes(plan.cadence)
        ? plan.cadence
        : (available[0] ?? 'root');
  return {
    contour: locks?.contour ?? plan.contour,
    rhythm: locks?.rhythm ?? plan.rhythm,
    register: locks?.register ?? plan.register,
    cadence,
  };
}

export function phraseSnapshot(input: {
  seed: number;
  bars: 2 | 4;
  feel: Feel;
  tempo: number;
  slow: boolean;
  scaleRoot: string;
  scaleId: string;
  chordSymbol: string;
  plan: PhrasePlan;
  locks?: PhraseLocks;
}): PhraseSnapshot {
  return {
    version: 1,
    seed: input.seed,
    bars: input.bars,
    feel: input.feel,
    tempo: input.tempo,
    slow: input.slow,
    scaleRoot: input.scaleRoot,
    scaleId: input.scaleId,
    chordSymbol: input.chordSymbol,
    plan: input.plan,
    locks: input.locks ?? {},
  };
}

export function melodicMotion(
  from: number,
  to: number,
  scalePcs: ReadonlySet<number>,
): 'step' | 'leap' | 'unison' {
  if (from === to) return 'unison';
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  for (let midi = low + 1; midi < high; midi++) {
    if (scalePcs.has(mod(midi))) return 'leap';
  }
  return 'step';
}

export type PhraseRuleReport = {
  strong: number;
  strongChord: number;
  steps: number;
  leaps: number;
  /** Intervals of 1 or 2 semitones, whatever the scale calls them. */
  semitoneSteps: number;
  /** Intervals of 3 semitones or more. */
  semitoneLeaps: number;
  unisons: number;
  unresolved: number;
  range: number;
  cadenceHit: boolean;
};

export function phraseRuleReport(
  phrase: Phrase,
  scaleNotes: readonly Note[],
  chordNotes: readonly Note[],
): PhraseRuleReport {
  const scalePcs = new Set(scaleNotes.map((note) => note.pc));
  const chordPcs = landingPitchClasses(chordNotes, scaleNotes);
  const roles = cadencePitchClasses(chordNotes, phrase.plan.cadence, scalePcs);
  let strong = 0;
  let strongChord = 0;
  let steps = 0;
  let leaps = 0;
  let semitoneSteps = 0;
  let semitoneLeaps = 0;
  let unisons = 0;
  let unresolved = 0;
  for (let index = 0; index < phrase.notes.length; index++) {
    const note = phrase.notes[index];
    if (note.strong) {
      strong += 1;
      if (chordPcs.has(note.pc)) strongChord += 1;
    }
    if (index === 0) continue;
    const previous = phrase.notes[index - 1];
    const motion = melodicMotion(previous.midi, note.midi, scalePcs);
    const distance = Math.abs(note.midi - previous.midi);
    if (motion === 'step') steps += 1;
    else if (motion === 'leap') leaps += 1;
    else unisons += 1;
    if (distance > 0 && distance <= 2) semitoneSteps += 1;
    else if (distance > 2) semitoneLeaps += 1;
    if (motion !== 'leap') continue;
    const next = phrase.notes[index + 1];
    if (!next) {
      unresolved += 1;
      continue;
    }
    const resolution = melodicMotion(note.midi, next.midi, scalePcs);
    const opposite =
      Math.sign(next.midi - note.midi) ===
      -Math.sign(note.midi - previous.midi);
    if (resolution !== 'step' || !opposite) unresolved += 1;
  }
  const midis = phrase.notes.map((note) => note.midi);
  return {
    strong,
    strongChord,
    steps,
    leaps,
    semitoneSteps,
    semitoneLeaps,
    unisons,
    unresolved,
    range: Math.max(...midis) - Math.min(...midis),
    cadenceHit: roles.includes(phrase.notes[phrase.notes.length - 1].pc),
  };
}

function noteByPc(notes: readonly Note[]): Map<number, Note> {
  const map = new Map<number, Note>();
  for (const note of notes) if (!map.has(note.pc)) map.set(note.pc, note);
  return map;
}

function buildLadder(
  scaleNotes: readonly Note[],
  chordPcs: ReadonlySet<number>,
  register: RegisterName,
): LadderTone[] {
  const spelled = noteByPc(scaleNotes);
  const low = REGISTER_LOW[register];
  const ladder: LadderTone[] = [];
  for (let midi = low; midi <= low + PHRASE_RANGE; midi++) {
    const note = spelled.get(mod(midi));
    if (!note) continue;
    ladder.push({ midi, note, chordTone: chordPcs.has(note.pc) });
  }
  return ladder;
}

function closest(
  indexes: readonly number[],
  target: number,
  limit?: number,
): number[] {
  return [...indexes]
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b)
    .slice(0, limit ?? indexes.length);
}

function fillGap(
  from: number,
  to: number,
  intervals: number,
  leaps: number,
  length: number,
  cache: Map<string, number[] | null>,
): number[] | null {
  const key = `${from}|${to}|${intervals}|${leaps}|${length}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const path = [from];
  const missed = new Set<string>();
  const search = (
    pos: number,
    left: number,
    resolve: number,
    leapsLeft: number,
  ): boolean => {
    if (countSearchStep()) return false;
    const state = `${pos}|${left}|${resolve}|${leapsLeft}`;
    if (missed.has(state)) return false;
    const fail = () => {
      if (phraseSearchRefused) return false;
      missed.add(state);
      return false;
    };
    if (left === 0) {
      return pos === to && leapsLeft === 0 && resolve === 0 ? true : fail();
    }
    if (resolve !== 0) {
      const next = pos + resolve;
      if (next < 0 || next >= length) return fail();
      path.push(next);
      const ok = search(next, left - 1, 0, leapsLeft);
      if (!ok) path.pop();
      return ok || fail();
    }
    if (leapsLeft * 2 > left) return fail();
    if (leapsLeft === 0) {
      const distance = Math.abs(to - pos);
      if (distance > left || (left - distance) % 2 !== 0) return fail();
    }
    const toward = Math.sign(to - pos) || 1;
    const options: { next: number; leap: boolean; resolve: number }[] = [];
    const step = (sign: number) => {
      const next = pos + sign;
      if (next >= 0 && next < length)
        options.push({ next, leap: false, resolve: 0 });
    };
    const leap = (sign: number, size: number) => {
      if (left < 2 || leapsLeft < 1) return;
      const next = pos + sign * size;
      if (next >= 0 && next < length)
        options.push({ next, leap: true, resolve: -sign });
    };
    const tight = leapsLeft > 0 && left <= leapsLeft * 2 + 1;
    if (tight) {
      for (const size of LEAP_SIZES) {
        leap(toward, size);
        leap(-toward, size);
      }
      step(toward);
      step(-toward);
    } else {
      step(toward);
      step(-toward);
      if (leapsLeft > 0) {
        for (const size of LEAP_SIZES) {
          leap(toward, size);
          leap(-toward, size);
        }
      }
    }
    for (const option of options) {
      path.push(option.next);
      if (
        search(
          option.next,
          left - 1,
          option.resolve,
          leapsLeft - (option.leap ? 1 : 0),
        )
      )
        return true;
      path.pop();
      if (searchAtCap()) return false;
    }
    return fail();
  };
  const found =
    intervals === 0 ? from === to : search(from, intervals, 0, leaps);
  // Landing on the cap can still be a finished gap. Only a refused step
  // is an abort, and that result is not cached as a real miss.
  if (phraseSearchRefused) return null;
  const result = found ? [...path] : null;
  cache.set(key, result);
  return result;
}

function minLeaps(
  from: number,
  to: number,
  intervals: number,
  length: number,
  cache: Map<string, number[] | null>,
): number | null {
  const max = Math.floor(intervals / 2);
  for (let leaps = 0; leaps <= max; leaps++) {
    if (fillGap(from, to, intervals, leaps, length, cache)) return leaps;
  }
  return null;
}

function realize(
  ladder: readonly LadderTone[],
  events: readonly { beat: number; duration: number; strong: boolean }[],
  plan: PhrasePlan,
  cadencePcs: ReadonlySet<number>,
): number[] | null {
  const chordIndexes = ladder.flatMap((tone, index) =>
    tone.chordTone ? [index] : [],
  );
  const cadenceIndexes = ladder.flatMap((tone, index) =>
    cadencePcs.has(tone.note.pc) ? [index] : [],
  );
  if (!chordIndexes.length || !cadenceIndexes.length) return null;
  const strongIndexes = events.flatMap((event, index) =>
    event.strong ? [index] : [],
  );
  const endTarget =
    contourHeight(plan.contour, 1) * Math.max(0, ladder.length - 1);
  // A low ending wants the bottom octave of the cadence tone. Inset only a
  // high ending, so a leap can still resolve into it without skipping the
  // lower octave that arch, fall, and wave are aiming at.
  const lowEnding = endTarget <= (ladder.length - 1) / 2;
  const approachable = lowEnding
    ? cadenceIndexes
    : cadenceIndexes.filter(
        (index) => index >= 2 && index <= ladder.length - 3,
      );
  const cadenceLadder = closest(
    approachable.length ? approachable : cadenceIndexes,
    endTarget,
    1,
  )[0];
  const gaps = strongIndexes
    .slice(0, -1)
    .map((start, gap) => strongIndexes[gap + 1] - start);
  const maxLeaps = gaps.map((intervals) => Math.floor(intervals / 2));
  const targetLeaps = Math.round((events.length - 1) * 0.3);
  const cache = new Map<string, number[] | null>();
  const anchorCount = strongIndexes.length;
  const failedVisits = new Set<string>();
  let best: { anchors: number[]; leaps: number[] } | null = null;

  const choose = (slack: number, limit: number) => {
    const budget = targetLeaps + slack;
    const anchors = Array<number>(anchorCount).fill(-1);
    const leaps = Array<number>(Math.max(0, anchorCount - 1)).fill(0);
    // A tighter candidate limit must not poison a later search at this budget.
    failedVisits.clear();
    const visit = (ordinal: number, spent: number): boolean => {
      if (countSearchStep()) return false;
      const previous = ordinal > 0 ? anchors[ordinal - 1] : -1;
      const memo = `${ordinal}|${previous}|${spent}`;
      if (failedVisits.has(memo)) return false;
      const fail = () => {
        if (phraseSearchRefused) return false;
        failedVisits.add(memo);
        return false;
      };
      if (ordinal === anchorCount - 1) {
        anchors[ordinal] = cadenceLadder;
        if (ordinal === 0) {
          best = { anchors: anchors.slice(), leaps: leaps.slice() };
          return true;
        }
        const need = minLeaps(
          anchors[ordinal - 1],
          cadenceLadder,
          gaps[ordinal - 1],
          ladder.length,
          cache,
        );
        if (need === null || spent + need > budget) return fail();
        leaps[ordinal - 1] = need;
        best = { anchors: anchors.slice(), leaps: leaps.slice() };
        return true;
      }
      const noteIndex = strongIndexes[ordinal];
      const target =
        contourHeight(
          plan.contour,
          noteIndex / Math.max(1, events.length - 1),
        ) * Math.max(0, ladder.length - 1);
      for (const option of closest(chordIndexes, target, limit)) {
        let need = 0;
        if (ordinal > 0) {
          const found = minLeaps(
            anchors[ordinal - 1],
            option,
            gaps[ordinal - 1],
            ladder.length,
            cache,
          );
          if (found === null || spent + found > budget) continue;
          need = found;
          leaps[ordinal - 1] = need;
        }
        anchors[ordinal] = option;
        if (visit(ordinal + 1, spent + need)) {
          best = {
            anchors: anchors.slice(),
            leaps: leaps.slice(),
          };
          return true;
        }
        if (searchAtCap()) return false;
      }
      return fail();
    };
    if (searchAtCap()) return best;
    return visit(0, 0) ? best : null;
  };

  let chosen: { anchors: number[]; leaps: number[] } | null = null;
  for (const slack of [0, 1, 2, 4, 8]) {
    if (searchAtCap()) break;
    chosen = choose(slack, Math.min(4, chordIndexes.length));
    if (chosen) break;
    if (slack === 8 && !searchAtCap()) {
      chosen = choose(slack, chordIndexes.length);
    }
    if (chosen) break;
  }
  if (!chosen) chosen = best;
  if (!chosen) return null;

  let spare = targetLeaps - chosen.leaps.reduce((sum, count) => sum + count, 0);
  const order = maxLeaps
    .map((_, index) => index)
    .sort(
      (a, b) =>
        maxLeaps[b] - chosen.leaps[b] - (maxLeaps[a] - chosen.leaps[a]) ||
        a - b,
    );
  while (spare > 0) {
    let added = false;
    for (const gap of order) {
      const next = chosen.leaps[gap] + 1;
      if (next > maxLeaps[gap]) continue;
      if (
        !fillGap(
          chosen.anchors[gap],
          chosen.anchors[gap + 1],
          gaps[gap],
          next,
          ladder.length,
          cache,
        )
      )
        continue;
      chosen.leaps[gap] = next;
      spare -= 1;
      added = true;
      if (spare <= 0) break;
    }
    if (!added) break;
  }

  const indexes = Array<number>(events.length).fill(-1);
  indexes[strongIndexes[0]] = chosen.anchors[0];
  for (let gap = 0; gap < gaps.length; gap++) {
    const path = fillGap(
      chosen.anchors[gap],
      chosen.anchors[gap + 1],
      gaps[gap],
      chosen.leaps[gap],
      ladder.length,
      cache,
    );
    if (!path) return null;
    for (let step = 0; step < path.length; step++)
      indexes[strongIndexes[gap] + step] = path[step];
  }
  return indexes.every((index) => index >= 0) ? indexes : null;
}

function eventsFor(rhythm: RhythmId, bars: 2 | 4) {
  const beats = phraseOnsets(rhythm, bars);
  return beats.map((beat, index) => ({
    beat,
    duration: (beats[index + 1] ?? beat + 2) - beat,
    strong: isStrongBeat(beat),
  }));
}

/**
 * A neighbor figure may sound twice (four notes). The fifth note has to move.
 * Longer than this, the line is sitting on one cell.
 */
export const PHRASE_CELL_LIMIT = 4;
/** Perfect fifth. Wider leaps are walked when the gap can hold the steps. */
export const PHRASE_WIDE_LEAP = 7;
/** A register that spans a fourth should not sing inside a smaller range. */
export const PHRASE_MIN_RANGE = 5;

type GridEvent = { beat: number; duration: number; strong: boolean };

/** Longest two-pitch alternation, in notes. G–A–G–A is 4. G–A–G–A–G is 5. */
export function phraseCellLength(midis: readonly number[]): number {
  let longest = midis.length > 0 ? 1 : 0;
  for (let start = 0; start + 1 < midis.length; start++) {
    if (midis[start] === midis[start + 1]) continue;
    let end = start + 1;
    while (end + 1 < midis.length && midis[end + 1] === midis[end - 1])
      end += 1;
    longest = Math.max(longest, end - start + 1);
  }
  return longest;
}

/**
 * Scale walk from `from` to `to` in exactly `intervals` steps.
 * Spare steps bulge away from the target once, then come back, so a held
 * tone becomes a small arch instead of a two-note loop.
 */
function stepWalk(
  from: number,
  to: number,
  intervals: number,
  length: number,
): number[] | null {
  const distance = Math.abs(to - from);
  if (intervals < 0 || distance > intervals || (intervals - distance) % 2 !== 0)
    return null;
  if (intervals === 0) return from === to ? [from] : null;
  const path = [from];
  let pos = from;
  let left = intervals;
  while (left > 0) {
    const dist = Math.abs(to - pos);
    if (dist === left) {
      const sign = Math.sign(to - pos);
      if (sign === 0) return null;
      pos += sign;
      path.push(pos);
      left -= 1;
      continue;
    }
    const toward = Math.sign(to - pos);
    const away = toward === 0 ? 1 : -toward;
    const candidates = [pos + away, pos - away];
    let moved = false;
    for (const next of candidates) {
      if (next < 0 || next >= length || next === pos) continue;
      const nextDist = Math.abs(to - next);
      const nextLeft = left - 1;
      if (nextDist <= nextLeft && (nextLeft - nextDist) % 2 === 0) {
        pos = next;
        path.push(pos);
        left -= 1;
        moved = true;
        break;
      }
    }
    if (!moved) return null;
  }
  if (path.length !== intervals + 1 || path[path.length - 1] !== to)
    return null;
  for (let index = 1; index < path.length; index++) {
    if (path[index] === path[index - 1]) return null;
  }
  return path;
}

function lineMidis(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
): number[] {
  return indexes.map((index) => ladder[index].midi);
}

function lineSpan(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
): number {
  const midis = lineMidis(indexes, ladder);
  return Math.max(...midis) - Math.min(...midis);
}

function scalePcsOf(ladder: readonly LadderTone[]): Set<number> {
  return new Set(ladder.map((tone) => tone.note.pc));
}

/** Same checks the corpus pins: chord tones, no unison, leaps resolve. */
function lineIsLegal(
  indexes: readonly number[],
  events: readonly GridEvent[],
  ladder: readonly LadderTone[],
  cadenceIndex: number,
): boolean {
  if (indexes.length !== events.length || indexes.length === 0) return false;
  if (indexes[indexes.length - 1] !== cadenceIndex) return false;
  const scalePcs = scalePcsOf(ladder);
  for (let index = 0; index < indexes.length; index++) {
    const tone = indexes[index];
    if (tone < 0 || tone >= ladder.length) return false;
    if (events[index].strong && !ladder[tone].chordTone) return false;
    if (
      events[index].strong &&
      index > 0 &&
      melodicMotion(
        ladder[indexes[index - 1]].midi,
        ladder[tone].midi,
        scalePcs,
      ) !== 'step'
    )
      return false;
    if (index === 0) continue;
    if (tone === indexes[index - 1]) return false;
    const motion = melodicMotion(
      ladder[indexes[index - 1]].midi,
      ladder[tone].midi,
      scalePcs,
    );
    if (motion !== 'leap') continue;
    const next = indexes[index + 1];
    if (next === undefined) return false;
    const resolution = melodicMotion(
      ladder[tone].midi,
      ladder[next].midi,
      scalePcs,
    );
    const opposite =
      Math.sign(ladder[next].midi - ladder[tone].midi) ===
      -Math.sign(ladder[tone].midi - ladder[indexes[index - 1]].midi);
    if (resolution !== 'step' || !opposite) return false;
  }
  return events[events.length - 1].duration === 2;
}

function connectable(
  from: number,
  to: number,
  intervals: number,
  length: number,
): boolean {
  return stepWalk(from, to, intervals, length) !== null;
}

function strongEventIndexes(events: readonly GridEvent[]): number[] {
  return events.flatMap((event, index) =>
    isStrongBeat(event.beat) ? [index] : [],
  );
}

function nearestChord(chord: readonly number[], target: number): number {
  let best = chord[0] ?? 0;
  for (const index of chord) {
    const better = Math.abs(index - target) - Math.abs(best - target);
    if (better < 0 || (better === 0 && index < best)) best = index;
  }
  return best;
}

function maxTravel(strong: readonly number[]): number {
  let room = 0;
  for (let ordinal = 0; ordinal < strong.length - 1; ordinal++) {
    room += strong[ordinal + 1] - strong[ordinal];
  }
  return room;
}

/**
 * Chord tones along the contour, pinned to the cadence the search already
 * chose. Each pair has to be a step-walk on the notes already in the gap.
 * When the contour still lands on one chord tone, the peak anchor steps
 * out to the nearest chord tone a fourth away and the others ramp to it.
 */
function chooseAnchors(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  plan: PhrasePlan,
): number[] | null {
  const strong = strongEventIndexes(events);
  if (strong.length < 2) return null;
  const chord = ladder.flatMap((tone, index) =>
    tone.chordTone ? [index] : [],
  );
  if (!chord.length) return null;
  const end = indexes[indexes.length - 1];
  const last = ladder.length - 1;
  const count = strong.length;
  const heightAt = (ordinal: number) =>
    contourHeight(
      plan.contour,
      strong[ordinal] / Math.max(1, events.length - 1),
    );
  const ideal = strong.map((eventIndex) =>
    Math.round(
      contourHeight(plan.contour, eventIndex / Math.max(1, events.length - 1)) *
        last,
    ),
  );
  let peak = 0;
  for (let ordinal = 1; ordinal < count; ordinal++) {
    if (ordinal === count - 1) continue;
    if (heightAt(ordinal) >= heightAt(peak)) peak = ordinal;
  }
  const anchors = ideal.map((target, ordinal) =>
    ordinal === count - 1 ? end : nearestChord(chord, target),
  );
  anchors[count - 1] = end;
  if (lineSpan(anchors, ladder) < PHRASE_MIN_RANGE) {
    const travel = maxTravel(strong);
    const far = [...chord]
      .filter(
        (index) =>
          Math.abs(index - end) <= travel &&
          Math.abs(ladder[index].midi - ladder[end].midi) >= PHRASE_MIN_RANGE,
      )
      .sort(
        (a, b) =>
          Math.abs(a - ideal[peak]) - Math.abs(b - ideal[peak]) || a - b,
      );
    if (far[0] !== undefined) {
      anchors[peak] = far[0];
      for (let ordinal = 0; ordinal < count - 1; ordinal++) {
        if (ordinal === peak) continue;
        const along =
          ordinal < peak
            ? peak === 0
              ? 0
              : ordinal / peak
            : (ordinal - peak) / (count - 1 - peak);
        const from =
          ordinal < peak ? nearestChord(chord, ideal[0]) : anchors[peak];
        const dest = ordinal < peak ? anchors[peak] : end;
        anchors[ordinal] = nearestChord(
          chord,
          Math.round(from + (dest - from) * along),
        );
      }
      anchors[count - 1] = end;
      anchors[peak] = far[0];
    }
  }
  for (let pass = 0; pass < count; pass++) {
    for (let ordinal = 0; ordinal < count - 1; ordinal++) {
      const intervals = strong[ordinal + 1] - strong[ordinal];
      if (
        connectable(
          anchors[ordinal],
          anchors[ordinal + 1],
          intervals,
          ladder.length,
        )
      )
        continue;
      const moveRight = ordinal + 1 < count - 1;
      const fixed = moveRight ? anchors[ordinal] : anchors[ordinal + 1];
      const target = moveRight ? anchors[ordinal + 1] : anchors[ordinal];
      const options = [...chord].sort(
        (a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b,
      );
      const pick = options.find((option) =>
        connectable(
          moveRight ? fixed : option,
          moveRight ? option : fixed,
          intervals,
          ladder.length,
        ),
      );
      if (pick === undefined) continue;
      if (moveRight) anchors[ordinal + 1] = pick;
      else anchors[ordinal] = pick;
    }
  }
  anchors[count - 1] = end;
  // A repeated chord tone walks out and back on the same neighbor.
  // Move the second one so the next strong beat is a different chord tone.
  for (let pass = 0; pass < count; pass++) {
    let changed = false;
    for (let ordinal = 1; ordinal < count - 1; ordinal++) {
      if (anchors[ordinal] !== anchors[ordinal - 1]) continue;
      const leftGap = strong[ordinal] - strong[ordinal - 1];
      const rightGap = strong[ordinal + 1] - strong[ordinal];
      const options = [...chord]
        .filter((index) => index !== anchors[ordinal])
        .sort(
          (a, b) =>
            Math.abs(a - anchors[ordinal]) - Math.abs(b - anchors[ordinal]) ||
            a - b,
        );
      const pick = options.find((option) => {
        if (
          !connectable(anchors[ordinal - 1], option, leftGap, ladder.length) ||
          !connectable(option, anchors[ordinal + 1], rightGap, ladder.length)
        )
          return false;
        const trial = anchors.slice();
        trial[ordinal] = option;
        return (
          lineSpan(trial, ladder) >= PHRASE_MIN_RANGE ||
          lineSpan(anchors, ladder) < PHRASE_MIN_RANGE
        );
      });
      if (pick === undefined) continue;
      anchors[ordinal] = pick;
      changed = true;
    }
    if (!changed) break;
  }
  anchors[count - 1] = end;
  return anchors;
}

/** How far a two-pitch alternation starting here extends, in notes. */
function alternationLength(midis: readonly number[], start: number): number {
  if (start + 1 >= midis.length || midis[start] === midis[start + 1]) return 1;
  let end = start + 1;
  while (end + 1 < midis.length && midis[end + 1] === midis[end - 1]) end += 1;
  return end - start + 1;
}

/**
 * How many places a two-pitch cell runs past four notes.
 * Every starting note is counted, so shortening one cell still registers
 * when another cell is the same length.
 */
function cellExcess(midis: readonly number[]): number {
  let excess = 0;
  for (let start = 0; start + 1 < midis.length; start++) {
    if (alternationLength(midis, start) > PHRASE_CELL_LIMIT) excess += 1;
  }
  return excess;
}

/** Left edge of each two-pitch cell that has already sounded five notes. */
function stuckSpans(
  midis: readonly number[],
): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let coveredUntil = -1;
  for (let start = 0; start + 1 < midis.length; start++) {
    if (start <= coveredUntil) continue;
    const length = alternationLength(midis, start);
    if (length <= PHRASE_CELL_LIMIT) continue;
    spans.push({ start, end: start + length - 1 });
    coveredUntil = start + length - 1;
  }
  return spans;
}

function pitchChoices(current: number, length: number): number[] {
  const options: number[] = [];
  for (let distance = 1; distance < length; distance++) {
    if (current + distance < length) options.push(current + distance);
    if (current - distance >= 0) options.push(current - distance);
  }
  return options;
}

/**
 * Break a two-pitch loop by changing a pitch that is already on the grid.
 * The fifth note of the cell is tried first. Strong beats stay chord tones
 * approached by a scale step. The cadence pitch is left alone.
 */
function acceptPitch(
  trial: number[],
  events: readonly GridEvent[],
  ladder: readonly LadderTone[],
  cadence: number,
  next: readonly number[],
  excess: number,
): boolean {
  if (!lineIsLegal(next, events, ladder, cadence)) return false;
  if (cellExcess(lineMidis(next, ladder)) >= excess) return false;
  trial.splice(0, trial.length, ...next);
  return true;
}

/**
 * Move a strong note onto another chord tone, and the note before it onto
 * a scale step into that chord tone. One note cannot leave a loop whose
 * only legal approach is the neighbor it is stuck on.
 */
function retargetStrong(
  trial: number[],
  index: number,
  events: readonly GridEvent[],
  ladder: readonly LadderTone[],
  cadence: number,
  excess: number,
): boolean {
  if (index <= 0 || index >= trial.length - 1 || !events[index].strong)
    return false;
  const chord = ladder
    .flatMap((tone, toneIndex) => (tone.chordTone ? [toneIndex] : []))
    .sort(
      (a, b) =>
        Math.abs(a - trial[index]) - Math.abs(b - trial[index]) || a - b,
    );
  for (const option of chord) {
    if (option === trial[index]) continue;
    if (events[index + 1]?.strong && Math.abs(option - trial[index + 1]) !== 1)
      continue;
    for (const approach of [option - 1, option + 1]) {
      if (approach < 0 || approach >= ladder.length) continue;
      if (index >= 2 && approach === trial[index - 2]) continue;
      const next = trial.slice();
      next[index - 1] = approach;
      next[index] = option;
      if (acceptPitch(trial, events, ladder, cadence, next, excess))
        return true;
    }
  }
  return false;
}

function breakCell(
  indexes: readonly number[],
  events: readonly GridEvent[],
  ladder: readonly LadderTone[],
  cadence: number,
): number[] | null {
  const trial = indexes.slice();
  const original = cellExcess(lineMidis(indexes, ladder));
  for (let guard = 0; guard < 24; guard++) {
    const midis = lineMidis(trial, ladder);
    const excess = cellExcess(midis);
    if (excess === 0) return trial;
    const spans = stuckSpans(midis);
    let changed = false;
    for (const run of spans) {
      const positions: number[] = [];
      const fifth = run.start + PHRASE_CELL_LIMIT;
      if (fifth < trial.length - 1) positions.push(fifth);
      for (let index = run.end; index > run.start; index--) {
        if (index < trial.length - 1 && !positions.includes(index))
          positions.push(index);
      }
      for (const index of positions) {
        for (const option of pitchChoices(trial[index], ladder.length)) {
          if (option === trial[index - 1]) continue;
          if (events[index].strong && !ladder[option].chordTone) continue;
          if (events[index].strong && Math.abs(option - trial[index - 1]) !== 1)
            continue;
          const following = trial[index + 1];
          if (
            following !== undefined &&
            events[index + 1]?.strong &&
            Math.abs(option - following) !== 1
          )
            continue;
          const next = trial.slice();
          next[index] = option;
          if (acceptPitch(trial, events, ladder, cadence, next, excess)) {
            changed = true;
            break;
          }
        }
        if (!changed && events[index].strong)
          changed = retargetStrong(
            trial,
            index,
            events,
            ladder,
            cadence,
            excess,
          );
        if (changed) break;
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return cellExcess(lineMidis(trial, ladder)) < original ? trial : null;
}

function writeWalk(
  indexes: number[],
  start: number,
  walk: readonly number[],
): void {
  for (let step = 0; step < walk.length; step++)
    indexes[start + step] = walk[step];
}

/**
 * Replace the parked line with chord tones that follow the contour, joined
 * by scale steps on the onsets already in the phrase. A gap that cannot
 * hold the walk is left alone.
 */
function rebuildContour(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  plan: PhrasePlan,
): number[] | null {
  const anchors = chooseAnchors(indexes, ladder, events, plan);
  if (!anchors) return null;
  const idx = indexes.slice();
  const strong = strongEventIndexes(events);
  idx[strong[0]] = anchors[0];
  for (let ordinal = 0; ordinal < anchors.length - 1; ordinal++) {
    const gap = strong[ordinal + 1] - strong[ordinal];
    const walk = stepWalk(
      anchors[ordinal],
      anchors[ordinal + 1],
      gap,
      ladder.length,
    );
    if (!walk) return null;
    writeWalk(idx, strong[ordinal], walk);
  }
  const cadence = indexes[indexes.length - 1];
  const broken = breakCell(idx, events, ladder, cadence);
  const shaped = broken ?? idx;
  if (!lineIsLegal(shaped, events, ladder, cadence)) return null;
  if (phraseCellLength(lineMidis(shaped, ladder)) > PHRASE_CELL_LIMIT)
    return null;
  if (
    lineSpan(shaped, ladder) < PHRASE_MIN_RANGE &&
    lineSpan(
      ladder.map((_, index) => index),
      ladder,
    ) >= PHRASE_MIN_RANGE
  )
    return null;
  return shaped;
}

function widestLeap(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
  scalePcs: ReadonlySet<number>,
): { at: number; size: number } | null {
  let at = -1;
  let size = PHRASE_WIDE_LEAP - 1;
  for (let index = 1; index < indexes.length; index++) {
    const semitones = Math.abs(
      ladder[indexes[index]].midi - ladder[indexes[index - 1]].midi,
    );
    if (semitones <= size) continue;
    if (
      melodicMotion(
        ladder[indexes[index - 1]].midi,
        ladder[indexes[index]].midi,
        scalePcs,
      ) !== 'leap'
    )
      continue;
    at = index;
    size = semitones;
  }
  return at < 0 ? null : { at, size };
}

/**
 * Turn the widest leap of a fifth or more into a scale walk between the
 * same strong-beat chord tones. Returns null when the existing gap cannot
 * hold the steps, and the leap stays.
 */
function softenWidestLeap(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
): number[] | null {
  const found = widestLeap(indexes, ladder, scalePcsOf(ladder));
  if (!found) return null;
  let start = found.at - 1;
  while (start > 0 && !isStrongBeat(events[start].beat)) start -= 1;
  let end = found.at;
  while (end < events.length - 1 && !isStrongBeat(events[end].beat)) end += 1;
  if (!isStrongBeat(events[start].beat) || !isStrongBeat(events[end].beat))
    return null;
  const walk = stepWalk(
    indexes[start],
    indexes[end],
    end - start,
    ladder.length,
  );
  if (!walk) return null;
  const idx = indexes.slice();
  writeWalk(idx, start, walk);
  if (!lineIsLegal(idx, events, ladder, indexes[indexes.length - 1]))
    return null;
  return idx;
}

/**
 * Put one small leap back: a third or fourth onto the neighbor of the next
 * note, then a step the other way. Replaces a leap of a fifth we just removed
 * so the line still has a leap, and the leap is a singable one.
 */
function addModestLeap(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
): number[] | null {
  const scalePcs = scalePcsOf(ladder);
  for (let index = 1; index < indexes.length - 1; index++) {
    if (events[index].strong) continue;
    const previous = indexes[index - 1];
    const current = indexes[index];
    const next = indexes[index + 1];
    if (Math.abs(current - previous) !== 1 || Math.abs(next - current) !== 1)
      continue;
    for (const approach of [next + 1, next - 1]) {
      if (approach < 0 || approach >= ladder.length || approach === previous)
        continue;
      if (Math.abs(approach - previous) < 2) continue;
      const leapSemis = Math.abs(ladder[approach].midi - ladder[previous].midi);
      if (leapSemis < 3 || leapSemis > 5) continue;
      const leapDir = Math.sign(ladder[approach].midi - ladder[previous].midi);
      const resolveDir = Math.sign(ladder[next].midi - ladder[approach].midi);
      if (leapDir === 0 || resolveDir !== -leapDir) continue;
      if (
        melodicMotion(
          ladder[previous].midi,
          ladder[approach].midi,
          scalePcs,
        ) !== 'leap'
      )
        continue;
      const trial = indexes.slice();
      trial[index] = approach;
      if (
        lineIsLegal(trial, events, ladder, indexes[indexes.length - 1]) &&
        phraseCellLength(lineMidis(trial, ladder)) <= PHRASE_CELL_LIMIT
      )
        return trial;
    }
  }
  return null;
}

function needsContour(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
) {
  const span = lineSpan(indexes, ladder);
  const ladderSpan = lineSpan(
    ladder.map((_, index) => index),
    ladder,
  );
  return (
    phraseCellLength(lineMidis(indexes, ladder)) > PHRASE_CELL_LIMIT ||
    (span < PHRASE_MIN_RANGE && ladderSpan >= PHRASE_MIN_RANGE)
  );
}

/**
 * Search still picks the skeleton and the rhythm grid. This pass only
 * rewrites pitches on those onsets: a stuck cell moves to another scale
 * or chord tone, and a leap of a fifth or wider becomes a scale walk when
 * the gap can already hold the steps.
 */
function shapeMelody(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  plan: PhrasePlan,
): { indexes: number[]; events: GridEvent[] } {
  const cadence = indexes[indexes.length - 1];
  const grid = events.map((event) => ({ ...event }));
  let current = indexes.slice();
  if (needsContour(current, ladder)) {
    const rebuilt = rebuildContour(current, ladder, grid, plan);
    if (rebuilt && lineIsLegal(rebuilt, grid, ladder, cadence)) {
      current = addModestLeap(rebuilt, ladder, grid) ?? rebuilt;
    }
  }
  if (phraseCellLength(lineMidis(current, ladder)) > PHRASE_CELL_LIMIT) {
    const opened = breakCell(current, grid, ladder, cadence);
    if (opened && lineIsLegal(opened, grid, ladder, cadence)) current = opened;
  }
  for (let repair = 0; repair < 3; repair++) {
    const before = widestLeap(current, ladder, scalePcsOf(ladder));
    if (!before) break;
    const softened = softenWidestLeap(current, ladder, grid);
    if (!softened) break;
    const leaped = addModestLeap(softened, ladder, grid);
    const candidate = leaped ?? softened;
    const opened = breakCell(candidate, grid, ladder, cadence);
    const next = opened ?? candidate;
    if (!lineIsLegal(next, grid, ladder, cadence)) break;
    if (phraseCellLength(lineMidis(next, ladder)) > PHRASE_CELL_LIMIT) break;
    if (wideLeapCount(next, ladder) >= wideLeapCount(current, ladder)) break;
    current = next;
  }
  if (current.length > 8 && leapCount(current, ladder) < 4) {
    const extra = addModestLeap(current, ladder, grid);
    if (
      extra &&
      lineIsLegal(extra, grid, ladder, cadence) &&
      phraseCellLength(lineMidis(extra, ladder)) <= PHRASE_CELL_LIMIT
    )
      current = extra;
  }
  return grid[grid.length - 1].duration === 2
    ? { indexes: current, events: grid }
    : {
        indexes: indexes.slice(),
        events: events.map((event) => ({ ...event })),
      };
}

function wideLeapCount(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
): number {
  const scalePcs = scalePcsOf(ladder);
  let count = 0;
  for (let index = 1; index < indexes.length; index++) {
    const semitones = Math.abs(
      ladder[indexes[index]].midi - ladder[indexes[index - 1]].midi,
    );
    if (semitones < PHRASE_WIDE_LEAP) continue;
    if (
      melodicMotion(
        ladder[indexes[index - 1]].midi,
        ladder[indexes[index]].midi,
        scalePcs,
      ) === 'leap'
    )
      count += 1;
  }
  return count;
}

function leapCount(
  indexes: readonly number[],
  ladder: readonly LadderTone[],
): number {
  const scalePcs = scalePcsOf(ladder);
  let leaps = 0;
  for (let index = 1; index < indexes.length; index++) {
    if (
      melodicMotion(
        ladder[indexes[index - 1]].midi,
        ladder[indexes[index]].midi,
        scalePcs,
      ) === 'leap'
    )
      leaps += 1;
  }
  return leaps;
}

function fingerNotes(notes: PhraseNote[]): FingeredNote[] {
  const choices = notes.map((note) => spotsFor(note.midi));
  const cost = choices.map((spots) =>
    spots.map(() => Number.POSITIVE_INFINITY),
  );
  const back = choices.map((spots) => spots.map(() => -1));
  for (let spot = 0; spot < choices[0].length; spot++) {
    cost[0][spot] = Math.abs(choices[0][spot].position - 7) * 0.05;
  }
  for (let index = 1; index < notes.length; index++) {
    const pitch = Math.sign(notes[index].midi - notes[index - 1].midi);
    for (let spot = 0; spot < choices[index].length; spot++) {
      let best = Number.POSITIVE_INFINITY;
      let from = -1;
      for (let previous = 0; previous < choices[index - 1].length; previous++) {
        if (!Number.isFinite(cost[index - 1][previous])) continue;
        const next =
          cost[index - 1][previous] +
          moveCost(choices[index - 1][previous], choices[index][spot], pitch);
        if (next < best) {
          best = next;
          from = previous;
        }
      }
      cost[index][spot] = best;
      back[index][spot] = from;
    }
  }
  let spot = 0;
  for (let candidate = 1; candidate < choices.at(-1)!.length; candidate++) {
    if (cost.at(-1)![candidate] < cost.at(-1)![spot]) spot = candidate;
  }
  const picked: Spot[] = [];
  for (let index = notes.length - 1; index >= 0; index--) {
    picked[index] = choices[index][spot];
    spot = back[index][spot];
  }
  return notes.map((note, index) => ({
    ...note,
    string: picked[index].string,
    fret: picked[index].fret,
    finger: picked[index].finger,
    position: picked[index].position,
    shift: index > 0 && picked[index].position !== picked[index - 1].position,
  }));
}

function spotsFor(midi: number): Spot[] {
  const spots: Spot[] = [];
  for (let string = 0; string < TUNING.length; string++) {
    const fret = midi - TUNING[string];
    if (fret < 0 || fret > 24) continue;
    if (fret === 0) {
      for (let position = 0; position <= 17; position++)
        spots.push({ string, fret, position, finger: 0 });
      continue;
    }
    for (let finger = 1; finger <= 4; finger++) {
      const position = fret - (finger - 1);
      if (position < 0 || position > 21) continue;
      spots.push({ string, fret, position, finger });
    }
  }
  return spots;
}

function moveCost(from: Spot, to: Spot, pitch: number): number {
  let cost = Math.abs(to.position - 7) * 0.02;
  if (from.position !== to.position) cost += SHIFT_COST;
  const jump = Math.abs(from.string - to.string);
  if (jump === 1) cost += 0.7;
  else if (jump === 2) cost += 2.4;
  else if (jump > 2) cost += 5 + jump;
  if (pitch > 0 && to.string < from.string) cost += 0.35;
  if (pitch < 0 && to.string > from.string) cost += 0.35;
  if (to.fret === 0) cost -= 0.15;
  return cost;
}

function assemble(
  input: {
    seed: number;
    bars: 2 | 4;
    scaleNotes: readonly Note[];
    chordNotes: readonly Note[];
  },
  plan: PhrasePlan,
  source: PhraseSource,
): PhraseResult {
  const chordPcs = landingPitchClasses(input.chordNotes, input.scaleNotes);
  if (!chordPcs.size) return { ok: false, reason: 'no-shared-tones' };
  const ladder = buildLadder(input.scaleNotes, chordPcs, plan.register);
  const events = eventsFor(plan.rhythm, input.bars);
  const scalePcs = new Set(input.scaleNotes.map((note) => note.pc));
  const cadencePcs = new Set(
    cadencePitchClasses(input.chordNotes, plan.cadence, scalePcs),
  );
  const indexes = realize(ladder, events, plan, cadencePcs);
  if (!indexes || indexes.some((index) => index < 0))
    return { ok: false, reason: 'unplayable' };
  const shaped = shapeMelody(indexes, ladder, events, plan);
  const notes = shaped.indexes.map((index, event) => {
    const tone = ladder[index];
    return {
      name: tone.note.name,
      pc: tone.note.pc,
      degree: tone.note.degree,
      midi: tone.midi,
      beat: shaped.events[event].beat,
      duration: shaped.events[event].duration,
      strong: shaped.events[event].strong,
      chordTone: tone.chordTone,
    };
  });
  return {
    ok: true,
    phrase: {
      seed: input.seed >>> 0,
      bars: input.bars,
      plan,
      source,
      notes: fingerNotes(notes),
    },
  };
}

type PhraseRequest = {
  seed: number;
  bars: 2 | 4;
  scaleNotes: readonly Note[];
  chordNotes: readonly Note[];
  locks?: PhraseLocks;
};

function rulesResult(
  input: PhraseRequest,
  available: readonly CadenceTarget[],
): PhraseResult {
  return assemble(input, rulePlan(input.seed, available, input.locks), 'rules');
}

/** One fresh plan when the first comes back unplayable. Other failures stay. */
function retryUnplayable(
  input: PhraseRequest,
  available: readonly CadenceTarget[],
  result: PhraseResult,
): PhraseResult {
  if (result.ok || result.reason !== 'unplayable') return result;
  nextSearchAttempt();
  return rulesResult({ ...input, seed: (input.seed + 1) >>> 0 }, available);
}

export function generatePhrase(input: PhraseRequest): PhraseResult {
  resetSearchCount();
  if (
    canonicalSeed(input.seed) === null ||
    (input.bars !== 2 && input.bars !== 4)
  ) {
    return { ok: false, reason: 'bad-input' };
  }
  const available = availableCadences(input.chordNotes, input.scaleNotes);
  if (!available.length) return { ok: false, reason: 'no-shared-tones' };
  return retryUnplayable(input, available, rulesResult(input, available));
}

export async function generatePhraseWithPlanner(input: {
  seed: number;
  bars: 2 | 4;
  scaleNotes: readonly Note[];
  chordNotes: readonly Note[];
  locks?: PhraseLocks;
  planner?: PhrasePlanner;
  timeoutMs?: number;
  scaleLabel?: string;
  chordSymbol?: string;
}): Promise<PhraseResult> {
  resetSearchCount();
  if (
    canonicalSeed(input.seed) === null ||
    (input.bars !== 2 && input.bars !== 4)
  ) {
    return { ok: false, reason: 'bad-input' };
  }
  const available = availableCadences(input.chordNotes, input.scaleNotes);
  if (!available.length) return { ok: false, reason: 'no-shared-tones' };
  const rules = rulePlan(input.seed, available);
  if (!input.planner)
    return retryUnplayable(input, available, rulesResult(input, available));
  const timeoutMs = input.timeoutMs ?? PHRASE_PLANNER_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let accepted = false;
  let proposal: Partial<PhrasePlan> = {};
  try {
    const result = await Promise.race([
      input.planner.propose({
        seed: input.seed,
        bars: input.bars,
        scaleNotes: input.scaleNotes,
        chordNotes: input.chordNotes,
        locks: input.locks,
        signal: controller.signal,
        scaleLabel: input.scaleLabel,
        chordSymbol: input.chordSymbol,
      }),
      new Promise<null>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve(null), {
          once: true,
        });
      }),
    ]);
    proposal = sanitizePlan(result, available);
    accepted = Object.keys(proposal).length > 0;
  } catch {
    proposal = {};
    accepted = false;
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
  const plan = applyLocks({ ...rules, ...proposal }, input.locks, available);
  const planned = assemble(input, plan, accepted ? 'planner' : 'rules');
  if (planned.ok) return planned;
  if (!accepted) return retryUnplayable(input, available, planned);
  nextSearchAttempt();
  const fallback = assemble(
    input,
    applyLocks(rules, input.locks, available),
    'rules',
  );
  return retryUnplayable(input, available, fallback);
}

export function phraseFretMarks(
  notes: readonly FingeredNote[],
  dots: PhraseDotVisibility,
  currentIndex = -1,
): PhraseFretMark[] {
  if (dots === 'hidden') return [];
  const marks = new Map<string, PhraseFretMark>();
  notes.forEach((note, index) => {
    const key = `${note.string}:${note.fret}`;
    const current = index === currentIndex;
    const previous = marks.get(key);
    if (previous && !current && !(note.shift && !previous.current)) return;
    marks.set(key, {
      string: note.string,
      fret: note.fret,
      finger: note.finger,
      shift: Boolean(note.shift || previous?.shift),
      label: note.name,
      degree: note.degree,
      current,
    });
  });
  return [...marks.values()];
}

export function phraseFocusFret(notes: readonly FingeredNote[]): number {
  const frets = notes.map((note) => note.fret).sort((a, b) => a - b);
  return frets[Math.floor(frets.length / 2)] ?? 0;
}
