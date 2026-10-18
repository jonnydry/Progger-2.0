/**
 * Server-only phrase planner. The browser never sees TYPESAFE_API_KEY.
 * This file does not log, echo, or return the key or the request headers.
 * With no key it returns 503 and does not call TypeSafe.
 */

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

const MOTIF_CONTOURS = [
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

const MOTIF_RHYTHMS = [
  'even',
  'long-short-short',
  'short-short-long',
  'pickup-into-downbeat',
] as const satisfies readonly MotifRhythm[];

const BAR_VARIATIONS = [
  'repeat',
  'sequence-up',
  'sequence-down',
  'altered-ending',
] as const satisfies readonly BarVariation[];

const QUESTION_DEGREES = [
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
const WINDOW_MS = 60_000;
const LIMIT = 30;

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

type Hits = { at: number }[];

const hits = new Map<string, Hits>();
const cache = new Map<string, PhrasePlanDistributions>();

export function resetPhrasePlanStateForTests(): void {
  hits.clear();
  cache.clear();
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

function allow(ip: string, now: number): boolean {
  const recent = (hits.get(ip) ?? []).filter((hit) => now - hit.at < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push({ at: now });
  hits.set(ip, recent);
  return true;
}

const CHORD =
  /^[A-G](?:#|b)?(?:maj7|maj9|m7b5|m7|m9|dim7|dim|aug|sus2|sus4|add9|6|7|9|m)?$/;

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
  if (!probabilities || typeof probabilities !== 'object') return null;
  const source = probabilities as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const id of menu) {
    const value = source[id];
    out[id] = typeof value === 'number' && value >= 0 ? value : 0;
  }
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

export type PhrasePlanDeps = {
  fetch: FetchLike;
  env: { TYPESAFE_API_KEY?: string };
  now: () => number;
  random: () => number;
  ip: string;
};

function clientIp(
  headers: Record<string, string | string[] | undefined> | undefined,
): string {
  const forwarded = headers?.['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const hop = raw?.split(',')[0]?.trim();
  return hop || 'local';
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
  const key = env.TYPESAFE_API_KEY;
  if (!key) {
    response.status(503).json({ error: 'planner-unavailable' });
    return;
  }
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method' });
    return;
  }
  const parsed = parsePhrasePlanRequest(request.body);
  if (!parsed) {
    response.status(400).json({ error: 'bad-request' });
    return;
  }
  const ip = deps?.ip ?? clientIp(request.headers);
  const now = deps?.now ?? Date.now;
  if (!allow(ip, now())) {
    response.status(429).json({ error: 'rate-limit' });
    return;
  }
  const keyForContext = contextKey(parsed);
  const cached = cache.get(keyForContext);
  if (cached) {
    response.status(200).json({ model: MODEL, distributions: cached });
    return;
  }
  const random = deps?.random ?? cryptoRandom;
  const fetchImpl = deps?.fetch ?? (globalThis.fetch as FetchLike);
  let payload: unknown;
  try {
    const result = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        state: stateFor(parsed),
        questions: phrasePlanQuestions(parsed, random),
      }),
    });
    if (!result.ok) {
      response.status(503).json({ error: 'planner-unavailable' });
      return;
    }
    payload = await result.json();
  } catch {
    response.status(503).json({ error: 'planner-unavailable' });
    return;
  }
  const answers =
    payload && typeof payload === 'object'
      ? (payload as { answers?: unknown }).answers
      : undefined;
  const distributions = distributionsFromAnswers(parsed, answers);
  if (!distributions) {
    response.status(503).json({ error: 'planner-unavailable' });
    return;
  }
  cache.set(keyForContext, distributions);
  response.status(200).json({ model: MODEL, distributions });
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
