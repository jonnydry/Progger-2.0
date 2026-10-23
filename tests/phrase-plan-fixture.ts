/**
 * Replay a recorded shape distribution. No fetch, no route, no API key.
 * The sampler matches the old planner client's draws so fixture metrics stay put.
 */

import {
  sampleShape,
  type PhraseShapePlan,
  type ShapeDistributions,
  type ShapeRhythm,
} from '../lib/phrase-shape.ts';
import {
  mulberry32,
  rulePlan,
  type CadenceTarget,
  type PhrasePlan,
  type PhrasePlanner,
  type PhrasePlannerInput,
} from '../lib/phrase.ts';

export type PlannerDistributions = ShapeDistributions & {
  cadence: Partial<Record<CadenceTarget, number>>;
};

const CADENCES = ['root', 'third', 'fifth'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function weights<T extends string>(
  value: unknown,
  menu: readonly T[],
): Partial<Record<T, number>> | null {
  if (!isRecord(value)) return null;
  const out: Partial<Record<T, number>> = {};
  for (const item of menu) {
    const raw = value[item];
    if (typeof raw === 'number' && raw >= 0) out[item] = raw;
  }
  return out;
}

export function parseDistributions(body: unknown): PlannerDistributions | null {
  if (!isRecord(body)) return null;
  const distributions = body.distributions;
  if (!isRecord(distributions)) return null;
  const motifContour = weights(distributions.motifContour, [
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
  ] as const);
  const motifRhythm = weights(distributions.motifRhythm, [
    'even',
    'long-short-short',
    'short-short-long',
    'pickup-into-downbeat',
  ] as const);
  const questionDegree = weights(distributions.questionDegree, [
    '2',
    '4',
    '6',
  ] as const);
  const cadence = weights(distributions.cadence, CADENCES);
  if (!motifContour || !motifRhythm || !questionDegree || !cadence) return null;
  if (!Array.isArray(distributions.variations)) return null;
  const variations = distributions.variations.map((entry) =>
    weights(entry, [
      'repeat',
      'sequence-up',
      'sequence-down',
      'altered-ending',
    ] as const),
  );
  if (variations.some((entry) => !entry)) return null;
  return {
    motifContour,
    motifRhythm,
    questionDegree,
    cadence,
    variations: variations as NonNullable<(typeof variations)[number]>[],
  };
}

function sampleCadence(
  random: () => number,
  weightsForCadence: Partial<Record<CadenceTarget, number>>,
  available: readonly CadenceTarget[],
): CadenceTarget {
  const menu = available.length ? available : (['root'] as const);
  let total = 0;
  for (const item of menu) total += weightsForCadence[item] ?? 0;
  if (total <= 0) return menu[Math.floor(random() * menu.length)] ?? 'root';
  let cursor = random() * total;
  for (const item of menu) {
    cursor -= weightsForCadence[item] ?? 0;
    if (cursor <= 0) return item;
  }
  return menu[menu.length - 1] ?? 'root';
}

export function samplePlannedFields(
  seed: number,
  bars: 2 | 4,
  grid: ShapeRhythm,
  distributions: PlannerDistributions,
  available: readonly CadenceTarget[],
): {
  cadence: CadenceTarget;
  shape: PhraseShapePlan;
  alternates: PhraseShapePlan[];
} {
  const random = mulberry32(seed);
  // The same seed already rolled the rules plan. Advance four draws so the
  // shape sample is not tied to contour, rhythm, register, and cadence.
  random();
  random();
  random();
  random();
  const cadence = sampleCadence(random, distributions.cadence, available);
  const shape = sampleShape(random, bars, grid, distributions);
  const alternates: PhraseShapePlan[] = [];
  for (let index = 0; index < 12; index++)
    alternates.push(sampleShape(random, bars, grid, distributions));
  return { cadence, shape, alternates };
}

function contextOf(input: PhrasePlannerInput, grid: ShapeRhythm): string {
  const scale = input.scaleId ?? input.scaleLabel ?? '';
  const root = input.scaleRoot ?? input.scaleNotes[0]?.name ?? '';
  const chord = input.chordSymbol ?? '';
  return `${scale}|${root}|${chord}|${input.bars}|${grid}`;
}

/** One parsed distribution per context, then one sampled plan per seed. */
export function recordedPhrasePlanner(
  contexts: Record<string, unknown>,
): PhrasePlanner {
  const cache = new Map<string, PlannerDistributions | 'off'>();
  const seeds = new Map<
    string,
    PhrasePlan & { alternates: readonly PhraseShapePlan[] }
  >();
  return {
    async propose(input) {
      const rules = rulePlan(
        input.seed,
        ['root', 'third', 'fifth'],
        input.locks,
        input.bars,
      );
      const grid = (input.locks?.rhythm ?? rules.rhythm) as ShapeRhythm;
      const seedKey = `${contextOf(input, grid)}|${input.seed}`;
      const saved = seeds.get(seedKey);
      if (saved) return saved;
      const contextKey = contextOf(input, grid);
      let distributions = cache.get(contextKey);
      if (distributions === 'off') return null;
      if (!distributions) {
        const found = contexts[contextKey];
        if (found === undefined) {
          cache.set(contextKey, 'off');
          return null;
        }
        const parsed = parseDistributions(found);
        if (!parsed) return null;
        distributions = parsed;
        cache.set(contextKey, parsed);
      }
      const available: CadenceTarget[] = ['root', 'third', 'fifth'];
      const sampled = samplePlannedFields(
        input.seed,
        input.bars,
        grid,
        distributions,
        available,
      );
      const plan = {
        ...rules,
        cadence: sampled.cadence,
        shape: sampled.shape,
        alternates: sampled.alternates,
      };
      seeds.set(seedKey, plan);
      return plan;
    },
  };
}
