import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  generatePhrase,
  generatePhraseWithPlanner,
  generateShapedPhrase,
  mulberry32,
  rulePlan,
  type PhrasePlanner,
} from '../lib/phrase.ts';
import {
  createPhrasePlanner,
  parseDistributions,
} from '../lib/phrase-planner-client.ts';
import {
  BAR_VARIATIONS,
  MOTIF_CONTOURS,
  QUESTION_DEGREES,
  barThreeTwists,
  motifRhythmsFor,
  questionHits,
  rollShape,
  sampleShape,
  sanitizeShape,
} from '../lib/phrase-shape.ts';
import {
  distributionsFromAnswers,
  handlePhrasePlan,
  parsePhrasePlanRequest,
  phrasePlanQuestions,
  resetPhrasePlanStateForTests,
  shuffleItems,
} from '../api/phrase-plan.ts';

function major() {
  const scale = SCALES.find((item) => item.id === 'major');
  if (!scale) throw new Error('major');
  return spell('C', scale.formula);
}

void test('rules fill a version-1 shape and keep bar 3 from repeating', () => {
  const plan = rulePlan(8, ['root', 'third', 'fifth'], undefined, 4);
  assert.equal(plan.shape?.version, 1);
  assert.equal(plan.shape?.variations.length, 3);
  assert.notEqual(plan.shape?.variations[1], 'repeat');
  assert.equal(plan.shape?.question.bar, 2);
  assert.equal(plan.shape?.peak, undefined);
  const again = rulePlan(8, ['root', 'third', 'fifth'], undefined, 4);
  assert.deepEqual(again.shape, plan.shape);
  const short = rulePlan(8, ['root', 'third'], undefined, 2);
  assert.equal(short.shape?.variations.length, 1);
  assert.equal(short.shape?.question.bar, 1);
  assert.equal(short.contour, plan.contour);
  assert.equal(short.rhythm, plan.rhythm);
  const random = mulberry32(3);
  random();
  random();
  random();
  random();
  const rolled = rollShape(random, 4, 'eighths');
  assert.notEqual(rolled.variations[1], 'repeat');
});

void test('sanitize keeps a legal shape, a typed peak, and drops a repeat on bar 3', () => {
  const plan = rulePlan(4, ['root'], undefined, 4);
  const shape = plan.shape;
  assert.ok(shape);
  const kept = sanitizeShape(
    { ...shape, peak: { bar: 3, beat: 2 }, syncopation: null },
    4,
    plan.rhythm,
  );
  assert.equal(kept?.peak?.bar, 3);
  assert.equal(kept?.syncopation, null);
  assert.equal(
    sanitizeShape(
      { ...shape, variations: ['repeat', 'repeat', 'sequence-up'] },
      4,
      plan.rhythm,
    ),
    undefined,
  );
  assert.equal(sanitizeShape({ ...shape, version: 2 }, 4), undefined);
  assert.equal(
    parsePhrasePlanRequest({
      scaleId: 'major',
      root: 'C',
      chord: 'please write a solo',
      bars: 4,
      rhythm: 'quarters',
    }),
    null,
  );
  assert.ok(
    parsePhrasePlanRequest({
      scaleId: 'dorian',
      root: 'A',
      chord: 'Am',
      bars: 4,
      rhythm: 'eighths',
    }),
  );
});

void test('the live generator stays unshaped and the shape path keeps its grid', () => {
  const scaleNotes = major();
  const chordNotes = parseChord('C').notes;
  let shaped = 0;
  for (const bars of [2, 4] as const) {
    for (let seed = 1; seed <= 12; seed++) {
      const live = generatePhrase({ seed, bars, scaleNotes, chordNotes });
      const next = generateShapedPhrase({ seed, bars, scaleNotes, chordNotes });
      assert.equal(live.ok, true);
      assert.equal(next.ok, true);
      if (!live.ok || !next.ok) continue;
      assert.equal(live.phrase.plan.shape, undefined);
      assert.deepEqual(
        live.phrase.notes.map((note) => [note.beat, note.duration]),
        next.phrase.notes.map((note) => [note.beat, note.duration]),
      );
      assert.equal(
        next.phrase.notes.some((note) => note.strong && !note.chordTone),
        false,
      );
      const shape = next.phrase.plan.shape;
      if (!shape) continue;
      shaped += 1;
      assert.equal(questionHits(next.phrase.notes, shape), true);
      assert.notEqual(shape.variations[1], 'repeat');
      if (bars === 4) assert.equal(barThreeTwists(next.phrase.notes), true);
    }
  }
  assert.ok(shaped > 0, 'every shaped plan fell back');
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const phrase = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  assert.equal(panel.includes('generateShapedPhrase'), false);
  assert.equal(panel.includes('phrase-planner-client'), false);
  assert.equal(panel.includes('/api/phrase-plan'), false);
  assert.equal(phrase.includes('fetch('), false);
});

void test('a stub planner reuses one distribution and falls back without a route', async () => {
  const scaleNotes = major();
  const chordNotes = parseChord('C').notes;
  const input = {
    seed: 5,
    bars: 4 as const,
    scaleNotes,
    chordNotes,
    scaleId: 'major',
    scaleRoot: 'C',
    chordSymbol: 'C',
    locks: { rhythm: 'quarters' as const },
  };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    const body = {
      model: 'jev-1.13.0',
      distributions: {
        motifContour: { 'step-up-step-down': 1 },
        motifRhythm: { even: 1 },
        questionDegree: { '4': 1 },
        cadence: { third: 1 },
        variations: [
          { 'sequence-up': 1 },
          { 'sequence-down': 1 },
          { 'altered-ending': 1 },
        ],
      },
    };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const planner = createPhrasePlanner({ fetch: fetchImpl });
  const first = await generatePhraseWithPlanner({ ...input, planner });
  const second = await generatePhraseWithPlanner({
    ...input,
    seed: 6,
    planner,
  });
  assert.equal(calls, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.ok(first.phrase.plan.cadence);
  const offFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'planner-unavailable' }), {
      status: 503,
    });
  const off = createPhrasePlanner({ fetch: offFetch });
  const missed = await generatePhraseWithPlanner({ ...input, planner: off });
  const missedAgain = await generatePhraseWithPlanner({
    ...input,
    seed: 9,
    planner: off,
  });
  assert.equal(missed.ok, true);
  assert.equal(missedAgain.ok, true);
  if (missed.ok) assert.equal(missed.phrase.source, 'rules');
  const parsed = parseDistributions({
    model: 'jev-1.13.0',
    distributions: {
      motifContour: { 'step-up-step-up': 0.5 },
      motifRhythm: { even: 1 },
      questionDegree: { '2': 1 },
      cadence: { root: 1 },
      variations: [{ repeat: 1 }],
    },
  });
  assert.ok(parsed);
  const hanging: PhrasePlanner = {
    propose() {
      return new Promise(() => undefined);
    },
  };
  const live = generatePhrase({ seed: 5, bars: 2, scaleNotes, chordNotes });
  const timed = await generatePhraseWithPlanner({
    seed: 5,
    bars: 2,
    scaleNotes,
    chordNotes,
    planner: hanging,
    timeoutMs: 30,
  });
  assert.deepEqual(timed, live);
});

void test('the plan route stays shut without a key and never echoes one', async () => {
  resetPhrasePlanStateForTests();
  const seen: { status: number; body: unknown }[] = [];
  const respond = () => ({
    status(code: number) {
      return {
        json(body: unknown) {
          seen.push({ status: code, body });
        },
      };
    },
  });
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  await handlePhrasePlan(
    { method: 'POST', body: { scaleId: 'major' } },
    respond(),
  );
  assert.equal(seen[0]?.status, 503);
  assert.equal(JSON.stringify(seen[0]?.body).includes('key'), false);
  process.env.TYPESAFE_API_KEY = 'test-key-not-real';
  await handlePhrasePlan(
    {
      method: 'POST',
      body: {
        scaleId: 'major',
        root: 'C',
        chord: 'C',
        bars: 4,
        rhythm: 'quarters',
        extra: 'text',
      },
    },
    respond(),
    { env: { TYPESAFE_API_KEY: 'test-key-not-real' }, ip: '203.0.113.5' },
  );
  assert.equal(seen[1]?.status, 400);
  let fetched = 0;
  const deps = {
    env: { TYPESAFE_API_KEY: 'test-key-not-real' },
    ip: '203.0.113.8',
    random: () => 0.5,
    now: () => 1_000,
    fetch: async (
      _url: string,
      init: { body: string; headers: Record<string, string> },
    ) => {
      fetched += 1;
      assert.equal(init.headers.authorization, 'Bearer test-key-not-real');
      const questions = JSON.parse(init.body).questions as Record<
        string,
        { criteria: Record<string, string> }
      >;
      assert.deepEqual(Object.keys(questions.motifRhythm.criteria).sort(), [
        'even',
      ]);
      return {
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          usage: { input_tokens: 321 },
          answers: {
            motifContour: {
              probabilities: {
                'step-down-step-up': 0.7,
                'step-up-step-up': 0.3,
              },
            },
            motifRhythm: { probabilities: { even: 1 } },
            questionDegree: { probabilities: { '2': 1 } },
            cadence: { probabilities: { fifth: 1 } },
            variation2: { probabilities: { 'sequence-up': 1 } },
            variation3: {
              probabilities: { repeat: 0.9, 'sequence-down': 0.1 },
            },
            variation4: { probabilities: { 'altered-ending': 1 } },
          },
        }),
      };
    },
  };
  await handlePhrasePlan(
    {
      method: 'POST',
      body: {
        scaleId: 'major',
        root: 'C',
        chord: 'C',
        bars: 4,
        rhythm: 'quarters',
      },
    },
    respond(),
    deps,
  );
  await handlePhrasePlan(
    {
      method: 'POST',
      body: {
        scaleId: 'major',
        root: 'C',
        chord: 'C',
        bars: 4,
        rhythm: 'quarters',
      },
    },
    respond(),
    deps,
  );
  assert.equal(fetched, 1);
  const ok = seen[2];
  assert.equal(ok?.status, 200);
  const body = ok?.body as {
    model: string;
    distributions: { variations: { repeat: number }[] };
    usage?: unknown;
  };
  assert.equal(body.model, 'jev-1.13.0');
  assert.equal(body.usage, undefined);
  assert.deepEqual(Object.keys(body).sort(), ['distributions', 'model']);
  assert.equal(body.distributions.variations[1].repeat, 0);
  assert.equal(JSON.stringify(body).includes('test-key'), false);
  for (let index = 0; index < 29; index++) {
    await handlePhrasePlan(
      {
        method: 'POST',
        body: {
          scaleId: 'major',
          root: 'C',
          chord: 'C',
          bars: 4,
          rhythm: 'quarters',
        },
      },
      respond(),
      deps,
    );
  }
  assert.equal(seen.at(-1)?.status, 429);
  const ordered = shuffleItems(['a', 'b', 'c'], () => 0);
  assert.deepEqual(ordered, ['b', 'c', 'a']);
  const questions = phrasePlanQuestions(
    { scaleId: 'major', root: 'C', chord: 'C', bars: 4, rhythm: 'quarters' },
    () => 0.1,
  );
  assert.equal(questions.variation3.criteria.repeat, undefined);
  const source = readFileSync(
    new URL('../api/phrase-plan.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('console.'), false);
  assert.equal(
    distributionsFromAnswers(
      { scaleId: 'major', root: 'C', chord: 'C', bars: 2, rhythm: 'eighths' },
      null,
    ),
    null,
  );
  if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = previous;
  resetPhrasePlanStateForTests();
});

void test('the server menus match the shape module', () => {
  for (const grid of ['quarters', 'eighths', 'long-short', 'push'] as const) {
    const questions = phrasePlanQuestions(
      { scaleId: 'major', root: 'C', chord: 'C', bars: 4, rhythm: grid },
      () => 0.2,
    );
    assert.deepEqual(
      Object.keys(questions.motifRhythm.criteria).sort(),
      [...motifRhythmsFor(grid)].sort(),
    );
    assert.deepEqual(
      Object.keys(questions.motifContour.criteria).sort(),
      [...MOTIF_CONTOURS].sort(),
    );
    assert.deepEqual(
      Object.keys(questions.questionDegree.criteria).sort(),
      [...QUESTION_DEGREES].sort(),
    );
    assert.deepEqual(
      Object.keys(questions.variation2.criteria).sort(),
      [...BAR_VARIATIONS].sort(),
    );
  }
  const source = readFileSync(
    new URL('../api/phrase-plan.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes("from '../lib/"), false);
});

void test('CI loads a hand-authored distribution fixture and never a live Jev call', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/phrase-plan-distributions.json', import.meta.url),
      'utf8',
    ),
  ) as { recordedFromJev: boolean; note: string };
  assert.equal(fixture.recordedFromJev, false);
  assert.match(fixture.note, /No call to api\.typesafe\.ai/);
  const parsed = parseDistributions(fixture);
  assert.ok(parsed);
  for (let seed = 1; seed <= 32; seed++) {
    const random = mulberry32(seed);
    const shaped = sampleShape(random, 4, 'eighths', parsed);
    assert.notEqual(shaped.variations[1], 'repeat');
    assert.equal(shaped.question.bar, 2);
  }
  const phrase = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(phrase.includes('phrase-planner-client'), false);
  assert.equal(phrase.includes('api.typesafe.ai'), false);
  assert.equal(panel.includes('createPhrasePlanner'), false);
});
