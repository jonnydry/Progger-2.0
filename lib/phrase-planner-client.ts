/**
 * Browser-side planner. One request per musical context, then one sampled
 * plan per seed. The 800 ms abort is the caller's signal from
 * generatePhraseWithPlanner. The phrase panel keeps one instance of this
 * client so the cache survives re-renders. A transient failure backs off
 * in memory and retries on a later call. A config error latches that
 * context off.
 */

import {
  sampleShape,
  type PhraseShapePlan,
  type ShapeDistributions,
  type ShapeRhythm,
} from './phrase-shape.ts';
import {
  mulberry32,
  rulePlan,
  type CadenceTarget,
  type PhrasePlan,
  type PhrasePlanner,
  type PhrasePlannerInput,
} from './phrase.ts';

export type PlannerDistributions = ShapeDistributions & {
  cadence: Partial<Record<CadenceTarget, number>>;
};

type CacheEntry = PlannerDistributions | 'off';

const CADENCES = ['root', 'third', 'fifth'] as const;
const TRANSIENT_BACKOFF_MS = 30_000;
const TRANSIENT_BACKOFF_CAP_MS = 5 * 60_000;

function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + 1,
  );
}

async function errorName(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (!isRecord(body) || typeof body.error !== 'string') return null;
    return body.error;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function weights<T extends string>(
  value: unknown,
  menu: readonly T[],
): Partial<Record<T, number>> | null {
  if (!isRecord(value)) return null;
  const out: Partial<Record<T, number>> = {};
  let total = 0;
  for (const item of menu) {
    const raw = value[item];
    if (raw === undefined) continue;
    if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return null;
    out[item] = raw;
    total += raw;
  }
  if (!Number.isFinite(total) || !(total > 0)) return null;
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

export function createPhrasePlanner(options?: {
  fetch?: typeof fetch;
  origin?: string;
}): PhrasePlanner {
  const fetchImpl = options?.fetch ?? fetch;
  const origin = options?.origin ?? '';
  const contexts = new Map<string, CacheEntry>();
  const seeds = new Map<
    string,
    PhrasePlan & { alternates: readonly PhraseShapePlan[] }
  >();
  // One clock for the whole client. A 503, a dropped connection, and the
  // daily rate limit are properties of the service, not of one chord.
  let transientFailures = 0;
  let retryAt = 0;
  const postpone = (until: number) => {
    if (until > retryAt) retryAt = until;
  };
  const noteTransient = (now: number) => {
    const delay = Math.min(
      TRANSIENT_BACKOFF_MS * 2 ** transientFailures,
      TRANSIENT_BACKOFF_CAP_MS,
    );
    transientFailures += 1;
    postpone(now + delay);
  };
  const noteSuccess = () => {
    transientFailures = 0;
    retryAt = 0;
  };
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
      let distributions = contexts.get(contextKey);
      if (distributions === 'off') return null;
      if (!distributions) {
        const scaleId = input.scaleId;
        const root = input.scaleRoot ?? input.scaleNotes[0]?.name;
        const chord = input.chordSymbol;
        if (!scaleId || !root || !chord) return null;
        if (Date.now() < retryAt) return null;
        try {
          const response = await fetchImpl(`${origin}/api/phrase-plan`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              scaleId,
              root,
              chord,
              bars: input.bars,
              rhythm: grid,
            }),
            signal: input.signal,
          });
          // 503 planner-unavailable is also what a missing salt or key
          // returns. The route does not distinguish those from a cold
          // database, so every 5xx backs off instead of latching.
          if (response.status === 429) {
            const name = await errorName(response);
            const now = Date.now();
            if (name === 'rate-limit') {
              transientFailures = 0;
              postpone(nextUtcMidnight(now));
            } else {
              postpone(now + TRANSIENT_BACKOFF_CAP_MS);
            }
            return null;
          }
          if (response.status >= 400 && response.status < 500) {
            contexts.set(contextKey, 'off');
            return null;
          }
          if (response.status >= 500) {
            noteTransient(Date.now());
            return null;
          }
          if (!response.ok) return null;
          const parsed = parseDistributions(await response.json());
          if (!parsed) return null;
          distributions = parsed;
          contexts.set(contextKey, parsed);
          noteSuccess();
        } catch {
          noteTransient(Date.now());
          return null;
        }
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
