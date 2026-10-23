import { mod, patterns, TUNING, type Note, type Pattern } from './music.ts';
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
 * Each placed note counts one step. A search that has used the cap
 * refuses another step, so the count never becomes 4001, and the
 * generator keeps the best complete line found so far.
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

export type PhraseForm = 'answer' | 'sentence';

export type PhrasePlan = {
  contour: Contour;
  rhythm: RhythmId;
  register: RegisterName;
  cadence: CadenceTarget;
  /** Answer is two bars. Sentence is four. Absent on older plans. */
  form?: PhraseForm;
  /** One cell-id string per bar, in order. */
  cells?: readonly string[];
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
const SHIFT_COST = 20;
/** A hand move of this many frets or more is a shift. Three or fewer is a reach. */
const SHIFT_FRETS = 4;

/**
 * Cost of moving the fretting hand. Staying put is free. Any real move,
 * including a reach of 1–3 frets, pays the shift cost plus the frets
 * traveled. A move onto an eighth pays that shift cost again ten times,
 * so the hand waits for a longer note. The shift label still starts at 4
 * frets: a shorter move is a reach, and it is not drawn as a shift.
 */
export function handShiftCost(frets: number, fast: boolean): number {
  const moved = Math.abs(frets);
  if (moved === 0) return 0;
  let cost = SHIFT_COST + moved;
  if (fast) cost += SHIFT_COST * 10;
  return cost;
}

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

/** The cadence holds for two beats, then a loop can restart on the next downbeat. */
export function phrasePeriodBeats(bars: 2 | 4): number {
  return bars * 4 + 2;
}

/** Slider amount. 0 is straight, 1 is the tempo's full swing. */
export const SWING_AMOUNT_MIN = 0;
export const SWING_AMOUNT_MAX = 1;
export const SWING_AMOUNT_STEP = 0.01;
/** New sessions start straight. The slider can still move up from here. */
export const SWING_AMOUNT_DEFAULT = 0;

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

type GridEvent = { beat: number; duration: number; strong: boolean };

type CellDef = { span: number; hits: readonly (readonly [number, number])[] };

/** Eighth-grid cells. `at` and `dur` are eighths inside the cell. No triplets. */
const CELLS: Record<string, CellDef> = {
  q: { span: 2, hits: [[0, 2]] },
  ee: {
    span: 2,
    hits: [
      [0, 1],
      [1, 1],
    ],
  },
  zr: { span: 2, hits: [[1, 1]] },
  rz: { span: 2, hits: [[0, 1]] },
  dq: {
    span: 4,
    hits: [
      [0, 3],
      [3, 1],
    ],
  },
  qd: {
    span: 4,
    hits: [
      [0, 1],
      [1, 3],
    ],
  },
  h: { span: 4, hits: [[0, 4]] },
  ant: { span: 2, hits: [[1, 1]] },
};

/**
 * Bars the rhythm lock may draw. Each fills eight eighths.
 * A strong onset after the first of the bar is preceded by a weak one,
 * and the bar ends on a weak onset so the next downbeat can be a step.
 */
const RAW_BARS: Record<RhythmId, readonly (readonly string[])[]> = {
  quarters: [
    ['q', 'q', 'q', 'q'],
    ['q', 'q', 'zr', 'q'],
    ['zr', 'q', 'zr', 'q'],
    ['q', 'zr', 'zr', 'q'],
    ['h', 'zr', 'q'],
    ['q', 'h', 'zr'],
    ['zr', 'zr', 'q', 'q'],
    ['q', 'zr', 'q', 'zr'],
    ['zr', 'zr', 'zr', 'q'],
    ['zr', 'q', 'zr', 'zr'],
  ],
  eighths: [
    ['ee', 'ee', 'ee', 'ee'],
    ['ee', 'zr', 'ee', 'zr'],
    ['q', 'ee', 'q', 'ee'],
    ['zr', 'ee', 'zr', 'ee'],
    ['ee', 'ee', 'zr', 'q'],
    ['zr', 'zr', 'ee', 'ee'],
    ['ee', 'zr', 'zr', 'ee'],
    ['q', 'ee', 'zr', 'q'],
    ['zr', 'zr', 'zr', 'zr'],
    ['zr', 'ee', 'zr', 'zr'],
  ],
  'long-short': [
    ['dq', 'qd'],
    ['qd', 'dq'],
    ['dq', 'q', 'q'],
    ['q', 'q', 'dq'],
    ['dq', 'zr', 'q'],
    ['qd', 'ee', 'q'],
    ['q', 'dq', 'zr'],
    ['zr', 'qd', 'q'],
  ],
  push: [
    ['q', 'ant', 'q', 'ant'],
    ['ee', 'ant', 'q', 'ant'],
    ['q', 'ant', 'ee', 'zr'],
    ['ant', 'q', 'ant', 'q'],
    ['q', 'ee', 'ant', 'zr'],
    ['zr', 'ant', 'q', 'ant'],
    ['ee', 'ant', 'ee', 'ant'],
    ['q', 'ant', 'zr', 'q'],
    ['zr', 'ant', 'zr', 'ant'],
    ['ant', 'zr', 'ant', 'q'],
  ],
};

type BarPattern = {
  ids: string;
  hits: { at: number; dur: number }[];
  onset: string;
  notes: number;
};

function expandBar(
  ids: readonly string[],
): { at: number; dur: number }[] | null {
  let pos = 0;
  const hits: { at: number; dur: number }[] = [];
  for (const id of ids) {
    const cell = CELLS[id];
    if (!cell || pos + cell.span > 8) return null;
    for (const [at, dur] of cell.hits) hits.push({ at: pos + at, dur });
    pos += cell.span;
  }
  if (pos !== 8) return null;
  return hits;
}

function strongEighth(at: number): boolean {
  return at === 0 || at === 4;
}

function barIsPlayable(hits: readonly { at: number; dur: number }[]): boolean {
  if (!hits.length) return false;
  const last = hits[hits.length - 1].at;
  if (strongEighth(last)) return false;
  for (let index = 0; index < hits.length; index++) {
    const hit = hits[index];
    if (hit.dur <= 0) return false;
    if (index > 0 && hit.at <= hits[index - 1].at) return false;
    if (!strongEighth(hit.at) || index === 0) continue;
    if (strongEighth(hits[index - 1].at)) return false;
  }
  return true;
}

function compileBars(): Record<RhythmId, BarPattern[]> {
  const compiled = {} as Record<RhythmId, BarPattern[]>;
  for (const rhythm of RHYTHMS) {
    compiled[rhythm] = [];
    for (const ids of RAW_BARS[rhythm]) {
      const hits = expandBar(ids);
      if (!hits || !barIsPlayable(hits)) continue;
      compiled[rhythm].push({
        ids: ids.join(' '),
        hits,
        onset: hits.map((hit) => hit.at).join(','),
        notes: hits.length,
      });
    }
  }
  return compiled;
}

const BAR_PATTERNS = compileBars();

/** Same checks the corpus pins: chord tones, no unison, leaps resolve. */
function lineIsLegal(
  indexes: readonly number[],
  events: readonly GridEvent[],
  ladder: readonly LadderTone[],
  cadenceIndex: number,
): boolean {
  if (indexes.length !== events.length || indexes.length === 0) return false;
  if (indexes[indexes.length - 1] !== cadenceIndex) return false;
  const scalePcs = new Set(ladder.map((tone) => tone.note.pc));
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

/**
 * A new pitch has to sit in the current hand box, or within a 3-fret reach
 * on an eighth. A longer note may slide up to one box (5 frets). A move of
 * 4 frets or more is a shift and cannot land on an eighth.
 */
export function withinHand(
  midi: number,
  anchor: number,
  slack: number,
): boolean {
  return spotsFor(midi).some(
    (spot) => Math.abs(spot.position - anchor) <= slack,
  );
}

function handSlack(duration: number): number {
  return duration <= 0.5 ? SHIFT_FRETS - 1 : 5;
}

/** An octave is allowed. Anything wider, or a leap past a fourth onto an eighth, is not. */
function arrivalOk(gap: number, duration: number): boolean {
  if (gap === 0 || gap > 12) return false;
  return !(duration <= 0.5 && gap > 5);
}

/**
 * Jonny, 2026-10-16, 1:10am ET: octave jumps may leave the locked register.
 * An octave jump is the same note an octave up or down (±12 from the note
 * being rewritten). Every other leap stays inside the register window.
 */
function pitchAllowed(
  midi: number,
  original: number,
  low: number,
  high: number,
): boolean {
  if (midi < TUNING[0] || midi > TUNING[TUNING.length - 1] + 24) return false;
  if (midi >= low && midi <= high) return true;
  return Math.abs(midi - original) === 12;
}

function guideTone(degree: string): boolean {
  const match = /^([b#]*)(\d+)$/.exec(degree);
  if (!match) return false;
  const simple = ((Number(match[2]) - 1) % 7) + 1;
  return simple === 3 || simple === 7;
}

function contourMidi(plan: PhrasePlan, t: number): number {
  let height = contourHeight(plan.contour, t);
  // A cosine wave peaks too narrowly for one scale step per note.
  // Hold the middle third down and the side thirds up so the line reads as a wave.
  if (plan.contour === 'wave') {
    const x = Math.min(1, Math.max(0, t));
    const peak = 0.42;
    if (x < 0.34) height = peak * Math.sin(Math.PI * (x / 0.34));
    else if (x < 0.67) height = 0;
    else if (x < 0.92) height = peak * Math.sin(Math.PI * ((x - 0.67) / 0.25));
    else height = 0;
  }
  return REGISTER_LOW[plan.register] + height * PHRASE_RANGE;
}

function contourGoal(plan: PhrasePlan, beat: number, bars: 2 | 4): number {
  return contourMidi(plan, beat / (bars * 4));
}

function eventsForCells(
  patterns: readonly BarPattern[],
  bars: 2 | 4,
): GridEvent[] {
  const raw: { beat: number; duration: number }[] = [];
  for (let bar = 0; bar < bars; bar++) {
    for (const hit of patterns[bar].hits) {
      raw.push({
        beat: bar * 4 + hit.at * 0.5,
        duration: hit.dur * 0.5,
      });
    }
  }
  raw.push({ beat: bars * 4, duration: 2 });
  return raw.map((event, index) => {
    const next = raw[index + 1];
    const room = next ? next.beat - event.beat : event.duration;
    return {
      beat: event.beat,
      duration: Math.min(event.duration, room),
      strong: isStrongBeat(event.beat),
    };
  });
}

function strongHits(pattern: BarPattern): number {
  return pattern.hits.filter((hit) => hit.at === 0 || hit.at === 4).length;
}

function pickPatterns(
  rhythm: RhythmId,
  bars: 2 | 4,
  random: () => number,
  density: number,
  loose: boolean,
  exact: boolean,
): BarPattern[] {
  const catalog = BAR_PATTERNS[rhythm];
  const busy = catalog.filter((pattern) => pattern.notes >= 6);
  const spare = catalog.filter((pattern) => pattern.notes <= 4);
  const open = catalog.filter((pattern) => strongHits(pattern) === 0);
  const pool =
    loose && open.length
      ? open
      : density === 2 && busy.length
        ? busy
        : density === 0 && spare.length
          ? spare
          : catalog;
  const chosen: BarPattern[] = [];
  let previous = '';
  for (let bar = 0; bar < bars; bar++) {
    const echo = (bars === 4 && bar === 1) || (bars === 2 && bar === 1);
    const fragment = bars === 4 && bar === 3;
    const opening = chosen[0]?.ids.split(' ')[0];
    const opens = (pattern: BarPattern, cell: string) =>
      pattern.ids.split(' ')[0] === cell;
    let options = pool.filter((pattern) => pattern.onset !== previous);
    if (!options.length)
      options = catalog.filter((pattern) => pattern.onset !== previous);
    if (!options.length) options = pool.length ? pool : catalog;
    if ((echo || fragment) && opening) {
      const shared = options.filter((pattern) => opens(pattern, opening));
      if (shared.length) options = shared;
    }
    if (bars === 4 && bar === 2 && opening) {
      const contrast = options.filter((pattern) => !opens(pattern, opening));
      if (contrast.length) options = contrast;
    }
    if (bar === 0) {
      // The loop restarts on this downbeat. A rest here opens a gap.
      let down = options.filter((pattern) =>
        pattern.hits.some((hit) => hit.at === 0),
      );
      if (!down.length) {
        down = catalog.filter((pattern) =>
          pattern.hits.some((hit) => hit.at === 0),
        );
      }
      if (down.length) options = down;
    }
    if (exact && bar === 0) {
      const longs = options.filter((pattern) =>
        pattern.hits.every((hit) => hit.dur >= 2),
      );
      if (longs.length) options = longs;
    }
    // An exact motif repeat may copy the bar. Every other bar must differ.
    if (exact && echo && previous) {
      const same = catalog.filter((pattern) => pattern.onset === previous);
      if (same.length) options = same;
    }
    const pattern =
      options[Math.floor(random() * options.length)] ?? options[0];
    chosen.push(pattern);
    previous = pattern.onset;
  }
  return chosen;
}

function nearestIndex(
  options: readonly number[],
  ladder: readonly LadderTone[],
  goal: number,
  strong: boolean,
): number {
  let best = options[0];
  let bestScore = Infinity;
  for (const index of options) {
    let score = Math.abs(ladder[index].midi - goal);
    if (strong && guideTone(ladder[index].note.degree)) score -= 1.5;
    if (score < bestScore || (score === bestScore && index < best)) {
      best = index;
      bestScore = score;
    }
  }
  return best;
}

/** A scale step that is allowed to land on this event. */
function stepOk(
  ladder: readonly LadderTone[],
  prev: number,
  tone: number,
  event: GridEvent,
): boolean {
  if (tone === prev || tone < 0 || tone >= ladder.length) return false;
  const gap = Math.abs(ladder[tone].midi - ladder[prev].midi);
  if (!arrivalOk(gap, event.duration)) return false;
  if (!event.strong) return Math.abs(tone - prev) === 1;
  return ladder[tone].chordTone && Math.abs(tone - prev) === 1;
}

/**
 * Tones from which a stepwise line can still reach the cadence.
 * Strong events keep chord tones only. The forward walk stays inside this set,
 * so a dead rhythm fails before a note is chosen.
 */
function stepAlive(
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  cadenceAt: number,
): boolean[][] {
  const count = ladder.length;
  const alive = events.map(() => Array<boolean>(count).fill(false));
  if (cadenceAt >= 0 && cadenceAt < count)
    alive[events.length - 1][cadenceAt] = true;
  for (let event = events.length - 2; event >= 0; event--) {
    const landing = events[event + 1];
    for (let tone = 0; tone < count; tone++) {
      if (events[event].strong && !ladder[tone].chordTone) continue;
      for (const next of [tone - 1, tone + 1]) {
        if (!alive[event + 1][next]) continue;
        if (!stepOk(ladder, tone, next, landing)) continue;
        alive[event][tone] = true;
        break;
      }
    }
  }
  return alive;
}

/**
 * Notes stay on the scale ladder. A strong note is a chord tone reached
 * by a scale step. A leap lands on a weak beat and steps back the other way.
 * Chromatic (non-scale) approaches cannot pass the spelling rules, so an
 * enclosure is the diatonic neighbor above, then below, then the target.
 */
function walkLine(
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  plan: PhrasePlan,
  bars: 2 | 4,
  cadenceAt: number,
  leaps: boolean,
  enclose: boolean,
): number[] | null {
  const low = REGISTER_LOW[plan.register];
  const high = low + PHRASE_RANGE;
  const alive = stepAlive(ladder, events, cadenceAt);
  if (!alive[0].some(Boolean)) return null;
  const indexes: number[] = [];
  const motif: number[] = [];
  let motifUsed = 0;
  let pending: number | null = null;
  let encloseNext: number | null = null;

  for (let index = 0; index < events.length; index++) {
    if (countSearchStep()) return null;
    const event = events[index];
    if (index === events.length - 1) {
      const midi = ladder[cadenceAt].midi;
      if (!pitchAllowed(midi, midi, low, high)) return null;
      indexes.push(cadenceAt);
      continue;
    }
    const along = index / Math.max(1, events.length - 1);
    const prev = index === 0 ? null : indexes[index - 1];
    const next = events[index + 1];
    const after = events[index + 2];
    const bar = Math.floor(event.beat / 4);
    const echoing =
      (bars === 2 && bar === 1) || (bars === 4 && (bar === 1 || bar === 3));
    const motifLimit = bar === 3 ? 2 : 3;

    if (encloseNext !== null && prev !== null) {
      const chosen = encloseNext;
      encloseNext = null;
      if (Math.abs(chosen - prev) >= 2) pending = Math.sign(chosen - prev);
      if (bar === 0 && motif.length < 3) motif.push(chosen - prev);
      indexes.push(chosen);
      continue;
    }
    if (pending !== null && prev !== null) {
      const chosen = prev - pending;
      pending = null;
      if (chosen < 0 || chosen >= ladder.length || !alive[index][chosen])
        return null;
      if (bar === 0 && motif.length < 3) motif.push(chosen - prev);
      indexes.push(chosen);
      continue;
    }

    let options: number[] = [];
    if (prev === null) {
      for (let tone = 0; tone < ladder.length; tone++) {
        if (alive[index][tone]) options.push(tone);
      }
    } else {
      for (const tone of [prev - 1, prev + 1]) {
        if (stepOk(ladder, prev, tone, event) && alive[index][tone])
          options.push(tone);
      }
      const penultimate = index + 1 === events.length - 1;
      if (leaps && !event.strong && !penultimate && next) {
        const goal = contourMidi(plan, along);
        const dir = Math.sign(goal - ladder[prev].midi);
        const reach = event.duration <= 0.5 ? 2 : 3;
        for (let size = 2; size <= reach; size++) {
          const tone = prev + dir * size;
          if (dir === 0 || tone < 0 || tone >= ladder.length) continue;
          const gap = Math.abs(ladder[tone].midi - ladder[prev].midi);
          if (!arrivalOk(gap, event.duration)) continue;
          const back = tone - dir;
          if (!alive[index + 1]?.[back]) continue;
          if (!stepOk(ladder, tone, back, next)) continue;
          options.push(tone);
        }
      }
    }
    options = options.filter((tone) =>
      pitchAllowed(ladder[tone].midi, ladder[tone].midi, low, high),
    );
    if (plan.contour === 'wave') {
      const mid = Math.floor((events.length - 1) / 2);
      if (index <= mid) {
        const capped = options.filter(
          (tone) => Math.abs(tone - cadenceAt) <= mid - index,
        );
        if (capped.length) options = capped;
      }
    }
    if (!options.length) return null;

    let chosen = nearestIndex(
      options,
      ladder,
      contourMidi(plan, along),
      event.strong,
    );
    if (
      echoing &&
      prev !== null &&
      motifUsed < motifLimit &&
      motif[motifUsed] !== undefined
    ) {
      const want = prev + motif[motifUsed];
      if (options.includes(want)) {
        chosen = want;
        motifUsed += 1;
      } else motifUsed = motifLimit;
    }
    const followed = events[index + 3];
    if (
      enclose &&
      prev !== null &&
      !echoing &&
      !event.strong &&
      next &&
      !next.strong &&
      after?.strong &&
      !followed?.strong &&
      index + 2 < events.length - 1 &&
      Math.abs(chosen - prev) === 1
    ) {
      const chords = ladder.flatMap((tone, toneIndex) =>
        tone.chordTone ? [toneIndex] : [],
      );
      if (chords.length) {
        const target = nearestIndex(
          chords,
          ladder,
          contourMidi(
            plan,
            Math.min(1, (index + 2) / Math.max(1, events.length - 1)),
          ),
          true,
        );
        const above = target + 1;
        const below = target - 1;
        if (
          options.includes(above) &&
          below >= 0 &&
          below < ladder.length &&
          alive[index + 2]?.[target] &&
          arrivalOk(
            Math.abs(ladder[above].midi - ladder[below].midi),
            next.duration,
          ) &&
          stepOk(ladder, below, target, after)
        ) {
          chosen = above;
          encloseNext = below;
        }
      }
    }
    if (prev !== null && Math.abs(chosen - prev) >= 2)
      pending = Math.sign(chosen - prev);
    if (bar === 0 && prev !== null && motif.length < 3)
      motif.push(chosen - prev);
    indexes.push(chosen);
  }
  if (!lineIsLegal(indexes, events, ladder, cadenceAt)) return null;
  return indexes;
}

function cadenceIndexOf(
  ladder: readonly LadderTone[],
  pcs: ReadonlySet<number>,
  plan: PhrasePlan,
  bars: 2 | 4,
): number {
  const goal = contourGoal(plan, bars * 4, bars);
  let best = -1;
  let bestDist = Infinity;
  for (let index = 0; index < ladder.length; index++) {
    if (!pcs.has(ladder[index].note.pc)) continue;
    const dist = Math.abs(ladder[index].midi - goal);
    if (dist < bestDist || (dist === bestDist && (best < 0 || index < best))) {
      best = index;
      bestDist = dist;
    }
  }
  return best;
}

function handAccepts(notes: readonly FingeredNote[]): boolean {
  let shifts = 0;
  for (let index = 1; index < notes.length; index++) {
    const prev = notes[index - 1];
    const note = notes[index];
    if (note.shift) {
      shifts += 1;
      if (note.duration <= 0.5) return false;
    } else if (
      note.duration <= 0.5 &&
      !withinHand(note.midi, prev.position, handSlack(note.duration))
    ) {
      return false;
    }
    if (
      prev.finger > 0 &&
      note.finger === prev.finger &&
      note.fret !== prev.fret &&
      note.duration <= 0.5
    ) {
      return false;
    }
  }
  return shifts <= 2;
}

function scaleStepCount(
  from: number,
  to: number,
  scalePcs: ReadonlySet<number>,
): number {
  if (from === to) return 0;
  const sign = Math.sign(to - from);
  let midi = from;
  let count = 0;
  while (midi !== to && count < 24) {
    midi += sign;
    if (scalePcs.has(mod(midi))) count += 1;
  }
  return sign * count;
}

function motifReturned(
  notes: readonly { midi: number; beat: number }[],
  bars: 2 | 4,
  scalePcs: ReadonlySet<number>,
): boolean {
  const groups: number[][] = Array.from({ length: bars }, () => []);
  for (const note of notes) {
    const bar = Math.floor(note.beat / 4);
    if (bar >= 0 && bar < bars) groups[bar].push(note.midi);
  }
  const deltas = groups.map((group) => {
    const steps: number[] = [];
    for (let index = 1; index < group.length; index++) {
      steps.push(scaleStepCount(group[index - 1], group[index], scalePcs));
    }
    return steps;
  });
  const head = deltas[0]?.slice(0, 3) ?? [];
  if (head.length < 2) return false;
  for (let bar = 1; bar < deltas.length; bar++) {
    const span = Math.min(3, head.length, deltas[bar].length);
    if (span < 2) continue;
    let match = true;
    for (let index = 0; index < span; index++) {
      if (deltas[bar][index] !== head[index]) match = false;
    }
    if (match && span >= 3) return true;
    if (match && span === 2 && head.length === 2) return true;
  }
  return false;
}

function criticScore(
  notes: readonly PhraseNote[],
  plan: PhrasePlan,
  bars: 2 | 4,
  scalePcs: ReadonlySet<number>,
): number {
  let strong = 0;
  let strongChord = 0;
  let rests = 0;
  let sync = 0;
  let fit = 0;
  const signatures: string[] = [];
  for (let bar = 0; bar < bars; bar++) {
    const onsets = notes
      .filter((note) => Math.floor(note.beat / 4) === bar)
      .map((note) => Math.round((note.beat - bar * 4) * 2));
    signatures.push(onsets.join(','));
  }
  for (let index = 0; index < notes.length; index++) {
    const note = notes[index];
    if (note.strong) {
      strong += 1;
      if (note.chordTone) strongChord += 1;
    }
    const next = notes[index + 1];
    if (next && note.duration + 1e-6 < next.beat - note.beat) rests += 1;
    const fraction = note.beat - Math.floor(note.beat + 1e-9);
    if (Math.abs(fraction - 0.5) < 0.01) {
      const following = Math.floor(note.beat) + 1;
      const struck = notes.some(
        (item) => Math.abs(item.beat - following) < 0.01,
      );
      if (!struck) sync += 1;
    }
    const goal = contourMidi(plan, index / Math.max(1, notes.length - 1));
    fit += Math.max(0, PHRASE_RANGE - Math.abs(note.midi - goal));
  }
  const midis = notes.map((note) => note.midi);
  const range = Math.max(...midis) - Math.min(...midis);
  const distinct = new Set(signatures).size;
  const same =
    signatures.length > 1 && signatures.every((item) => item === signatures[0]);
  const quarter =
    notes.every((note) => Math.abs(note.beat - Math.round(note.beat)) < 0.01) &&
    notes.slice(0, -1).every((note) => Math.abs(note.duration - 1) < 0.01);
  let score = Math.round(100 * (strong ? strongChord / strong : 0));
  score += strong * 12;
  score += distinct * 18;
  score += Math.min(rests, 6) * 7;
  score += Math.min(sync, 6) * 8;
  score += Math.round(fit / notes.length);
  score += Math.min(range, 12);
  if (same) score -= 80;
  if (quarter) score -= 24;
  if (motifReturned(notes, bars, scalePcs)) score += 36;
  const cells = plan.cells ?? [];
  for (let index = 1; index < cells.length; index++) {
    if (cells[index] === cells[index - 1]) score -= 30;
  }
  return score;
}

const PHRASE_CANDIDATES = 4;

function composePhrase(
  input: {
    seed: number;
    bars: 2 | 4;
    scaleNotes: readonly Note[];
    chordNotes: readonly Note[];
  },
  plan: PhrasePlan,
  ladder: readonly LadderTone[],
  forms: readonly Pattern[],
): { notes: FingeredNote[]; plan: PhrasePlan } | null {
  const scalePcs = new Set(input.scaleNotes.map((note) => note.pc));
  const cadencePcs = new Set(
    cadencePitchClasses(input.chordNotes, plan.cadence, scalePcs),
  );
  const cadenceAt = cadenceIndexOf(ladder, cadencePcs, plan, input.bars);
  if (cadenceAt < 0) return null;
  const found: {
    notes: PhraseNote[];
    plan: PhrasePlan;
    score: number;
    exact: boolean;
    lane: number;
  }[] = [];
  const lanes = PHRASE_CANDIDATES * 2;
  for (let lane = 0; lane < lanes; lane++) {
    if (searchAtCap() || phraseSearchRefused) break;
    const exact = lane === 0;
    const random = mulberry32((input.seed + (lane + 1) * 0x9e3779b9) >>> 0);
    const patterns = pickPatterns(
      plan.rhythm,
      input.bars,
      random,
      exact ? 1 : lane % 3,
      exact ? false : lane % 4 === 0,
      exact,
    );
    const events = eventsForCells(patterns, input.bars);
    const indexes = walkLine(
      ladder,
      events,
      plan,
      input.bars,
      cadenceAt,
      lane % 3 !== 0,
      lane % 3 === 2,
    );
    if (!indexes) continue;
    const notes: PhraseNote[] = indexes.map((tone, event) => ({
      name: ladder[tone].note.name,
      pc: ladder[tone].note.pc,
      degree: ladder[tone].note.degree,
      midi: ladder[tone].midi,
      beat: events[event].beat,
      duration: events[event].duration,
      strong: events[event].strong,
      chordTone: ladder[tone].chordTone,
    }));
    const nextPlan: PhrasePlan = {
      ...plan,
      form: input.bars === 2 ? 'answer' : 'sentence',
      cells: patterns.map((pattern) => pattern.ids),
    };
    found.push({
      notes,
      plan: nextPlan,
      score: criticScore(notes, nextPlan, input.bars, scalePcs),
      exact,
      lane,
    });
  }
  if (!found.length) {
    // The sampled bars could not reach the cadence. Repeat the busiest
    // downbeat cell. It is a motif repeat, and only used when nothing else walked.
    const straight = BAR_PATTERNS[plan.rhythm]
      .filter((pattern) => pattern.hits.some((hit) => hit.at === 0))
      .sort((a, b) => b.notes - a.notes || (a.ids < b.ids ? -1 : 1))[0];
    if (straight) {
      const patterns = Array.from({ length: input.bars }, () => straight);
      const events = eventsForCells(patterns, input.bars);
      const indexes = walkLine(
        ladder,
        events,
        plan,
        input.bars,
        cadenceAt,
        false,
        false,
      );
      if (indexes) {
        const notes: PhraseNote[] = indexes.map((tone, event) => ({
          name: ladder[tone].note.name,
          pc: ladder[tone].note.pc,
          degree: ladder[tone].note.degree,
          midi: ladder[tone].midi,
          beat: events[event].beat,
          duration: events[event].duration,
          strong: events[event].strong,
          chordTone: ladder[tone].chordTone,
        }));
        const nextPlan: PhrasePlan = {
          ...plan,
          form: input.bars === 2 ? 'answer' : 'sentence',
          cells: patterns.map((pattern) => pattern.ids),
        };
        found.push({
          notes,
          plan: nextPlan,
          score: criticScore(notes, nextPlan, input.bars, scalePcs),
          exact: true,
          lane: lanes,
        });
      }
    }
  }
  if (!found.length) return null;
  // The copied bar is a fallback for a ladder that cannot change rhythm.
  // A varied line wins whenever one exists.
  const varied = found.filter((item) => !item.exact);
  const source = varied.length ? varied : found;
  const fitting = source.filter((item) =>
    contourFits(item.notes, item.plan.contour),
  );
  const pool = fitting.length ? fitting : source;
  // A shift only lowers a score, so a weaker pitch line cannot catch up.
  const ranked = pool
    .slice()
    .sort((a, b) => b.score - a.score || a.lane - b.lane);
  let best: { notes: FingeredNote[]; plan: PhrasePlan; score: number } | null =
    null;
  for (const item of ranked) {
    if (best && item.score <= best.score) break;
    const fingered = fingerNotes(item.notes, forms);
    if (!handAccepts(fingered)) continue;
    let shifts = 0;
    for (const note of fingered) if (note.shift) shifts += 1;
    const score = item.score - shifts * 8;
    if (!best || score > best.score)
      best = { notes: fingered, plan: item.plan, score };
  }
  return best;
}

/** The coarse shape a locked contour has to produce: ends, or a middle arch or wave. */
function contourFits(
  notes: readonly { midi: number }[],
  contour: PhrasePlan['contour'],
): boolean {
  const third = Math.max(1, Math.floor(notes.length / 3));
  const mean = (from: number, to: number) => {
    let sum = 0;
    for (let index = from; index < to; index++) sum += notes[index].midi;
    return sum / Math.max(1, to - from);
  };
  const first = mean(0, third);
  const middle = mean(third, third * 2);
  const last = mean(third * 2, notes.length);
  if (contour === 'rise') return last > first;
  if (contour === 'fall') return first > last;
  if (contour === 'arch') return middle > first && middle > last;
  return middle < first && middle < last;
}

function shapeCover(
  forms: readonly Pattern[],
  midis: readonly number[],
): number {
  if (!forms.length) return -1;
  const distinct = new Set(midis);
  let best = 0;
  let bestHit = -1;
  let bestDist = Infinity;
  forms.forEach((form, index) => {
    const have = new Set(form.positions.map((position) => position.midi));
    let hit = 0;
    for (const midi of distinct) if (have.has(midi)) hit += 1;
    const dist = Math.abs((form.min + form.max) / 2 - 7);
    if (
      hit > bestHit ||
      (hit === bestHit &&
        (dist < bestDist || (dist === bestDist && index < best)))
    ) {
      best = index;
      bestHit = hit;
      bestDist = dist;
    }
  });
  return best;
}

function fingerNotes(
  notes: PhraseNote[],
  forms: readonly Pattern[],
): FingeredNote[] {
  const shapes = formLookup(forms);
  const active = shapeCover(
    forms,
    notes.map((note) => note.midi),
  );
  const shaped = forms.length > 0;
  const choices = notes.map((note) => spotsFor(note.midi));
  const cost = choices.map((spots) =>
    spots.map(() => Number.POSITIVE_INFINITY),
  );
  const back = choices.map((spots) => spots.map(() => -1));
  for (let spot = 0; spot < choices[0].length; spot++) {
    cost[0][spot] =
      Math.abs(choices[0][spot].position - 7) * 0.05 +
      shapeCost(shapes, choices[0][spot], shaped, active);
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
          moveCost(
            choices[index - 1][previous],
            choices[index][spot],
            pitch,
            shapes,
            shaped,
            active,
            notes[index].duration <= 0.5,
          );
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
    shift:
      index > 0 &&
      Math.abs(picked[index].position - picked[index - 1].position) >=
        SHIFT_FRETS,
  }));
}

const spotCache = new Map<number, Spot[]>();

function spotsFor(midi: number): Spot[] {
  const cached = spotCache.get(midi);
  if (cached) return cached;
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
  spotCache.set(midi, spots);
  return spots;
}

function shapeKey(string: number, fret: number): number {
  return string * 32 + fret;
}

function formLookup(forms: readonly Pattern[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  forms.forEach((form, index) => {
    for (const position of form.positions) {
      const key = shapeKey(position.string, position.fret);
      const list = map.get(key);
      if (list) list.push(index);
      else map.set(key, [index]);
    }
  });
  return map;
}

function shapeCost(
  shapes: ReadonlyMap<number, number[]>,
  spot: Spot,
  shaped: boolean,
  active: number,
): number {
  if (!shaped || active < 0) return 0;
  const hits = shapes.get(shapeKey(spot.string, spot.fret));
  if (!hits) return 8;
  if (hits.includes(active)) return 0;
  if (hits.some((index) => Math.abs(index - active) === 1)) return 0.5;
  return 8;
}

function moveCost(
  from: Spot,
  to: Spot,
  pitch: number,
  shapes: ReadonlyMap<number, number[]>,
  shaped: boolean,
  active: number,
  fast: boolean,
): number {
  let cost = Math.abs(to.position - 7) * 0.02;
  cost += handShiftCost(to.position - from.position, fast);
  const jump = Math.abs(from.string - to.string);
  const fromShapes = shapes.get(shapeKey(from.string, from.fret));
  const toShapes = shapes.get(shapeKey(to.string, to.fret));
  const sameShape =
    !!fromShapes &&
    !!toShapes &&
    fromShapes.some((index) => toShapes.includes(index));
  if (jump === 1) cost += 0.7;
  else if ((jump === 2 || jump === 3) && sameShape) cost += 0.4;
  else if (jump === 2) cost += 2.4;
  else if (jump > 2) cost += 5 + jump;
  if (shaped && fromShapes && toShapes) {
    let nearest = Infinity;
    for (const left of fromShapes) {
      for (const right of toShapes)
        nearest = Math.min(nearest, Math.abs(left - right));
    }
    if (nearest >= 2) cost += 6;
  }
  cost += shapeCost(shapes, to, shaped, active);
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
  if (ladder.length < 2) return { ok: false, reason: 'unplayable' };
  const forms = patterns([...input.scaleNotes]);
  const composed = composePhrase(input, plan, ladder, forms);
  if (!composed) return { ok: false, reason: 'unplayable' };
  return {
    ok: true,
    phrase: {
      seed: input.seed >>> 0,
      bars: input.bars,
      plan: composed.plan,
      source,
      notes: composed.notes,
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
