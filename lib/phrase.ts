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

export type PhraseFailure = 'no-shared-tones' | 'unplayable';
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

export function onsetSeconds(beat: number, tempo: number, feel: Feel): number {
  const quarter = 60 / (tempo > 0 ? tempo : 96);
  if (feel === 'straight') return beat * quarter;
  const whole = Math.floor(beat + 1e-9);
  const fraction = beat - whole;
  if (fraction < 0.01) return whole * quarter;
  if (Math.abs(fraction - 0.5) < 0.01) return (whole + 2 / 3) * quarter;
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

export function parseSeed(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
    return null;
  return value;
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
    if (motion === 'step') steps += 1;
    else if (motion === 'leap') leaps += 1;
    else unisons += 1;
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
  const search = (
    pos: number,
    left: number,
    resolve: number,
    leapsLeft: number,
  ): boolean => {
    if (left === 0) return pos === to && leapsLeft === 0 && resolve === 0;
    if (resolve !== 0) {
      const next = pos + resolve;
      if (next < 0 || next >= length) return false;
      path.push(next);
      const ok = search(next, left - 1, 0, leapsLeft);
      if (!ok) path.pop();
      return ok;
    }
    if (leapsLeft * 2 > left) return false;
    if (leapsLeft === 0) {
      const distance = Math.abs(to - pos);
      if (distance > left || (left - distance) % 2 !== 0) return false;
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
    }
    return false;
  };
  const found =
    intervals === 0 ? from === to : search(from, intervals, 0, leaps);
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
  // Keep the cadence off the edge of the register when another octave of the
  // same chord tone exists, so a leap can still resolve into it.
  const approachable = cadenceIndexes.filter(
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

  const choose = (slack: number, limit: number) => {
    const budget = targetLeaps + slack;
    const anchors = Array<number>(anchorCount).fill(-1);
    const leaps = Array<number>(Math.max(0, anchorCount - 1)).fill(0);
    const visit = (ordinal: number, spent: number): boolean => {
      if (ordinal === anchorCount - 1) {
        anchors[ordinal] = cadenceLadder;
        if (ordinal === 0) return true;
        const need = minLeaps(
          anchors[ordinal - 1],
          cadenceLadder,
          gaps[ordinal - 1],
          ladder.length,
          cache,
        );
        if (need === null || spent + need > budget) return false;
        leaps[ordinal - 1] = need;
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
        if (visit(ordinal + 1, spent + need)) return true;
      }
      return false;
    };
    return visit(0, 0) ? { anchors, leaps } : null;
  };

  let chosen: { anchors: number[]; leaps: number[] } | null = null;
  for (const slack of [0, 1, 2, 4, 8]) {
    chosen = choose(slack, Math.min(4, chordIndexes.length));
    if (chosen) break;
    if (slack === 8) chosen = choose(slack, chordIndexes.length);
    if (chosen) break;
  }
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
  const notes = indexes.map((index, event) => {
    const tone = ladder[index];
    return {
      name: tone.note.name,
      pc: tone.note.pc,
      degree: tone.note.degree,
      midi: tone.midi,
      beat: events[event].beat,
      duration: events[event].duration,
      strong: events[event].strong,
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

export function generatePhrase(input: {
  seed: number;
  bars: 2 | 4;
  scaleNotes: readonly Note[];
  chordNotes: readonly Note[];
  locks?: PhraseLocks;
}): PhraseResult {
  const available = availableCadences(input.chordNotes, input.scaleNotes);
  if (!available.length) return { ok: false, reason: 'no-shared-tones' };
  const plan = rulePlan(input.seed, available, input.locks);
  return assemble(input, plan, 'rules');
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
  const available = availableCadences(input.chordNotes, input.scaleNotes);
  if (!available.length) return { ok: false, reason: 'no-shared-tones' };
  const rules = rulePlan(input.seed, available);
  if (!input.planner)
    return assemble(input, applyLocks(rules, input.locks, available), 'rules');
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
  if (planned.ok || !accepted) return planned;
  return assemble(input, applyLocks(rules, input.locks, available), 'rules');
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
