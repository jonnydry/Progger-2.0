/**
 * Phrase shape, version 1.
 * A plan without `shape` is the main rules plan. Peak and syncopation are
 * typed so a later pass can read them; this version does not play them.
 * The rhythm grid is never rewritten. Motif rhythm only names a subset of
 * onsets that already exist.
 */

export type MotifContour =
  | 'step-up-step-up'
  | 'step-down-step-down'
  | 'step-up-step-down'
  | 'step-down-step-up'
  | 'skip-up-step-down'
  | 'skip-down-step-up'
  | 'upper-neighbor-turn'
  | 'lower-neighbor-turn'
  | 'arpeggio-up'
  | 'arpeggio-down'
  | 'repeat-then-step-up'
  | 'repeat-then-step-down';

export type MotifRhythm =
  | 'even'
  | 'long-short-short'
  | 'short-short-long'
  | 'pickup-into-downbeat';

export type BarVariation =
  | 'repeat'
  | 'sequence-up'
  | 'sequence-down'
  | 'altered-ending';

export type QuestionDegree = '2' | '4' | '6';

export type PhraseShapePlan = {
  version: 1;
  motif: { contour: MotifContour; rhythm: MotifRhythm };
  /** One entry per bar after the first. Index 1 is bar 3. */
  variations: BarVariation[];
  question: { bar: 1 | 2; degree: QuestionDegree };
  /** Ignored by version 1. */
  peak?: { bar: number; beat: 0 | 1 | 2 | 3 };
  /** Ignored by version 1. */
  syncopation?: { bar: number; beat: 0.5 | 1.5 | 2.5 | 3.5 } | null;
};

export const MOTIF_CONTOURS = [
  'step-up-step-up',
  'step-down-step-down',
  'step-up-step-down',
  'step-down-step-up',
  'skip-up-step-down',
  'skip-down-step-up',
  'upper-neighbor-turn',
  'lower-neighbor-turn',
  'arpeggio-up',
  'arpeggio-down',
  'repeat-then-step-up',
  'repeat-then-step-down',
] as const satisfies readonly MotifContour[];

export const MOTIF_RHYTHMS = [
  'even',
  'long-short-short',
  'short-short-long',
  'pickup-into-downbeat',
] as const satisfies readonly MotifRhythm[];

export const BAR_VARIATIONS = [
  'repeat',
  'sequence-up',
  'sequence-down',
  'altered-ending',
] as const satisfies readonly BarVariation[];

export const QUESTION_DEGREES = [
  '2',
  '4',
  '6',
] as const satisfies readonly QuestionDegree[];

const CONTOUR_DELTAS: Record<MotifContour, readonly number[]> = {
  'step-up-step-up': [1, 1],
  'step-down-step-down': [-1, -1],
  'step-up-step-down': [1, -1],
  'step-down-step-up': [-1, 1],
  'skip-up-step-down': [2, -1],
  'skip-down-step-up': [-2, 1],
  'upper-neighbor-turn': [1, -1],
  'lower-neighbor-turn': [-1, 1],
  'arpeggio-up': [2, 2],
  'arpeggio-down': [-2, -2],
  'repeat-then-step-up': [0, 1],
  'repeat-then-step-down': [0, -1],
};

export type ShapeRhythm = 'quarters' | 'eighths' | 'long-short' | 'push';

/**
 * Quarters and long-short have only two onsets in a half-bar, so the motif
 * is the whole first bar. Eighths and push use the first half-bar.
 */
export function motifBeatLimit(rhythm: ShapeRhythm): number {
  return rhythm === 'quarters' || rhythm === 'long-short' ? 4 : 2;
}

/** Motif rhythms whose onsets are already inside this grid's motif window. */
export function motifRhythmsFor(rhythm: ShapeRhythm): readonly MotifRhythm[] {
  switch (rhythm) {
    case 'quarters':
      return ['even'];
    case 'long-short':
      return ['even', 'long-short-short'];
    case 'push':
      return ['even', 'pickup-into-downbeat'];
    case 'eighths':
      return MOTIF_RHYTHMS;
  }
}

export function questionBarFor(bars: 2 | 4): 1 | 2 {
  return bars === 2 ? 1 : 2;
}

export function contourDeltas(contour: MotifContour): readonly number[] {
  return CONTOUR_DELTAS[contour];
}

export function scaleDegreeNumber(degree: string): number | null {
  const match = /^([b#]*)(\d+)$/.exec(degree);
  if (!match) return null;
  const raw = Number(match[2]);
  if (!Number.isInteger(raw) || raw < 1) return null;
  return ((raw - 1) % 7) + 1;
}

export function isQuestionDegree(degree: string): boolean {
  const simple = scaleDegreeNumber(degree);
  return simple === 2 || simple === 4 || simple === 6;
}

function pick<T>(random: () => number, options: readonly T[]): T {
  const index = Math.floor(random() * options.length);
  return options[Math.min(options.length - 1, Math.max(0, index))] as T;
}

/** Uniform fields. Bar 3 of a 4-bar phrase is never `repeat`. */
export function rollShape(
  random: () => number,
  bars: 2 | 4,
  rhythm: ShapeRhythm,
): PhraseShapePlan {
  const rhythms = motifRhythmsFor(rhythm);
  const variations: BarVariation[] = [];
  for (let index = 0; index < bars - 1; index++) {
    const menu =
      bars === 4 && index === 1
        ? BAR_VARIATIONS.filter((item) => item !== 'repeat')
        : BAR_VARIATIONS;
    variations.push(pick(random, menu));
  }
  return {
    version: 1,
    motif: {
      contour: pick(random, MOTIF_CONTOURS),
      rhythm: pick(random, rhythms),
    },
    variations,
    question: {
      bar: questionBarFor(bars),
      degree: pick(random, QUESTION_DEGREES),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function motifRhythmFits(
  rhythm: MotifRhythm,
  grid: ShapeRhythm | undefined,
): boolean {
  if (!grid) return MOTIF_RHYTHMS.includes(rhythm);
  return motifRhythmsFor(grid).includes(rhythm);
}

/**
 * Drop a shape that is not version 1 or that breaks a hard rule.
 * Peak and syncopation are kept when they are well typed and otherwise
 * omitted. The realizer does not read them.
 */
export function sanitizeShape(
  value: unknown,
  bars: 2 | 4,
  grid?: ShapeRhythm,
): PhraseShapePlan | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined;
  const motif = value.motif;
  if (!isRecord(motif)) return undefined;
  const contour = motif.contour;
  const rhythm = motif.rhythm;
  if (
    typeof contour !== 'string' ||
    !MOTIF_CONTOURS.includes(contour as MotifContour) ||
    typeof rhythm !== 'string' ||
    !motifRhythmFits(rhythm as MotifRhythm, grid)
  ) {
    return undefined;
  }
  if (!Array.isArray(value.variations) || value.variations.length !== bars - 1)
    return undefined;
  const variations: BarVariation[] = [];
  for (const item of value.variations) {
    if (
      typeof item !== 'string' ||
      !BAR_VARIATIONS.includes(item as BarVariation)
    )
      return undefined;
    variations.push(item as BarVariation);
  }
  if (bars === 4 && variations[1] === 'repeat') return undefined;
  const question = value.question;
  if (!isRecord(question)) return undefined;
  const bar = question.bar;
  const degree = question.degree;
  if (bar !== 1 && bar !== 2) return undefined;
  if (bar !== questionBarFor(bars)) return undefined;
  if (
    typeof degree !== 'string' ||
    !QUESTION_DEGREES.includes(degree as QuestionDegree)
  )
    return undefined;
  const shape: PhraseShapePlan = {
    version: 1,
    motif: { contour: contour as MotifContour, rhythm: rhythm as MotifRhythm },
    variations,
    question: { bar, degree: degree as QuestionDegree },
  };
  const peak = sanitizePeak(value.peak);
  if (peak) shape.peak = peak;
  if (value.syncopation === null) shape.syncopation = null;
  else {
    const syncopation = sanitizeSyncopation(value.syncopation);
    if (syncopation) shape.syncopation = syncopation;
  }
  return shape;
}

function sanitizePeak(value: unknown): PhraseShapePlan['peak'] | undefined {
  if (!isRecord(value)) return undefined;
  const bar = value.bar;
  const beat = value.beat;
  if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > 4)
    return undefined;
  if (beat !== 0 && beat !== 1 && beat !== 2 && beat !== 3) return undefined;
  return { bar, beat };
}

function sanitizeSyncopation(
  value: unknown,
): NonNullable<PhraseShapePlan['syncopation']> | undefined {
  if (!isRecord(value)) return undefined;
  const bar = value.bar;
  const beat = value.beat;
  if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > 4)
    return undefined;
  if (beat !== 0.5 && beat !== 1.5 && beat !== 2.5 && beat !== 3.5)
    return undefined;
  return { bar, beat };
}

export type ShapeDistributions = {
  motifContour: Partial<Record<MotifContour, number>>;
  motifRhythm: Partial<Record<MotifRhythm, number>>;
  variations: Partial<Record<BarVariation, number>>[];
  questionDegree: Partial<Record<QuestionDegree, number>>;
  cadence?: Partial<Record<'root' | 'third' | 'fifth', number>>;
};

function sampleWeighted<T extends string>(
  random: () => number,
  menu: readonly T[],
  weights: Partial<Record<T, number>> | undefined,
  blocked?: ReadonlySet<T>,
): T {
  const open = blocked ? menu.filter((item) => !blocked.has(item)) : [...menu];
  const usable = open.length ? open : [...menu];
  let total = 0;
  const scored = usable.map((item) => {
    const raw = weights?.[item];
    const weight = typeof raw === 'number' && raw > 0 ? raw : 0;
    total += weight;
    return { item, weight };
  });
  if (total <= 0) return pick(random, usable);
  let cursor = random() * total;
  for (const entry of scored) {
    cursor -= entry.weight;
    if (cursor <= 0) return entry.item;
  }
  return scored[scored.length - 1]?.item ?? usable[0];
}

/** Sample one shape. Bar 3 cannot land on `repeat` even if that bin is heaviest. */
export function sampleShape(
  random: () => number,
  bars: 2 | 4,
  grid: ShapeRhythm,
  distributions: ShapeDistributions,
): PhraseShapePlan {
  const rhythms = motifRhythmsFor(grid);
  const variations: BarVariation[] = [];
  for (let index = 0; index < bars - 1; index++) {
    const blocked =
      bars === 4 && index === 1 ? new Set<BarVariation>(['repeat']) : undefined;
    variations.push(
      sampleWeighted(
        random,
        BAR_VARIATIONS,
        distributions.variations[index],
        blocked,
      ),
    );
  }
  return {
    version: 1,
    motif: {
      contour: sampleWeighted(
        random,
        MOTIF_CONTOURS,
        distributions.motifContour,
      ),
      rhythm: sampleWeighted(random, rhythms, distributions.motifRhythm),
    },
    variations,
    question: {
      bar: questionBarFor(bars),
      degree: sampleWeighted(
        random,
        QUESTION_DEGREES,
        distributions.questionDegree,
      ),
    },
  };
}

export function motifWindowIndexes(
  beats: readonly number[],
  rhythm: ShapeRhythm,
): number[] {
  const limit = motifBeatLimit(rhythm);
  return beats.flatMap((beat, index) => (beat < limit ? [index] : []));
}

/** Indexes inside the window that carry the motif rhythm. Length stays 3–5. */
export function motifRoleIndexes(
  beats: readonly number[],
  rhythm: ShapeRhythm,
  motifRhythm: MotifRhythm,
): number[] {
  const window = motifWindowIndexes(beats, rhythm);
  if (window.length <= 5 && motifRhythm === 'even') return window;
  if (motifRhythm === 'long-short-short') return window.slice(0, 3);
  if (motifRhythm === 'short-short-long') return window.slice(-3);
  if (motifRhythm === 'pickup-into-downbeat') {
    const picked = window.filter((index) => {
      const beat = beats[index] ?? 0;
      const fraction = beat - Math.floor(beat);
      return Math.abs(fraction - 0.5) < 0.01 || Math.abs(fraction) < 0.01;
    });
    if (picked.length >= 3 && picked.length <= 5) return picked;
  }
  return window.slice(0, Math.min(5, window.length));
}

type DegreeNote = { beat: number; degree: string };

export function motifRecurs(
  notes: readonly DegreeNote[],
  rhythm: ShapeRhythm,
  bars: 2 | 4,
): boolean {
  const limit = motifBeatLimit(rhythm);
  const motif = windowDegrees(notes, 0, limit);
  if (motif.length < 3) return false;
  const pattern = degreeDeltas(motif);
  for (let bar = 1; bar < bars; bar++) {
    const later = windowDegrees(notes, bar, limit);
    if (later.length !== motif.length) continue;
    const deltas = degreeDeltas(later);
    if (deltas.join(',') === pattern.join(',')) return true;
  }
  return false;
}

function windowDegrees(
  notes: readonly DegreeNote[],
  bar: number,
  limit: number,
): number[] {
  return notes
    .filter((note) => note.beat >= bar * 4 && note.beat < bar * 4 + limit)
    .map((note) => scaleDegreeNumber(note.degree))
    .filter((degree): degree is number => degree !== null);
}

function degreeDeltas(degrees: readonly number[]): number[] {
  return degrees
    .slice(1)
    .map((degree, index) => degree - (degrees[index] ?? degree));
}

/**
 * Downbeat and beat 3. The same beat test as `isStrongBeat` in lib/phrase.ts.
 * Question placement uses it only to choose a weak attack.
 */
function questionAttackIsStrong(beat: number): boolean {
  const within = ((beat % 4) + 4) % 4;
  const half = Math.round(within * 2) / 2;
  return half === 0 || half === 2;
}

/**
 * Index of the note that carries the question, or -1.
 * The last note of the question bar wins when it is the question degree.
 * Otherwise the latest weak attack in the bar that is the degree carries it.
 * A strong attack earlier in the bar does not.
 */
export function questionSlot(
  notes: readonly DegreeNote[],
  shape: PhraseShapePlan,
): number {
  const start = (shape.question.bar - 1) * 4;
  const end = shape.question.bar * 4;
  const wanted = Number(shape.question.degree);
  const inBar: number[] = [];
  notes.forEach((note, index) => {
    if (note.beat >= start && note.beat < end) inBar.push(index);
  });
  if (!inBar.length) return -1;
  const last = inBar[inBar.length - 1];
  if (
    last !== undefined &&
    scaleDegreeNumber(notes[last]?.degree ?? '') === wanted
  )
    return last;
  for (let cursor = inBar.length - 1; cursor >= 0; cursor--) {
    const index = inBar[cursor];
    if (index === undefined) continue;
    const note = notes[index];
    if (!note || questionAttackIsStrong(note.beat)) continue;
    if (scaleDegreeNumber(note.degree) === wanted) return index;
  }
  return -1;
}

export function questionHits(
  notes: readonly DegreeNote[],
  shape: PhraseShapePlan,
): boolean {
  return questionSlot(notes, shape) >= 0;
}

/** Bar 3's degrees differ from bar 1. Only meaningful for 4-bar phrases. */
export function barThreeTwists(notes: readonly DegreeNote[]): boolean {
  const barDegrees = (bar: number) =>
    notes
      .filter((note) => note.beat >= bar * 4 && note.beat < (bar + 1) * 4)
      .map((note) => note.degree)
      .join(',');
  const first = barDegrees(0);
  const third = barDegrees(2);
  return first.length > 0 && third.length > 0 && first !== third;
}
