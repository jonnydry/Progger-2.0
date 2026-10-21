/**
 * Server-only phrase planner. The browser never sees TYPESAFE_API_KEY.
 * This file does not log, echo, or return the key, the database URL, an
 * IP address, or its hash. The key is read only after the origin, salt,
 * and address checks, and only when this request's body fits under the
 * cap. One statement locks the IP and spend rows and writes them only
 * when both still have room. Postgres will not apply two changes to
 * the same row, so a refusal does not undo an increment afterwards.
 * The Jev fetch starts only after that statement confirms both. A
 * database timeout or error does not fetch. A refund runs only when
 * the fetch never started. One process shares one in-flight plan per
 * context. Counters live in Neon.
 * db/jev-spend.sql is applied by hand and is not run from this function.
 */

import { createHmac } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { waitUntil } from '@vercel/functions';

/**
 * Menus are copied from lib/phrase-shape.ts. This file cannot import that
 * module: Vercel compiles the function to api/phrase-plan.js and then fails
 * to resolve a .ts import. A test checks the two copies still match.
 */
type MotifContour =
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

type MotifRhythm =
  | 'even'
  | 'long-short-short'
  | 'short-short-long'
  | 'pickup-into-downbeat';

type BarVariation =
  | 'repeat'
  | 'sequence-up'
  | 'sequence-down'
  | 'altered-ending';

type QuestionDegree = '2' | '4' | '6';

type ShapeRhythm = 'quarters' | 'eighths' | 'long-short' | 'push';

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

function motifRhythmsFor(rhythm: ShapeRhythm): readonly MotifRhythm[] {
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

const MODEL = 'jev-1.13.0';
const ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
/** $10 at $0.042 per million input tokens. */
const PHRASE_PLAN_BUDGET_TOKENS = 238_000_000;
/**
 * The reservation statement confirms both counters before any fetch, so
 * a billed call was reserved first and the counter cannot pass this cap.
 * Concurrency does not open a gap above it: the spend row is locked in
 * that statement, including when Fluid runs many calls in one instance.
 * 143_080_000 stays as a deliberate margin under the $10 budget. It is
 * not required to cover fetches that start before a refusal. After one
 * confirmed spend refusal, this process latches that UTC month and does
 * not start another statement. A later cold start begins with an empty
 * latch. Repeated cold starts after the month is full sit outside this
 * margin.
 *
 * A call counts as one token per UTF-8 byte of the largest upstream
 * body. That is the reservation this route already makes. The recorded
 * fixture's Jev input_tokens is 40, so the byte bound overestimates the
 * bill. The price is $0.042 per million tokens, and $10 is 238_000_000
 * in this file. The exact $10 count is 238_095_238, and this constant
 * is left for a later decision.
 *
 * Vercel Hobby and Pro scale to 30,000 concurrent executions. That
 * product with the largest body is the margin that was subtracted. The
 * burst admits 1,000 per 10 seconds per region, and this route allows
 * 200 calls per IP per UTC day. vercel.json sets no maxConcurrency.
 */
export const PHRASE_PLAN_INFLIGHT_LIMIT = 30_000;
/** Uncached planner calls one IP may make in a UTC day. */
export const PHRASE_PLAN_IP_DAILY_LIMIT = 200;
/**
 * Cold Neon HTTP on @neondatabase/serverless 1.2.0 (pooled) measured
 * 875–1019 ms for the first query after about five minutes idle. A fresh
 * process against a warm database was about 365 ms, and a warm query
 * about 76 ms. The old 200 ms cap made that first Generate always 503.
 */
export const PHRASE_PLAN_DB_TIMEOUT_MS = 1_200;
export const PHRASE_PLAN_UPSTREAM_TIMEOUT_MS = 500;
/** This process skips Jev after a database timeout, then tries again. */
export const PHRASE_PLAN_DB_DOWN_BACKOFF_MS = 30_000;
/** Musical contexts kept in memory. The oldest is dropped past this. */
export const PHRASE_PLAN_CACHE_LIMIT = 32;
const STUDIO_HOSTS = new Set(['progger.studio', 'www.progger.studio']);

const ROOTS = [
  'C',
  'C#',
  'Db',
  'D',
  'D#',
  'Eb',
  'E',
  'F',
  'F#',
  'Gb',
  'G',
  'G#',
  'Ab',
  'A',
  'A#',
  'Bb',
  'B',
] as const;

const SCALES: Record<string, string> = {
  major: 'major',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  minor: 'natural minor',
  locrian: 'Locrian',
  'major-pentatonic': 'major pentatonic',
  'minor-pentatonic': 'minor pentatonic',
  'major-blues': 'major blues',
  'minor-blues': 'minor blues',
  'harmonic-minor': 'harmonic minor',
  'locrian-natural6': 'Locrian with a natural 6th',
  'ionian-augmented': 'Ionian with a sharp 5th',
  'dorian-sharp4': 'Dorian with a sharp 4th',
  'phrygian-dominant': 'Phrygian dominant',
  'lydian-sharp2': 'Lydian with a sharp 2nd',
  ultralocrian: 'ultralocrian',
  'melodic-minor': 'jazz melodic minor',
  'dorian-b2': 'Dorian with a flat 2nd',
  'lydian-augmented': 'Lydian augmented',
  'lydian-dominant': 'Lydian dominant',
  'mixolydian-b6': 'Mixolydian with a flat 6th',
  'locrian-natural2': 'Locrian with a natural 2nd',
  altered: 'altered dominant',
  'whole-tone': 'whole tone',
  'half-whole-diminished': 'half-whole diminished',
  'whole-half-diminished': 'whole-half diminished',
};

const GRIDS: Record<ShapeRhythm, string> = {
  quarters: 'one note on each quarter-note beat',
  eighths: 'a note on every eighth',
  'long-short': 'a long note then a short note, twice in the bar',
  push: 'quarters with a few notes pushed onto the offbeat',
};

const CONTOUR_WORDS: Record<MotifContour, string> = {
  'step-up-step-up': 'Three notes stepping upward, each one scale step higher.',
  'step-down-step-down':
    'Three notes stepping downward, each one scale step lower.',
  'step-up-step-down': 'A step up, then a step back down.',
  'step-down-step-up': 'A step down, then a step back up.',
  'skip-up-step-down': 'A small skip upward, then a step back down.',
  'skip-down-step-up': 'A small skip downward, then a step back up.',
  'upper-neighbor-turn': 'Up to the neighbor just above, then back.',
  'lower-neighbor-turn': 'Down to the neighbor just below, then back.',
  'arpeggio-up': 'Climbing the chord, upward.',
  'arpeggio-down': 'Coming down the chord.',
  'repeat-then-step-up': 'The same note twice, then a step up.',
  'repeat-then-step-down': 'The same note twice, then a step down.',
};

const RHYTHM_WORDS: Record<MotifRhythm, string> = {
  even: 'The motif notes are spaced evenly on the grid.',
  'long-short-short': 'A long note followed by two short notes.',
  'short-short-long': 'Two short notes followed by a long note.',
  'pickup-into-downbeat': 'An offbeat pickup that lands on the next downbeat.',
};

const VARIATION_WORDS: Record<BarVariation, string> = {
  repeat: 'The same idea again, on the same scale degrees.',
  'sequence-up': 'The same idea, shifted one scale step higher.',
  'sequence-down': 'The same idea, shifted one scale step lower.',
  'altered-ending': 'The same idea, with the last note or two changed.',
};

const DEGREE_WORDS: Record<QuestionDegree, string> = {
  '2': 'The 2nd, which wants to fall to the root.',
  '4': 'The 4th, which wants to fall to the 3rd.',
  '6': 'The 6th, which wants to fall to the 5th.',
};

const CADENCE_WORDS = {
  root: 'The root of the chord, held as the answer.',
  third: 'The 3rd of the chord, held as the answer.',
  fifth: 'The 5th of the chord, held as the answer.',
} as const;

export type PhrasePlanRequest = {
  scaleId: string;
  root: string;
  chord: string;
  bars: 2 | 4;
  rhythm: ShapeRhythm;
};

export type PhrasePlanDistributions = {
  motifContour: Record<MotifContour, number>;
  motifRhythm: Partial<Record<MotifRhythm, number>>;
  variations: Record<BarVariation, number>[];
  questionDegree: Record<QuestionDegree, number>;
  cadence: Record<'root' | 'third' | 'fifth', number>;
};

type ChoiceQuestion = {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string>;
};

const cache = new Map<string, PhrasePlanDistributions>();
type PhrasePlanFlight = { status: number; payload: unknown };
/** One in-flight plan per context on this instance. Cross-instance duplicates each reserve. */
const inflight = new Map<string, Promise<PhrasePlanFlight>>();
let missingSaltWarned = false;
/** UTC month whose spend reservation was refused. This process stops calling Jev. */
let capRefusedMonth: string | null = null;
/** deps.now() value until which a database outage must not start another fetch. */
let skipUpstreamUntil = 0;

export function resetPhrasePlanStateForTests(): void {
  cache.clear();
  inflight.clear();
  missingSaltWarned = false;
  capRefusedMonth = null;
  skipUpstreamUntil = 0;
}

/** One warning per process. The salt value is never included. */
function warnMissingSalt(): void {
  if (missingSaltWarned) return;
  missingSaltWarned = true;
  console.warn(
    '[phrase-plan] JEV_IP_HASH_SALT missing: Jev disabled, serving rules',
  );
}

function cachedDistributions(key: string): PhrasePlanDistributions | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  cache.delete(key);
  cache.set(key, hit);
  return hit;
}

function storeDistributions(key: string, value: PhrasePlanDistributions): void {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > PHRASE_PLAN_CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function shuffleItems<T>(
  items: readonly T[],
  random: () => number,
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const next = copy[swap];
    copy[swap] = copy[index] as T;
    copy[index] = next as T;
  }
  return copy;
}

function cryptoRandom(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return (buffer[0] ?? 0) / 4294967296;
}

const CHORD =
  /^[A-G](?:#|b)?(?:maj7|maj9|m7b5|m7|m9|dim7|dim|aug|sus2|sus4|add9|6|7|9|m)?$/;

/** A string body is JSON. A parse failure is a bad request, not a 500. */
function decodeBody(body: unknown): unknown {
  if (typeof body !== 'string') return body;
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export function parsePhrasePlanRequest(
  body: unknown,
): PhrasePlanRequest | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!['scaleId', 'root', 'chord', 'bars', 'rhythm'].includes(key))
      return null;
  }
  const { scaleId, root, chord, bars, rhythm } = record;
  if (typeof scaleId !== 'string' || !Object.hasOwn(SCALES, scaleId))
    return null;
  if (
    typeof root !== 'string' ||
    !ROOTS.includes(root as (typeof ROOTS)[number])
  )
    return null;
  if (typeof chord !== 'string' || !CHORD.test(chord)) return null;
  if (bars !== 2 && bars !== 4) return null;
  if (
    rhythm !== 'quarters' &&
    rhythm !== 'eighths' &&
    rhythm !== 'long-short' &&
    rhythm !== 'push'
  ) {
    return null;
  }
  return { scaleId, root, chord, bars, rhythm };
}

function contextKey(input: PhrasePlanRequest): string {
  return `${input.scaleId}|${input.root}|${input.chord}|${input.bars}|${input.rhythm}`;
}

function criteria(
  pairs: readonly (readonly [string, string])[],
  random: () => number,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, text] of shuffleItems(pairs, random)) out[key] = text;
  return out;
}

export function phrasePlanQuestions(
  input: PhrasePlanRequest,
  random: () => number,
): Record<string, ChoiceQuestion> {
  const rhythms = motifRhythmsFor(input.rhythm);
  const questions: Record<string, ChoiceQuestion> = {
    motifContour: {
      type: 'choice',
      instructions:
        'How should the opening motif move? Pick the shape of those few notes.',
      criteria: criteria(
        MOTIF_CONTOURS.map((id) => [id, CONTOUR_WORDS[id]] as const),
        random,
      ),
    },
    motifRhythm: {
      type: 'choice',
      instructions:
        'How should those motif notes be spaced on the grid that is already chosen? Do not add or remove notes.',
      criteria: criteria(
        rhythms.map((id) => [id, RHYTHM_WORDS[id]] as const),
        random,
      ),
    },
    questionDegree: {
      type: 'choice',
      instructions:
        'Which scale degree should end the question, so the phrase wants to resolve?',
      criteria: criteria(
        QUESTION_DEGREES.map((id) => [id, DEGREE_WORDS[id]] as const),
        random,
      ),
    },
    cadence: {
      type: 'choice',
      instructions:
        'Which chord tone should the last strong beat hold, as the answer to that question?',
      criteria: criteria(
        Object.entries(CADENCE_WORDS) as ['root' | 'third' | 'fifth', string][],
        random,
      ),
    },
  };
  for (let index = 0; index < input.bars - 1; index++) {
    const bar = index + 2;
    const menu =
      input.bars === 4 && index === 1
        ? BAR_VARIATIONS.filter((item) => item !== 'repeat')
        : BAR_VARIATIONS;
    questions[`variation${bar}`] = {
      type: 'choice',
      instructions:
        bar === 3
          ? 'How should bar 3 answer the opening? It should not be a plain repeat.'
          : `How should bar ${bar} follow the opening idea?`,
      criteria: criteria(
        menu.map((id) => [id, VARIATION_WORDS[id]] as const),
        random,
      ),
    };
  }
  return questions;
}

function upstreamBody(input: PhrasePlanRequest, random: () => number): string {
  return JSON.stringify({
    model: MODEL,
    state: stateFor(input),
    questions: phrasePlanQuestions(input, random),
  });
}

/** UTF-8 bytes of the upstream body. The route reserves one token per byte. */
export function phrasePlanReservationBytes(input: PhrasePlanRequest): number {
  return Buffer.byteLength(upstreamBody(input, () => 0));
}

function maxUpstreamTokens(): number {
  let max = 0;
  const rhythms = ['quarters', 'eighths', 'long-short', 'push'] as const;
  for (const scaleId of Object.keys(SCALES)) {
    for (const root of ROOTS) {
      for (const bars of [2, 4] as const) {
        for (const rhythm of rhythms) {
          const size = phrasePlanReservationBytes({
            scaleId,
            root,
            chord: 'C#m7b5',
            bars,
            rhythm,
          });
          if (size > max) max = size;
        }
      }
    }
  }
  return max;
}

/** Largest upstream body, counted as one token per byte. */
export const PHRASE_PLAN_MAX_CALL_TOKENS = maxUpstreamTokens();
/** Platform concurrency ceiling times the per-call token ceiling. */
export const PHRASE_PLAN_TOKEN_MARGIN =
  PHRASE_PLAN_INFLIGHT_LIMIT * PHRASE_PLAN_MAX_CALL_TOKENS;
/** Budget minus the in-flight margin. The counter never passes this. */
export const PHRASE_PLAN_TOKEN_CAP =
  PHRASE_PLAN_BUDGET_TOKENS - PHRASE_PLAN_TOKEN_MARGIN;

function stateFor(input: PhrasePlanRequest): string {
  const scale = SCALES[input.scaleId] ?? input.scaleId;
  const grid = GRIDS[input.rhythm];
  return [
    `The scale is ${scale}, rooted on ${input.root}.`,
    `The chord is ${input.chord}.`,
    `The phrase is ${input.bars} bars long.`,
    `The rhythm grid is already chosen: ${grid}.`,
    'Answer only from the listed choices.',
  ].join(' ');
}

function probabilityMap(
  menu: readonly string[],
  probabilities: unknown,
): Record<string, number> | null {
  if (!probabilities || typeof probabilities !== 'object' || Array.isArray(probabilities))
    return null;
  const source = probabilities as Record<string, unknown>;
  const out: Record<string, number> = {};
  let total = 0;
  for (const id of menu) {
    const value = source[id];
    if (value === undefined) {
      out[id] = 0;
      continue;
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
      return null;
    out[id] = value;
    total += value;
  }
  if (!Number.isFinite(total) || !(total > 0)) return null;
  return out;
}

export function distributionsFromAnswers(
  input: PhrasePlanRequest,
  answers: unknown,
): PhrasePlanDistributions | null {
  if (!answers || typeof answers !== 'object') return null;
  const record = answers as Record<string, unknown>;
  const motifContour = probabilityMap(
    MOTIF_CONTOURS,
    (record.motifContour as { probabilities?: unknown } | undefined)
      ?.probabilities,
  );
  const motifRhythm = probabilityMap(
    motifRhythmsFor(input.rhythm),
    (record.motifRhythm as { probabilities?: unknown } | undefined)
      ?.probabilities,
  );
  const questionDegree = probabilityMap(
    QUESTION_DEGREES,
    (record.questionDegree as { probabilities?: unknown } | undefined)
      ?.probabilities,
  );
  const cadence = probabilityMap(
    ['root', 'third', 'fifth'],
    (record.cadence as { probabilities?: unknown } | undefined)?.probabilities,
  );
  if (!motifContour || !motifRhythm || !questionDegree || !cadence) return null;
  const variations: Record<BarVariation, number>[] = [];
  for (let index = 0; index < input.bars - 1; index++) {
    const bar = index + 2;
    const weights = probabilityMap(
      BAR_VARIATIONS,
      (record[`variation${bar}`] as { probabilities?: unknown } | undefined)
        ?.probabilities,
    );
    if (!weights) return null;
    if (input.bars === 4 && index === 1) weights.repeat = 0;
    const variationTotal = Object.values(weights).reduce((sum, value) => sum + value, 0);
    if (!(variationTotal > 0)) return null;
    variations.push(weights as Record<BarVariation, number>);
  }
  return {
    motifContour: motifContour as Record<MotifContour, number>,
    motifRhythm: motifRhythm as Partial<Record<MotifRhythm, number>>,
    variations,
    questionDegree: questionDegree as Record<QuestionDegree, number>,
    cadence: cadence as Record<'root' | 'third' | 'fifth', number>,
  };
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

export type PhrasePlanSql = (
  strings: TemplateStringsArray,
  ...values: readonly unknown[]
) => Promise<readonly Record<string, unknown>[]>;

export type PhrasePlanDeps = {
  fetch: FetchLike;
  env: {
    TYPESAFE_API_KEY?: string;
    JEV_COUNTER_DATABASE_URL?: string;
    JEV_IP_HASH_SALT?: string;
    VERCEL_ENV?: string;
    VERCEL_URL?: string;
    VERCEL_BRANCH_URL?: string;
  };
  now: () => number;
  random: () => number;
  sql?: PhrasePlanSql;
  /** Test seam. Production uses PHRASE_PLAN_TOKEN_CAP. */
  tokenCap?: number;
  /** Keeps a reconcile running after the response. Tests replace it. */
  waitUntil?: (work: Promise<unknown>) => void;
};

type HeaderMap = Record<string, string | string[] | undefined> | undefined;

function headerHop(headers: HeaderMap, name: string): string | null {
  const value = headers?.[name];
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return null;
  const hop = raw.split(',')[0]?.trim();
  return hop ? hop : null;
}

/** First address from the platform header, then x-real-ip. */
export function phrasePlanClientIp(headers: HeaderMap): string | null {
  return (
    headerHop(headers, 'x-vercel-forwarded-for') ??
    headerHop(headers, 'x-real-ip')
  );
}

/**
 * IPv6 is hashed as its /64 so one network does not look like many clients.
 * An IPv4 address, including one written as an IPv4-mapped IPv6 address, is
 * hashed in full. A value that is not a parseable address is hashed as given.
 */
function addressKey(ip: string): string {
  const given = ip.trim();
  const wrapped = given.startsWith('[') && given.endsWith(']');
  const body = wrapped ? given.slice(1, -1) : given;
  const zone = body.indexOf('%');
  const withoutZone = zone === -1 ? body : body.slice(0, zone);
  if (!withoutZone.includes(':')) return given;
  const parsed = ipv6Prefix(withoutZone);
  return parsed ?? given;
}

/** First four hextets, or the embedded IPv4 when the address is v4-mapped. */
function ipv6Prefix(address: string): string | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const hextet = (value: number) => value.toString(16).padStart(4, '0');
  const octet = (part: string): number | null => {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const value = Number(part);
    return value <= 255 ? value : null;
  };
  const parseSide = (side: string): string[] | null => {
    if (side === '') return [];
    const groups: string[] = [];
    for (const part of side.split(':')) {
      if (part.includes('.')) {
        const nums = part.split('.');
        if (nums.length !== 4) return null;
        const bytes = nums.map(octet);
        if (bytes.some((item) => item === null)) return null;
        const high = ((bytes[0] ?? 0) << 8) | (bytes[1] ?? 0);
        const low = ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
        groups.push(hextet(high), hextet(low));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(part)) return null;
      groups.push(part.toLowerCase().padStart(4, '0'));
    }
    return groups;
  };
  const left = parseSide(halves[0] ?? '');
  const right = halves.length === 2 ? parseSide(halves[1] ?? '') : [];
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if (halves.length === 2 ? missing <= 0 : left.length !== 8) return null;
  const groups =
    halves.length === 1
      ? left
      : [...left, ...Array<string>(missing).fill('0000'), ...right];
  if (groups.length !== 8) return null;
  const asInt = (group: string | undefined) => Number.parseInt(group ?? '0', 16);
  const mapped =
    asInt(groups[0]) === 0 &&
    asInt(groups[1]) === 0 &&
    asInt(groups[2]) === 0 &&
    asInt(groups[3]) === 0 &&
    asInt(groups[4]) === 0 &&
    asInt(groups[5]) === 0xffff;
  if (mapped) {
    const high = asInt(groups[6]);
    const low = asInt(groups[7]);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return groups.slice(0, 4).join(':');
}

export function phrasePlanIpHash(ip: string, salt: string, day: string): string {
  return createHmac('sha256', salt)
    .update(day)
    .update('\0')
    .update(addressKey(ip))
    .digest('hex');
}

function devEnv(value: string | undefined): boolean {
  return value !== 'production' && value !== 'preview';
}

function deploymentOrigin(host: string | undefined): string | null {
  if (!host) return null;
  const bare = host.trim().replace(/\/$/, '');
  if (!bare || bare.includes('/') || bare.includes(' ') || bare.includes(':'))
    return null;
  return `https://${bare}`;
}

/** Studio, this deployment's exact preview hosts, and local dev. */
export function phrasePlanOriginAllowed(
  origin: string | undefined,
  vercelEnv: string | undefined,
  deployment?: { url?: string; branchUrl?: string },
): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const host = url.hostname;
  if (devEnv(vercelEnv)) {
    const local =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]';
    if (local) return url.protocol === 'http:' || url.protocol === 'https:';
  }
  if (url.protocol !== 'https:' || url.port !== '') return false;
  if (STUDIO_HOSTS.has(host)) return true;
  const branch = deploymentOrigin(deployment?.branchUrl);
  const live = deploymentOrigin(deployment?.url);
  return origin === branch || origin === live;
}

function utcMonth(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

function utcDay(now: number): string {
  const date = new Date(now);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function neonSql(url: string): PhrasePlanSql {
  const query = neon(url, {
    fetchOptions: {
      signal: AbortSignal.timeout(PHRASE_PLAN_DB_TIMEOUT_MS),
    },
  });
  return (strings, ...values) =>
    query(strings, ...values) as Promise<readonly Record<string, unknown>[]>;
}

const DB_TIMEOUT = Symbol('db_timeout');

/**
 * Neon 1.2.0 appends the connection URL, password included, to the error.
 * Log a fixed code only. Do not return, log, or rethrow the error or its
 * message.
 */
function dbLogCode(error: unknown): 'db_timeout' | 'db_error' {
  if (error === DB_TIMEOUT) return 'db_timeout';
  if (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'TimeoutError'
  ) {
    return 'db_timeout';
  }
  return 'db_error';
}

async function timedRows(
  work: Promise<readonly Record<string, unknown>[]>,
): Promise<readonly Record<string, unknown>[] | 'down'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(DB_TIMEOUT), PHRASE_PLAN_DB_TIMEOUT_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    console.warn(dbLogCode(error));
    return 'down';
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function flagOf(
  row: Record<string, unknown> | undefined,
  key: string,
): boolean {
  if (!row) return false;
  const value = row[key];
  return value === true || value === 't' || value === 'true';
}

/**
 * One round trip. The IP write is conditional on both counters having
 * room, and the spend write runs only from a returned IP row. A second
 * update of either row in this statement would not see the first.
 */
export function phrasePlanGate(
  sql: PhrasePlanSql,
  input: {
    day: string;
    hash: string;
    month: string;
    reservation: number;
    limit: number;
    cap: number;
  },
): Promise<readonly Record<string, unknown>[]> {
  const { day, hash, month, reservation, limit, cap } = input;
  return sql`
    WITH cleaned AS (
      DELETE FROM jev_ip WHERE day < CAST(${day} AS date)
    ),
    ip_state AS (
      SELECT calls
      FROM jev_ip
      WHERE day = CAST(${day} AS date)
        AND ip_hash = ${hash}
      FOR UPDATE
    ),
    spend_state AS (
      SELECT tokens
      FROM jev_spend
      WHERE month = ${month}
      FOR UPDATE
    ),
    room AS (
      SELECT
        COALESCE((SELECT calls FROM ip_state), 0) + 1 <= ${limit} AS ip_ok,
        COALESCE((SELECT tokens FROM spend_state), 0) + ${reservation} <= ${cap} AS spend_ok
    ),
    ip_try AS (
      INSERT INTO jev_ip (day, ip_hash, calls)
      SELECT CAST(${day} AS date), ${hash}, 1
      FROM room
      WHERE ip_ok AND spend_ok
      ON CONFLICT (day, ip_hash) DO UPDATE
      SET calls = jev_ip.calls + 1
      WHERE jev_ip.calls + 1 <= ${limit}
        AND EXISTS (SELECT 1 FROM room WHERE ip_ok AND spend_ok)
      RETURNING calls
    ),
    spend_try AS (
      INSERT INTO jev_spend (month, tokens, updated_at)
      SELECT ${month}, ${reservation}, now()
      FROM ip_try
      ON CONFLICT (month) DO UPDATE
      SET tokens = jev_spend.tokens + ${reservation},
          updated_at = now()
      WHERE jev_spend.tokens + ${reservation} <= ${cap}
        AND EXISTS (SELECT 1 FROM ip_try)
      RETURNING tokens
    )
    SELECT
      (SELECT calls FROM ip_try) AS calls,
      (SELECT tokens FROM spend_try) AS tokens,
      (SELECT ip_ok FROM room) AS ip_ok,
      (SELECT spend_ok FROM room) AS spend_ok
  `;
}

function countOf(
  row: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (!row) return null;
  const value = row[key];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function unavailable(response: {
  status: (code: number) => { json: (body: unknown) => void };
}): void {
  response.status(503).json({ error: 'planner-unavailable' });
}

type UpstreamCall = {
  cancel: () => void;
  done: Promise<{ ok: true; payload: unknown } | { ok: false }>;
};

function startUpstream(
  fetchImpl: FetchLike,
  key: string,
  body: string,
): UpstreamCall {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    PHRASE_PLAN_UPSTREAM_TIMEOUT_MS,
  );
  const done = (async (): Promise<
    { ok: true; payload: unknown } | { ok: false }
  > => {
    try {
      const result = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${key}`,
          'content-type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
      if (!result.ok) return { ok: false };
      return { ok: true, payload: await result.json() };
    } catch {
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  })();
  return { cancel: () => controller.abort(), done };
}

function defer(
  work: Promise<unknown>,
  wait: (task: Promise<unknown>) => void,
): void {
  const guarded = work.catch(() => undefined);
  try {
    wait(guarded);
  } catch {
    // The reconcile is already running. A platform without waitUntil
    // still finishes it when the process stays alive.
  }
}

export async function handlePhrasePlan(
  request: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  },
  response: {
    status: (code: number) => { json: (body: unknown) => void };
  },
  deps?: Partial<PhrasePlanDeps>,
): Promise<void> {
  const env = deps?.env ?? process.env;
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method' });
    return;
  }
  const origin = headerHop(request.headers, 'origin');
  if (
    !phrasePlanOriginAllowed(origin ?? undefined, env.VERCEL_ENV, {
      url: env.VERCEL_URL,
      branchUrl: env.VERCEL_BRANCH_URL,
    })
  ) {
    response.status(403).json({ error: 'forbidden' });
    return;
  }
  const parsed = parsePhrasePlanRequest(decodeBody(request.body));
  if (!parsed) {
    response.status(400).json({ error: 'bad-request' });
    return;
  }
  const salt = env.JEV_IP_HASH_SALT;
  if (!salt) {
    warnMissingSalt();
    unavailable(response);
    return;
  }
  const planSalt = salt;
  const planBody = parsed;
  const keyForContext = contextKey(planBody);
  const cached = cachedDistributions(keyForContext);
  if (cached) {
    response.status(200).json({ model: MODEL, distributions: cached });
    return;
  }
  const pending = inflight.get(keyForContext);
  if (pending) {
    const shared = await pending;
    response.status(shared.status).json(shared.payload);
    return;
  }
  let resolveFlight: (result: PhrasePlanFlight) => void = () => undefined;
  const flight = new Promise<PhrasePlanFlight>((resolve) => {
    resolveFlight = resolve;
  });
  inflight.set(keyForContext, flight);
  let replied = false;
  const sink = {
    status(code: number) {
      return {
        json(body: unknown) {
          if (replied) return;
          replied = true;
          resolveFlight({ status: code, payload: body });
          response.status(code).json(body);
        },
      };
    },
  };
  try {
    await planPhrase(sink);
  } catch {
    // A thrown database error can include the connection URL. The fixed
    // fallback below is the only response, and nothing here logs it.
  } finally {
    if (inflight.get(keyForContext) === flight) inflight.delete(keyForContext);
    if (!replied) {
      const fallback = { status: 503, payload: { error: 'planner-unavailable' } };
      replied = true;
      resolveFlight(fallback);
      response.status(fallback.status).json(fallback.payload);
    }
  }

  async function planPhrase(response: {
    status: (code: number) => { json: (body: unknown) => void };
  }): Promise<void> {
  const databaseUrl = env.JEV_COUNTER_DATABASE_URL;
  if (!databaseUrl) {
    unavailable(response);
    return;
  }
  const ip = phrasePlanClientIp(request.headers);
  if (!ip) {
    unavailable(response);
    return;
  }
  const now = deps?.now?.() ?? Date.now();
  const day = utcDay(now);
  const month = utcMonth(now);
  const hash = phrasePlanIpHash(ip, planSalt, day);
  const cap = deps?.tokenCap ?? PHRASE_PLAN_TOKEN_CAP;
  if (capRefusedMonth === month || now < skipUpstreamUntil) {
    unavailable(response);
    return;
  }
  const random = deps?.random ?? cryptoRandom;
  const bodyForJev = upstreamBody(planBody, random);
  const reservation = Buffer.byteLength(bodyForJev);
  if (reservation > cap) {
    unavailable(response);
    return;
  }
  const query = async (
    work: (sql: PhrasePlanSql) => Promise<readonly Record<string, unknown>[]>,
  ) => {
    const sql = deps?.sql ?? neonSql(databaseUrl);
    return timedRows(work(sql));
  };
  const adjust = (delta: number) => {
    if (delta === 0) return Promise.resolve();
    return query(
      (sql) => sql`
        UPDATE jev_spend
        SET tokens = LEAST(GREATEST(tokens + ${delta}, 0), ${cap}),
            updated_at = now()
        WHERE month = ${month}
      `,
    );
  };
  const schedule = (work: Promise<unknown>) => {
    defer(work, deps?.waitUntil ?? waitUntil);
  };
  const gate = await query((sql) =>
    phrasePlanGate(sql, {
      day,
      hash,
      month,
      reservation,
      limit: PHRASE_PLAN_IP_DAILY_LIMIT,
      cap,
    }),
  );
  if (gate === 'down') {
    // The statement may still commit after we stop waiting. That can
    // only leave a counter higher. This process does not fetch, and it
    // skips Jev until skipUpstreamUntil.
    skipUpstreamUntil = Math.max(
      skipUpstreamUntil,
      now + PHRASE_PLAN_DB_DOWN_BACKOFF_MS,
    );
    unavailable(response);
    return;
  }
  const calls = countOf(gate[0], 'calls');
  const reserved = countOf(gate[0], 'tokens');
  if (calls === null || reserved === null) {
    // ip_ok is false when this IP has no daily room, including an empty
    // result. spend_ok is false only when the locked spend row refused.
    // Both flags can still be true when a new-row insert loses the race:
    // nothing was reserved, so this process must not latch the month.
    if (!flagOf(gate[0], 'spend_ok') && gate[0]) capRefusedMonth = month;
    if (!flagOf(gate[0], 'ip_ok')) {
      response.status(429).json({ error: 'rate-limit' });
      return;
    }
    unavailable(response);
    return;
  }
  const key = env.TYPESAFE_API_KEY;
  if (!key) {
    unavailable(response);
    schedule(adjust(-reservation));
    return;
  }
  const fetchImpl = deps?.fetch ?? (globalThis.fetch as FetchLike);
  const upstream = startUpstream(fetchImpl, key, bodyForJev);
  const answered = await upstream.done;
  if (!answered.ok) {
    unavailable(response);
    return;
  }
  const answers =
    answered.payload && typeof answered.payload === 'object'
      ? (answered.payload as { answers?: unknown }).answers
      : undefined;
  const distributions = distributionsFromAnswers(planBody, answers);
  if (!distributions) {
    unavailable(response);
    return;
  }
  storeDistributions(keyForContext, distributions);
  response.status(200).json({ model: MODEL, distributions });
  }
}

type NodeResponse = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
};

export default function phrasePlan(
  request: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  },
  response: NodeResponse,
): Promise<void> {
  return handlePhrasePlan(request, {
    status(code: number) {
      response.statusCode = code;
      return {
        json(body: unknown) {
          response.setHeader('content-type', 'application/json; charset=utf-8');
          response.setHeader('cache-control', 'no-store');
          response.end(JSON.stringify(body));
        },
      };
    },
  });
}
