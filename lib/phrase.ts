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

type Pitched = {
  midi: number;
  name: string;
  pc: number;
  degree: string;
  chordTone: boolean;
  /** Ladder index. */
  index: number;
};

/**
 * Cadence pitch, length, and the arrival rule. A strong beat, and any
 * note held for a beat or longer, prefers a chord tone in the weights.
 * The same MIDI twice in a row stays illegal: arrival rejects a gap of 0.
 */
function lineIsLegal(
  notes: readonly { midi: number }[],
  events: readonly GridEvent[],
  cadenceMidi: number,
): boolean {
  if (notes.length !== events.length || notes.length === 0) return false;
  if (notes[notes.length - 1].midi !== cadenceMidi) return false;
  if (events[events.length - 1].duration !== 2) return false;
  for (let index = 0; index < notes.length; index++) {
    if (!spotsFor(notes[index].midi).length) return false;
    if (index === 0) continue;
    const gap = Math.abs(notes[index].midi - notes[index - 1].midi);
    if (!arrivalOk(gap, events[index].duration)) return false;
  }
  return true;
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

/** The note before the cadence still has a scale tone a step away after the history guards. */
function cadenceApproach(
  ladder: readonly LadderTone[],
  alive: readonly (readonly boolean[])[],
  events: readonly GridEvent[],
  notes: readonly Pitched[],
  approach: number,
  penIndex: number,
  cadenceMidi: number,
): boolean {
  const placed = notes.concat(pitchedFromLadder(ladder, approach));
  const candidates = withoutMonotone(
    ladder,
    withoutCycle(
      ladder,
      withoutAlternation(
        ladder,
        legalIndexes(ladder, alive, events, placed, penIndex),
        placed,
      ),
      placed,
      3,
    ),
    placed,
  );
  return candidates.some((tone) => {
    const gap = Math.abs((ladder[tone]?.midi ?? 0) - cadenceMidi);
    return gap > 0 && gap <= 2;
  });
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

function hasOnBeat(pattern: BarPattern): boolean {
  return pattern.hits.some((hit) => hit.at % 2 === 0);
}

function asPattern(
  hits: readonly { at: number; dur: number }[],
  label: string,
): BarPattern | null {
  if (!barIsPlayable(hits)) return null;
  const copy = hits.map((hit) => ({ at: hit.at, dur: hit.dur }));
  return {
    ids: label,
    hits: copy,
    onset: copy.map((hit) => hit.at).join(','),
    notes: copy.length,
  };
}

/** Tails that fill the eighths from `from` through the end of the bar. */
function enumerateTails(from: number): { at: number; dur: number }[][] {
  if (from >= 8) return [[]];
  const found: { at: number; dur: number }[][] = [];
  const walk = (pos: number, acc: { at: number; dur: number }[]) => {
    if (pos === 8) {
      found.push(acc);
      return;
    }
    if (pos > 8) return;
    walk(pos + 1, [...acc, { at: pos, dur: 1 }]);
    if (pos + 2 <= 8) {
      walk(pos + 2, [...acc, { at: pos, dur: 2 }]);
      walk(pos + 2, [...acc, { at: pos + 1, dur: 1 }]);
    }
  };
  walk(from, []);
  found.sort((a, b) => {
    const left = a.map((hit) => hit.at).join(',');
    const right = b.map((hit) => hit.at).join(',');
    return left < right ? -1 : left > right ? 1 : 0;
  });
  return found;
}

function withTail(
  prefix: readonly { at: number; dur: number }[],
  from: number,
  avoidOnset: string,
  random: () => number,
): BarPattern | null {
  if (from > 8) return null;
  const options: BarPattern[] = [];
  for (const tail of enumerateTails(from)) {
    const built = asPattern(
      [...prefix, ...tail],
      `ans ${prefix.map((hit) => hit.at).join(',')}`,
    );
    if (!built || built.onset === avoidOnset) continue;
    options.push(built);
  }
  if (!options.length) return null;
  return options[Math.floor(random() * options.length)] ?? options[0];
}

/**
 * Bar 2 keeps bar 1's first four attacks and then a different tail,
 * so the figure can return without every bar sharing one rhythm.
 */
function answerPattern(
  head: BarPattern,
  random: () => number,
): BarPattern | null {
  if (head.hits.length < 4) return null;
  const prefix = head.hits.slice(0, 4).map((hit) => ({ ...hit }));
  const fourth = prefix[3];
  if (!fourth) return null;
  const end = fourth.at + fourth.dur;
  if (end < 8) {
    const built = withTail(prefix, end, head.onset, random);
    if (built) return built;
  }
  if (fourth.at >= 7) return null;
  const shrunk = prefix
    .slice(0, 3)
    .concat([{ at: fourth.at, dur: 1 }]);
  return withTail(shrunk, fourth.at + 1, head.onset, random);
}

/** Two statements of bar 1's opening two attacks. */
function fragmentPattern(
  head: BarPattern,
  random: () => number,
): BarPattern | null {
  if (head.hits.length < 2) return null;
  const first = head.hits[0];
  const second = head.hits[1];
  if (!first || !second) return null;
  const span = second.at + second.dur - first.at;
  if (span < 1) return null;
  const prefix = [
    { at: first.at, dur: first.dur },
    { at: second.at, dur: second.dur },
  ];
  const copyAt = first.at + span;
  const copyNext = second.at + span;
  if (copyAt < 8 && copyNext < 8) {
    const room = 8 - copyNext;
    if (room >= 1) {
      prefix.push(
        { at: copyAt, dur: first.dur },
        { at: copyNext, dur: Math.min(second.dur, room) },
      );
    }
  }
  const end = prefix[prefix.length - 1];
  if (!end) return null;
  const from = end.at + end.dur;
  if (from > 8) return null;
  if (from === 8) return asPattern(prefix, 'frag');
  return withTail(prefix, from, head.onset, random);
}

function answerable(head: BarPattern): boolean {
  return answerPattern(head, () => 0) !== null;
}

function pickPatterns(
  rhythm: RhythmId,
  bars: 2 | 4,
  random: () => number,
  density: number,
  exact: boolean,
  answer: boolean,
): BarPattern[] {
  const catalog = BAR_PATTERNS[rhythm];
  const grounded = catalog.filter(hasOnBeat);
  const source = grounded.length ? grounded : catalog;
  const busy = source.filter((pattern) => pattern.notes >= 6);
  const spare = source.filter((pattern) => pattern.notes <= 4);
  const pool =
    density === 2 && busy.length
      ? busy
      : density === 0 && spare.length
        ? spare
        : source;
  const chosen: BarPattern[] = [];
  let previous = '';
  for (let bar = 0; bar < bars; bar++) {
    if (exact && bar > 0 && previous) {
      const same = catalog.filter((pattern) => pattern.onset === previous);
      if (same.length) {
        const copy = same[0];
        if (copy) {
          chosen.push(copy);
          previous = copy.onset;
          continue;
        }
      }
    }
    if (!exact && answer && bar === 1 && chosen[0]) {
      const answerBar = answerPattern(chosen[0], random);
      if (answerBar) {
        chosen.push(answerBar);
        previous = answerBar.onset;
        continue;
      }
    }
    if (!exact && bars === 4 && bar === 2 && chosen[0]) {
      const fragment = fragmentPattern(chosen[0], random);
      if (fragment) {
        chosen.push(fragment);
        previous = fragment.onset;
        continue;
      }
    }
    let options = pool.filter((pattern) => pattern.onset !== previous);
    if (!options.length)
      options = source.filter((pattern) => pattern.onset !== previous);
    if (!options.length) options = pool.length ? pool : source;
    if (bar === 0) {
      // The loop restarts on this downbeat. A rest here opens a gap.
      let down = options.filter((pattern) =>
        pattern.hits.some((hit) => hit.at === 0),
      );
      if (!down.length) {
        down = source.filter((pattern) =>
          pattern.hits.some((hit) => hit.at === 0),
        );
      }
      if (down.length) options = down;
      if (!exact) {
        // The answer leaps back to this opening. A quarter or longer
        // can take that leap; an eighth cannot pass a fourth.
        const held = options.filter((pattern) => (pattern.hits[0]?.dur ?? 0) >= 2);
        if (held.length) options = held;
        const ready = options.filter(answerable);
        if (ready.length) options = ready;
      }
      if (exact) {
        const longs = options.filter((pattern) =>
          pattern.hits.every((hit) => hit.dur >= 2),
        );
        if (longs.length) options = longs;
      }
    }
    const pattern =
      options[Math.floor(random() * options.length)] ?? options[0];
    chosen.push(pattern);
    previous = pattern.onset;
  }
  return chosen;
}

const PROXIMITY_VAR = 8;
const RANGE_VAR = 29;
/**
 * Wide enough that a note can leave the contour curve. The third-mean
 * check still keeps a locked rise, fall, arch, or wave.
 */
const CONTOUR_VAR = 36;

/**
 * Most phrases answer bar 1. Every eighth seed is a free line, so the
 * sentence is not the only skeleton.
 */
function answersOpening(seed: number): boolean {
  return seed % 8 !== 0;
}

function pitchedFromLadder(ladder: readonly LadderTone[], tone: number): Pitched {
  const row = ladder[tone];
  return {
    midi: row.midi,
    name: row.note.name,
    pc: row.note.pc,
    degree: row.note.degree,
    chordTone: row.chordTone,
    index: tone,
  };
}

/**
 * Any ladder tone that can still reach the cadence under the arrival rule.
 * A strong beat is not required to be a chord tone.
 */
function reachable(
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
      const from = ladder[tone].midi;
      for (let next = 0; next < count; next++) {
        if (!alive[event + 1][next]) continue;
        if (!arrivalOk(Math.abs(ladder[next].midi - from), landing.duration))
          continue;
        alive[event][tone] = true;
        break;
      }
    }
  }
  return alive;
}

function gauss(delta: number, variance: number): number {
  return Math.exp(-(delta * delta) / (2 * variance));
}

function pitchWeight(
  ladder: readonly LadderTone[],
  tone: number,
  prevMidi: number | null,
  prevPrevMidi: number | null,
  goal: number,
  centre: number,
  event: GridEvent,
  cadenceMidi: number | null,
): number {
  const midi = ladder[tone].midi;
  let weight = gauss(midi - goal, CONTOUR_VAR) * gauss(midi - centre, RANGE_VAR);
  if (prevMidi !== null) {
    const gap = midi - prevMidi;
    weight *= gauss(gap, PROXIMITY_VAR);
    if (prevPrevMidi !== null && midi === prevPrevMidi) weight *= 0.18;
  }
  if (event.strong || event.duration >= 1) {
    weight *= ladder[tone].chordTone ? 2.15 : 0.72;
    if (ladder[tone].chordTone && guideTone(ladder[tone].note.degree))
      weight *= 1.12;
  }
  if (cadenceMidi !== null) {
    const fromCadence = Math.abs(midi - cadenceMidi);
    if (fromCadence > 0 && fromCadence <= 2) weight *= 8;
    else if (fromCadence >= 5) weight *= 0.35;
  }
  return weight > 1e-9 ? weight : 1e-9;
}

/**
 * One draw against the full weights. Every weight is at least a trace,
 * so the total is positive. When `keep` is set, a draw that already
 * qualifies stays; the same draw otherwise picks from the ones that do.
 */
function pickWeighted(
  weights: readonly number[],
  random: () => number,
  keep?: (index: number) => boolean,
): number {
  let total = 0;
  for (const weight of weights) total += weight;
  const draw = random() * total;
  let chosen = weights.length - 1;
  let left = draw;
  for (let index = 0; index < weights.length; index++) {
    left -= weights[index] ?? 0;
    if (left < 0) {
      chosen = index;
      break;
    }
  }
  if (!keep || keep(chosen)) return chosen;
  let readyTotal = 0;
  for (let index = 0; index < weights.length; index++) {
    if (keep(index)) readyTotal += weights[index] ?? 0;
  }
  if (readyTotal <= 0) return chosen;
  let cursor = (draw / total) * readyTotal;
  for (let index = 0; index < weights.length; index++) {
    if (!keep(index)) continue;
    cursor -= weights[index] ?? 0;
    if (cursor < 0) return index;
  }
  return chosen;
}

function legalIndexes(
  ladder: readonly LadderTone[],
  alive: readonly (readonly boolean[])[],
  events: readonly GridEvent[],
  notes: readonly Pitched[],
  index: number,
): number[] {
  const prev = notes.length ? notes[notes.length - 1] : null;
  const found: number[] = [];
  for (let tone = 0; tone < ladder.length; tone++) {
    if (!alive[index][tone]) continue;
    if (prev) {
      const gap = Math.abs(ladder[tone].midi - prev.midi);
      if (!arrivalOk(gap, events[index].duration)) continue;
    }
    found.push(tone);
  }
  return found;
}

function withoutAlternation(
  ladder: readonly LadderTone[],
  candidates: readonly number[],
  notes: readonly Pitched[],
): number[] {
  if (notes.length < 3) return [...candidates];
  if (notes[notes.length - 1].midi !== notes[notes.length - 3].midi)
    return [...candidates];
  const earlier = notes[notes.length - 2].midi;
  const others = candidates.filter((tone) => ladder[tone].midi !== earlier);
  return others.length ? others : [...candidates];
}

function completesCycle(
  notes: readonly { midi: number }[],
  midi: number,
  period: number,
): boolean {
  const count = notes.length;
  if (period < 2 || count < period * 2 - 1) return false;
  if (midi !== notes[count - period].midi) return false;
  for (let back = 1; back < period; back++) {
    if (notes[count - back].midi !== notes[count - period - back].midi)
      return false;
  }
  return true;
}

function withoutCycle(
  ladder: readonly LadderTone[],
  candidates: readonly number[],
  notes: readonly Pitched[],
  period: number,
): number[] {
  if (notes.length < period * 2 - 1) return [...candidates];
  const others = candidates.filter(
    (tone) => !completesCycle(notes, ladder[tone].midi, period),
  );
  return others.length ? others : [...candidates];
}

function endingRun(indexes: readonly number[]): number {
  let dir = 0;
  let length = 1;
  for (let index = indexes.length - 1; index > 0; index--) {
    const delta = indexes[index] - indexes[index - 1];
    if (Math.abs(delta) !== 1) break;
    if (dir === 0) dir = delta;
    else if (delta !== dir) break;
    length += 1;
  }
  return length;
}

function withoutMonotone(
  ladder: readonly LadderTone[],
  candidates: readonly number[],
  notes: readonly Pitched[],
): number[] {
  if (notes.length < 4) return [...candidates];
  if (endingRun(notes.map((note) => note.index)) < 4) return [...candidates];
  const last = notes[notes.length - 1]?.index ?? 0;
  const dir =
    last - (notes[notes.length - 2]?.index ?? last);
  const others = candidates.filter((tone) => tone - last !== dir);
  return others.length ? others : [...candidates];
}

function shiftOrder(seed: number): number[] {
  const order = [1, -1, 2, -2];
  const random = mulberry32(seed >>> 0);
  for (let index = order.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const held = order[index];
    order[index] = order[swap] ?? held;
    order[swap] = held;
  }
  return order;
}

function eighthOf(events: readonly GridEvent[], index: number): number {
  const beat = events[index]?.beat ?? 0;
  const bar = Math.floor(beat / 4);
  return Math.round((beat - bar * 4) * 2);
}

function sameOpening(
  events: readonly GridEvent[],
  left: readonly number[],
  right: readonly number[],
  count: number,
): boolean {
  if (left.length < count || right.length < count) return false;
  for (let index = 0; index < count; index++) {
    if (eighthOf(events, left[index] ?? 0) !== eighthOf(events, right[index] ?? 0))
      return false;
  }
  return true;
}

function fragmentRhythm(
  events: readonly GridEvent[],
  head: readonly number[],
  bar: readonly number[],
): boolean {
  if (head.length < 2 || bar.length < 4) return false;
  const firstAt = head[0] ?? 0;
  const secondAt = head[1] ?? 0;
  const first = eighthOf(events, firstAt);
  const second = eighthOf(events, secondAt);
  const secondDur = Math.max(
    1,
    Math.round((events[secondAt]?.duration ?? 0.5) * 2),
  );
  // Same span fragmentPattern uses: end of the second attack, not the gap.
  const span = second + secondDur - first;
  if (span <= 0) return false;
  return (
    eighthOf(events, bar[0] ?? 0) === first &&
    eighthOf(events, bar[1] ?? 0) === second &&
    eighthOf(events, bar[2] ?? 0) === first + span &&
    eighthOf(events, bar[3] ?? 0) === second + span
  );
}

function blockAllowed(
  ladder: readonly LadderTone[],
  alive: readonly (readonly boolean[])[],
  events: readonly GridEvent[],
  notes: readonly Pitched[],
  slots: readonly number[],
  tones: readonly number[],
): boolean {
  if (tones.length !== slots.length) return false;
  const midis = notes.map((note) => note.midi);
  const indexes = notes.map((note) => note.index);
  let prev = notes.length ? notes[notes.length - 1].midi : null;
  for (let step = 0; step < tones.length; step++) {
    const tone = tones[step] ?? -1;
    const at = slots[step] ?? 0;
    if (tone < 0 || tone >= ladder.length || !alive[at]?.[tone]) return false;
    const midi = ladder[tone].midi;
    if (
      prev !== null &&
      !arrivalOk(Math.abs(midi - prev), events[at]?.duration ?? 1)
    )
      return false;
    const soFar = midis.map((item) => ({ midi: item }));
    // A one-step sequence of a scale overlaps into a 3-pitch cell.
    // That return stays when it sits inside the figure. A cycle that
    // runs past the figure is the ostinato the free walk already refuses.
    if (completesCycle(soFar, midi, 2) || completesCycle(soFar, midi, 3))
      return false;
    midis.push(midi);
    indexes.push(tone);
    prev = midi;
  }
  return endingRun(indexes) < 5;
}

function chooseSequence(
  order: readonly number[],
  idea: readonly number[],
  slots: readonly number[],
  ladder: readonly LadderTone[],
  alive: readonly (readonly boolean[])[],
  events: readonly GridEvent[],
  notes: readonly Pitched[],
  cadenceMidi: number,
): number[] | null {
  const lastSlot = slots[slots.length - 1];
  const ending = lastSlot === events.length - 2;
  let octave = 0;
  for (let index = 1; index < ladder.length; index++) {
    if (ladder[index].midi - ladder[0].midi === 12) {
      octave = index;
      break;
    }
  }
  const shifts = octave > 0 ? [...order, octave, -octave, 0] : [...order, 0];
  const options: {
    tones: number[];
    miss: number;
    strongMiss: number;
    shift: number;
    step: boolean;
  }[] = [];
  for (const shift of shifts) {
    const tones = idea.map((index) => index + shift);
    if (!blockAllowed(ladder, alive, events, notes, slots, tones)) continue;
    let miss = 0;
    let strongMiss = 0;
    for (let index = 0; index < tones.length; index++) {
      const event = events[slots[index] ?? 0];
      const tone = tones[index] ?? -1;
      const chord =
        tone >= 0 && tone < ladder.length && ladder[tone].chordTone;
      if (!event) continue;
      if (event.duration >= 1 && !chord) miss += 1;
      if (event.strong && !chord) strongMiss += 1;
    }
    let step = false;
    if (ending) {
      const tone = tones[tones.length - 1] ?? -1;
      const gap =
        tone >= 0 && tone < ladder.length
          ? Math.abs(ladder[tone].midi - cadenceMidi)
          : 99;
      step = gap > 0 && gap <= 2;
    }
    options.push({ tones, miss, strongMiss, shift, step });
  }
  // A step into the cadence wins, then held chord tones, then strong
  // beats on the chord. A smaller shift wins a tie, so an octave stands
  // in for an exact copy only when the seconds leave the chord.
  const stepping = options.filter((item) => item.step);
  const pool = ending && stepping.length ? stepping : options;
  pool.sort(
    (a, b) =>
      a.miss - b.miss ||
      a.strongMiss - b.strongMiss ||
      Number(a.shift === 0) - Number(b.shift === 0) ||
      Math.abs(a.shift) - Math.abs(b.shift),
  );
  return pool[0]?.tones ?? null;
}

function chooseFragment(
  order: readonly number[],
  idea: readonly number[],
  slots: readonly number[],
  ladder: readonly LadderTone[],
  alive: readonly (readonly boolean[])[],
  events: readonly GridEvent[],
  notes: readonly Pitched[],
): number[] | null {
  const left = idea[0] ?? 0;
  const right = idea[1] ?? 0;
  let best: number[] | null = null;
  let bestScore = -1;
  for (const shift of order) {
    const seconds = [shift * 2, shift + Math.sign(shift)];
    for (const second of seconds) {
      if (second === 0 || second === shift) continue;
      const tones = [left + shift, right + shift, left + second, right + second];
      if (!blockAllowed(ladder, alive, events, notes, slots, tones)) continue;
      let score = 0;
      for (let index = 0; index < tones.length; index++) {
        const tone = tones[index] ?? -1;
        const event = events[slots[index] ?? 0];
        if (!event || event.duration < 1) continue;
        if (tone >= 0 && tone < ladder.length && ladder[tone].chordTone)
          score += 1;
      }
      if (!best || score > bestScore) {
        best = tones;
        bestScore = score;
      }
    }
  }
  return best;
}

/**
 * Scored pitches, then a sentence. On most seeds bar 2 opens on bar 1's
 * first four attacks, transposed by one or two scale steps. A 4-bar phrase
 * sequences a two-note fragment twice in bar 3. A held note is a chord
 * tone when one is still legal. The approach is not: it stays a step from
 * the cadence. The free tail walks to that step when one is still legal.
 * A second two-pitch return, a repeated three-pitch cell, and a fifth
 * scale step in the same direction are refused when another tone is legal.
 */
function walkScored(
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  plan: PhrasePlan,
  bars: 2 | 4,
  cadenceAt: number,
  alive: readonly (readonly boolean[])[],
  random: () => number,
  seed: number,
): Pitched[] | null {
  const centre = REGISTER_LOW[plan.register] + PHRASE_RANGE / 2;
  const cadenceMidi = ladder[cadenceAt]?.midi ?? 0;
  const notes: Pitched[] = [];
  const order = shiftOrder(seed);
  // Shifts that keep an opening held note on a chord tone, so the answer can too.
  let openShifts: readonly number[] | null = null;
  const byBar: number[][] = Array.from({ length: bars }, () => []);
  events.forEach((event, index) => {
    const bar = Math.floor(event.beat / 4);
    if (bar >= 0 && bar < bars) byBar[bar]?.push(index);
  });
  let pending: number[] = [];
  for (let index = 0; index < events.length; index++) {
    if (countSearchStep()) return null;
    if (index === events.length - 1) {
      notes.push(pitchedFromLadder(ladder, cadenceAt));
      continue;
    }
    if (pending.length) {
      const tone = pending.shift();
      if (tone === undefined) return null;
      notes.push(pitchedFromLadder(ladder, tone));
      continue;
    }
    const event = events[index];
    if (!event) return null;
    const bar = Math.floor(event.beat / 4);
    const head = byBar[0] ?? [];
    const here = byBar[bar] ?? [];
    if (bar === 1 && here[0] === index && sameOpening(events, head, here, 4)) {
      const idea = head.slice(0, 4).map((at) => notes[at]?.index ?? -1);
      const slots = here.slice(0, 4);
      const tones = chooseSequence(
        order,
        idea,
        slots,
        ladder,
        alive,
        events,
        notes,
        cadenceMidi,
      );
      if (tones) {
        pending = tones.slice(1);
        notes.push(pitchedFromLadder(ladder, tones[0] ?? 0));
        continue;
      }
    }
    if (
      bar === 2 &&
      bars === 4 &&
      here[0] === index &&
      fragmentRhythm(events, head, here)
    ) {
      const idea = [notes[head[0] ?? 0]?.index ?? -1, notes[head[1] ?? 0]?.index ?? -1];
      const tones = chooseFragment(
        order,
        idea,
        here.slice(0, 4),
        ladder,
        alive,
        events,
        notes,
      );
      if (tones) {
        pending = tones.slice(1);
        notes.push(pitchedFromLadder(ladder, tones[0] ?? 0));
        continue;
      }
    }
    let candidates = withoutMonotone(
      ladder,
      withoutCycle(
        ladder,
        withoutAlternation(
          ladder,
          legalIndexes(ladder, alive, events, notes, index),
          notes,
        ),
        notes,
        3,
      ),
      notes,
    );
    if (!candidates.length) return null;
    const answerFourth = byBar[1]?.[3];
    if (
      head[3] === index &&
      answerFourth !== undefined &&
      (events[answerFourth]?.duration ?? 1) <= 0.5 &&
      notes.length
    ) {
      const prevMidi = notes[notes.length - 1]?.midi ?? 0;
      const stepped = candidates.filter(
        (tone) => Math.abs((ladder[tone]?.midi ?? 0) - prevMidi) <= 5,
      );
      if (stepped.length) candidates = stepped;
    }
    // A held note is a chord tone when one can still be reached. The
    // approach is exempt: it has to be a step into the cadence. Opening
    // held notes also keep a shift that lands on a chord tone.
    if (event.duration >= 1 && index < events.length - 2) {
      let chordTones = candidates.filter((tone) => ladder[tone].chordTone);
      const openingSlot = byBar[0]?.indexOf(index) ?? -1;
      if (bar === 0 && openingSlot >= 0 && openingSlot < 4 && chordTones.length) {
        const pool = openShifts ?? order;
        const anchored = chordTones.filter((tone) =>
          pool.some((shift) => {
            const next = tone + shift;
            return (
              next >= 0 && next < ladder.length && ladder[next].chordTone
            );
          }),
        );
        if (anchored.length) chordTones = anchored;
      }
      if (index === events.length - 3) {
        const ready = chordTones.filter((tone) =>
          cadenceApproach(
            ladder,
            alive,
            events,
            notes,
            tone,
            index + 1,
            cadenceMidi,
          ),
        );
        if (ready.length) candidates = ready;
      } else if (chordTones.length) {
        candidates = chordTones;
      }
    }
    const along = index / Math.max(1, events.length - 1);
    const goal = contourMidi(plan, along);
    const prev = notes.length ? notes[notes.length - 1] : null;
    const weights = candidates.map((tone) =>
      pitchWeight(
        ladder,
        tone,
        prev ? prev.midi : null,
        notes.length > 1 ? notes[notes.length - 2].midi : null,
        goal,
        centre,
        event,
        index === events.length - 2 ? cadenceMidi : null,
      ),
    );
    // The returned figure is already placed. The note before the approach
    // stays when a step into the cadence is still reachable from it. The
    // approach stays when it is already one or two semitones away.
    // Otherwise the same draw picks a legal scale tone that keeps the step.
    const chosenTone = (keep?: (tone: number) => boolean) => {
      const at = pickWeighted(
        weights,
        random,
        keep ? (slot) => keep(candidates[slot] ?? -1) : undefined,
      );
      return candidates[at] ?? candidates[0];
    };
    const chosen =
      index === events.length - 3
        ? chosenTone((tone) =>
            cadenceApproach(
              ladder,
              alive,
              events,
              notes,
              tone,
              index + 1,
              cadenceMidi,
            ),
          )
        : index === events.length - 2
          ? chosenTone((tone) => {
              const gap = Math.abs((ladder[tone]?.midi ?? 0) - cadenceMidi);
              return gap > 0 && gap <= 2;
            })
          : chosenTone();
    if (chosen === undefined) return null;
    const openingSlot = byBar[0]?.indexOf(index) ?? -1;
    if (event.duration >= 1 && bar === 0 && openingSlot >= 0 && openingSlot < 4) {
      const pool = openShifts ?? order;
      const fits = pool.filter((shift) => {
        const next = chosen + shift;
        return next >= 0 && next < ladder.length && ladder[next].chordTone;
      });
      if (fits.length) openShifts = fits;
    }
    notes.push(pitchedFromLadder(ladder, chosen));
  }
  if (!lineIsLegal(notes, events, cadenceMidi)) return null;
  return notes;
}


function walkPitches(
  ladder: readonly LadderTone[],
  events: readonly GridEvent[],
  plan: PhrasePlan,
  bars: 2 | 4,
  cadenceAt: number,
  random: () => number,
  seed: number,
): Pitched[] | null {
  const alive = reachable(ladder, events, cadenceAt);
  if (!alive[0].some(Boolean)) return null;
  return walkScored(
    ladder,
    events,
    plan,
    bars,
    cadenceAt,
    alive,
    random,
    seed,
  );
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

function longestMonotone(
  midis: readonly number[],
  scalePcs: ReadonlySet<number>,
): number {
  let best = 1;
  let run = 1;
  let dir = 0;
  for (let index = 1; index < midis.length; index++) {
    const step = scaleStepCount(midis[index - 1] ?? 0, midis[index] ?? 0, scalePcs);
    if (Math.abs(step) === 1 && step === dir) run += 1;
    else if (Math.abs(step) === 1) {
      dir = step;
      run = 2;
    } else {
      dir = 0;
      run = 1;
    }
    if (run > best) best = run;
  }
  return best;
}

function repeatedPitchCell(
  midis: readonly number[],
  period: number,
  cycles: number,
  cover: readonly [number, number] | null,
): boolean {
  const length = period * cycles;
  for (let start = 0; start + length <= midis.length; start++) {
    if (cover && start >= cover[0] && start + length <= cover[1]) continue;
    let match = true;
    for (let index = period; index < length; index++) {
      if (midis[start + index] !== midis[start + (index % period)]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const pitches = new Set(midis.slice(start, start + period));
    if (pitches.size < 2) continue;
    return true;
  }
  return false;
}

/** Index span of a shifted 4-note return, so that overlap is not an ostinato. */
function sentenceCover(
  notes: readonly { midi: number; beat: number }[],
  scalePcs: ReadonlySet<number>,
): [number, number] | null {
  const grouped = [0, 1].map((bar) =>
    notes
      .map((note, index) => ({ note, index }))
      .filter(
        (item) =>
          Math.floor(item.note.beat / 4) === bar && item.note.beat < 8,
      ),
  );
  const left = grouped[0] ?? [];
  const right = grouped[1] ?? [];
  if (left.length < 4 || right.length < 4) return null;
  const opening = left.slice(0, 4);
  const answer = right.slice(0, 4);
  for (let index = 0; index < 4; index++) {
    const a = opening[index]?.note;
    const b = answer[index]?.note;
    if (!a || !b) return null;
    if (Math.round((a.beat % 4) * 2) !== Math.round((b.beat % 4) * 2))
      return null;
  }
  for (let index = 1; index < 4; index++) {
    const prev = opening[index - 1]?.note.midi ?? 0;
    const next = opening[index]?.note.midi ?? 0;
    const otherPrev = answer[index - 1]?.note.midi ?? 0;
    const otherNext = answer[index]?.note.midi ?? 0;
    if (
      scaleStepCount(prev, next, scalePcs) !==
      scaleStepCount(otherPrev, otherNext, scalePcs)
    )
      return null;
  }
  const from = opening[0]?.index ?? 0;
  const to = (answer[3]?.index ?? 0) + 1;
  return [from, to];
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
  const ratio = strong ? strongChord / strong : 0;
  let score = Math.round(90 * (1 - Math.abs(ratio - 0.65)));
  score += strong * 12;
  score += distinct * 18;
  score += Math.min(rests, 6) * 7;
  score += Math.min(sync, 6) * 8;
  // A light nudge. The third-mean gate already enforces the lock.
  score += Math.round(fit / notes.length / 4);
  score += Math.min(range, 12);
  if (same) score -= 80;
  if (quarter) score -= 24;
  score -= pitchCriticPenalty(notes, midis, bars, scalePcs);
  const cells = plan.cells ?? [];
  for (let index = 1; index < cells.length; index++) {
    if (cells[index] === cells[index - 1]) score -= 30;
  }
  return score;
}

const PHRASE_CANDIDATES = 4;

function notesFromPitches(
  pitches: readonly Pitched[],
  events: readonly GridEvent[],
): PhraseNote[] {
  return pitches.map((tone, event) => ({
    name: tone.name,
    pc: tone.pc,
    degree: tone.degree,
    midi: tone.midi,
    beat: events[event].beat,
    duration: events[event].duration,
    strong: events[event].strong,
    chordTone: tone.chordTone,
  }));
}

/**
 * Target bands for step size, leaps, and the two-pitch wobble.
 * A repeated 3-pitch cell and a 5-note scale run lose the lane.
 * A shifted sentence is a different pitch level, so it is not a cell.
 */
function pitchCriticPenalty(
  notes: readonly PhraseNote[],
  midis: readonly number[],
  bars: 2 | 4,
  scalePcs: ReadonlySet<number>,
): number {
  let penalty = 0;
  for (let bar = 0; bar < bars; bar++) {
    const group = notes.filter(
      (note) => Math.floor(note.beat / 4) === bar && note.beat < bars * 4,
    );
    if (group.length >= 4 && new Set(group.map((note) => note.midi)).size <= 2)
      penalty += 160;
  }
  let run = 1;
  let best = 1;
  for (let index = 1; index < midis.length; index++) {
    if (midis[index] === midis[index - 1]) run = 1;
    else if (index >= 2 && midis[index] === midis[index - 2]) run += 1;
    else run = 2;
    if (run > best) best = run;
  }
  if (best >= 5) penalty += 180;
  const cover = sentenceCover(notes, scalePcs);
  if (longestMonotone(midis, scalePcs) >= 5) penalty += 240;
  if (repeatedPitchCell(midis, 3, 2, cover)) penalty += 240;
  if (repeatedPitchCell(midis, 3, 3, cover)) penalty += 200;
  const counts = new Map<number, number>();
  for (const midi of midis) counts.set(midi, (counts.get(midi) ?? 0) + 1);
  const ranked = [...counts.values()].sort((a, b) => b - a);
  const top2 = ((ranked[0] ?? 0) + (ranked[1] ?? 0)) / Math.max(1, midis.length);
  if (top2 > 0.45) penalty += Math.round((top2 - 0.45) * 220);
  let total = 0;
  let small = 0;
  let wide = 0;
  for (let index = 1; index < midis.length; index++) {
    const gap = Math.abs(midis[index] - midis[index - 1]);
    total += 1;
    if (gap <= 2) small += 1;
    if (gap >= 5) wide += 1;
  }
  if (total) {
    penalty += Math.round(36 * Math.abs(small / total - 0.65));
    penalty += Math.round(28 * Math.abs(wide / total - 0.12));
  }
  return penalty;
}

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
      exact,
      answersOpening(input.seed),
    );
    const events = eventsForCells(patterns, input.bars);
    const pitches = walkPitches(
      ladder,
      events,
      plan,
      input.bars,
      cadenceAt,
      random,
      input.seed,
    );
    if (!pitches) continue;
    const notes = notesFromPitches(pitches, events);
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
    // Every sampled lane missed the cadence. One more sentence, still
    // marked exact so a varied lane would have won.
    const random = mulberry32((input.seed + (lanes + 1) * 0x9e3779b9) >>> 0);
    const patterns = pickPatterns(
      plan.rhythm,
      input.bars,
      random,
      1,
      false,
      answersOpening(input.seed),
    );
    if (patterns.length === input.bars) {
      const events = eventsForCells(patterns, input.bars);
      const pitches = walkPitches(
        ladder,
        events,
        plan,
        input.bars,
        cadenceAt,
        random,
        input.seed,
      );
      if (pitches) {
        const notes = notesFromPitches(pitches, events);
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
