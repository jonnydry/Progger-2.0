import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BAR_VARIATIONS,
  MOTIF_CONTOURS,
  MOTIF_RHYTHMS,
  PHRASE_PLAN_IP_DAILY_LIMIT,
  PHRASE_PLAN_TOKEN_CAP,
  QUESTION_DEGREES,
  handlePhrasePlan,
  phrasePlanClientIp,
  phrasePlanIpHash,
  phrasePlanOriginAllowed,
  resetPhrasePlanStateForTests,
  type PhrasePlanSql,
} from '../api/phrase-plan.ts';
import { createPhrasePlanner } from '../lib/phrase-planner-client.ts';
import { spell, SCALES } from '../lib/music.ts';
import { generatePhraseWithPlanner, tonicChordSymbol } from '../lib/phrase.ts';
import {
  BAR_VARIATIONS as SHAPE_VARIATIONS,
  MOTIF_CONTOURS as SHAPE_CONTOURS,
  MOTIF_RHYTHMS as SHAPE_RHYTHMS,
  QUESTION_DEGREES as SHAPE_DEGREES,
} from '../lib/phrase-shape.ts';

const BODY = {
  scaleId: 'major',
  root: 'C',
  chord: 'C',
  bars: 4,
  rhythm: 'quarters',
};

const ANSWERS = {
  answers: {
    motifContour: { probabilities: { 'step-up-step-down': 1 } },
    motifRhythm: { probabilities: { even: 1 } },
    questionDegree: { probabilities: { '4': 1 } },
    cadence: { probabilities: { third: 1 } },
    variation2: { probabilities: { 'sequence-up': 1 } },
    variation3: { probabilities: { 'sequence-down': 1 } },
    variation4: { probabilities: { 'altered-ending': 1 } },
  },
  usage: { input_tokens: 40 },
};

type Query = { text: string; values: readonly unknown[] };

function sqlMock(
  impl: (query: Query) => readonly Record<string, unknown>[],
): { sql: PhrasePlanSql; queries: Query[] } {
  const queries: Query[] = [];
  const sql: PhrasePlanSql = (strings, ...values) => {
    const query = { text: strings.join('?'), values };
    queries.push(query);
    return Promise.resolve(impl(query));
  };
  return { sql, queries };
}

function harness(options?: {
  origin?: string;
  headers?: Record<string, string>;
  env?: {
    TYPESAFE_API_KEY?: string;
    JEV_COUNTER_DATABASE_URL?: string;
    VERCEL_ENV?: string;
  };
  sql?: PhrasePlanSql;
  fetch?: (url: string, init: { body: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  tokenCap?: number;
  body?: unknown;
  method?: string;
}) {
  const sent: { url?: string; init?: { body: string; headers: Record<string, string> } } = {};
  let keyReads = 0;
  const env = {
    VERCEL_ENV: 'production' as string | undefined,
    JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
    ...options?.env,
    get TYPESAFE_API_KEY() {
      keyReads += 1;
      return options?.env && 'TYPESAFE_API_KEY' in options.env
        ? options.env.TYPESAFE_API_KEY
        : 'test-key';
    },
  };
  const headers = {
    origin: options?.origin ?? 'https://progger.studio',
    'x-vercel-forwarded-for': '203.0.113.9',
    ...options?.headers,
  };
  let status = 0;
  let payload: unknown;
  const done = handlePhrasePlan(
    { method: options?.method ?? 'POST', body: options?.body ?? BODY, headers },
    {
      status(code) {
        status = code;
        return {
          json(body) {
            payload = body;
          },
        };
      },
    },
    {
      env,
      now: () => Date.UTC(2026, 9, 21, 3, 4, 5),
      random: () => 0.1,
      sql: options?.sql,
      tokenCap: options?.tokenCap,
      fetch: async (url, init) => {
        sent.url = url;
        sent.init = init;
        if (options?.fetch) return options.fetch(url, init);
        return { ok: true, json: async () => ANSWERS };
      },
    },
  );
  return {
    done,
    sent,
    keyReads: () => keyReads,
    result: () => ({ status, payload }),
  };
}

void test('menus copied into the route still match the shape module', () => {
  assert.deepEqual(MOTIF_CONTOURS, SHAPE_CONTOURS);
  assert.deepEqual(MOTIF_RHYTHMS, SHAPE_RHYTHMS);
  assert.deepEqual(BAR_VARIATIONS, SHAPE_VARIATIONS);
  assert.deepEqual(QUESTION_DEGREES, SHAPE_DEGREES);
  const sql = readFileSync(new URL('../db/jev-spend.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS jev_spend/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS jev_ip/);
  assert.match(sql, /primary key \(day, ip_hash\)/i);
  const route = readFileSync(new URL('../api/phrase-plan.ts', import.meta.url), 'utf8');
  assert.equal(route.includes('CREATE TABLE'), false);
  assert.equal(route.includes('x-forwarded-for'), false);
  assert.equal(route.includes('console.'), false);
});

void test('origin allowlist accepts the studio, this project’s previews, and local dev only', () => {
  assert.equal(phrasePlanOriginAllowed('https://progger.studio', 'production'), true);
  assert.equal(phrasePlanOriginAllowed('https://www.progger.studio', 'production'), true);
  assert.equal(
    phrasePlanOriginAllowed(
      'https://progger-jonnys-projects-8f4138ff.vercel.app',
      'production',
    ),
    true,
  );
  assert.equal(
    phrasePlanOriginAllowed(
      'https://progger-git-cursor-phrase-shape-a77ca5-jonnys-projects-8f4138ff.vercel.app',
      'preview',
    ),
    true,
  );
  assert.equal(
    phrasePlanOriginAllowed('https://other-jonnys-projects-8f4138ff.vercel.app', 'preview'),
    false,
  );
  assert.equal(phrasePlanOriginAllowed('https://progger.vercel.app', 'preview'), false);
  assert.equal(phrasePlanOriginAllowed('http://progger.studio', 'production'), false);
  assert.equal(phrasePlanOriginAllowed('https://progger.studio:444', 'production'), false);
  assert.equal(phrasePlanOriginAllowed(undefined, 'production'), false);
  assert.equal(phrasePlanOriginAllowed('http://localhost:3000', 'production'), false);
  assert.equal(phrasePlanOriginAllowed('http://localhost:3000', 'preview'), false);
  assert.equal(phrasePlanOriginAllowed('http://127.0.0.1:5173', undefined), true);
  assert.equal(phrasePlanOriginAllowed('http://[::1]:3000', 'development'), true);
  assert.equal(phrasePlanOriginAllowed('http://localhost:3000', 'development'), true);
});

void test('the client address comes from the platform header, never the raw forwarded header', () => {
  assert.equal(
    phrasePlanClientIp({ 'x-vercel-forwarded-for': '203.0.113.4, 10.0.0.1' }),
    '203.0.113.4',
  );
  assert.equal(phrasePlanClientIp({ 'x-real-ip': '198.51.100.8' }), '198.51.100.8');
  assert.equal(
    phrasePlanClientIp({
      'x-real-ip': '198.51.100.8',
      'x-vercel-forwarded-for': '203.0.113.4',
    }),
    '203.0.113.4',
  );
  assert.equal(phrasePlanClientIp({ 'x-forwarded-for': '203.0.113.4' }), null);
  const hash = phrasePlanIpHash('203.0.113.4');
  assert.equal(
    hash,
    createHash('sha256').update('progger-jev-ip-v1').update('\0').update('203.0.113.4').digest('hex'),
  );
  assert.equal(hash.includes('203.0.113.4'), false);
});

void test('a foreign origin is rejected before the database or the key', async () => {
  resetPhrasePlanStateForTests();
  let queried = false;
  const run = harness({
    origin: 'https://evil.example',
    sql: () => {
      queried = true;
      return Promise.resolve([]);
    },
  });
  await run.done;
  assert.deepEqual(run.result(), { status: 403, payload: { error: 'forbidden' } });
  assert.equal(queried, false);
  assert.equal(run.keyReads(), 0);
  assert.equal(run.sent.url, undefined);
});

void test('a missing address fails closed before spending or reading the key', async () => {
  resetPhrasePlanStateForTests();
  let queried = false;
  const run = harness({
    headers: {
      'x-vercel-forwarded-for': '',
      'x-forwarded-for': '203.0.113.4',
    },
    sql: () => {
      queried = true;
      return Promise.resolve([]);
    },
  });
  await run.done;
  assert.deepEqual(run.result(), {
    status: 503,
    payload: { error: 'planner-unavailable' },
  });
  assert.equal(queried, false);
  assert.equal(run.keyReads(), 0);
  assert.equal(run.sent.url, undefined);
});

void test('the daily cap stores a salted hash and falls back once it is spent', async () => {
  resetPhrasePlanStateForTests();
  const { sql, queries } = sqlMock((query) => {
    if (query.text.includes('jev_ip')) return [];
    return [{ tokens: 10 }];
  });
  const run = harness({ sql });
  await run.done;
  assert.deepEqual(run.result(), { status: 429, payload: { error: 'rate-limit' } });
  assert.equal(queries.length, 1);
  assert.match(queries[0]?.text ?? '', /INSERT INTO jev_ip/);
  assert.match(queries[0]?.text ?? '', /jev_ip\.calls \+ 1 <= \?/);
  assert.equal(queries[0]?.values[1], phrasePlanIpHash('203.0.113.9'));
  assert.equal(queries[0]?.values[2], PHRASE_PLAN_IP_DAILY_LIMIT);
  assert.equal(queries[0]?.values.includes('203.0.113.9'), false);
  assert.equal(run.keyReads(), 0);
  assert.equal(run.sent.url, undefined);
});

void test('a reservation above the cap and a full month both refuse before the key is read', async () => {
  resetPhrasePlanStateForTests();
  const over = sqlMock(() => [{ calls: 1 }]);
  const tooBig = harness({ sql: over.sql, tokenCap: 1 });
  await tooBig.done;
  assert.equal(tooBig.result().status, 503);
  assert.equal(over.queries.some((query) => query.text.includes('jev_spend')), false);
  assert.equal(tooBig.keyReads(), 0);
  resetPhrasePlanStateForTests();
  const full = sqlMock((query) => (query.text.includes('jev_ip') ? [{ calls: 1 }] : []));
  const blocked = harness({ sql: full.sql });
  await blocked.done;
  assert.equal(blocked.result().status, 503);
  assert.equal(blocked.keyReads(), 0);
  assert.equal(blocked.sent.url, undefined);
  assert.equal(PHRASE_PLAN_TOKEN_CAP, 238_000_000);
});

void test('missing database config, a database error, and a hung query fail closed', async () => {
  resetPhrasePlanStateForTests();
  const missing = harness({
    env: { JEV_COUNTER_DATABASE_URL: undefined, VERCEL_ENV: 'production' },
    sql: () => Promise.resolve([{ calls: 1 }]),
  });
  await missing.done;
  assert.equal(missing.result().status, 503);
  assert.equal(missing.keyReads(), 0);
  resetPhrasePlanStateForTests();
  const broken = harness({
    sql: () => Promise.reject(new Error('down')),
  });
  await broken.done;
  assert.equal(broken.result().status, 503);
  assert.equal(broken.keyReads(), 0);
  resetPhrasePlanStateForTests();
  const hung = harness({
    sql: () => new Promise(() => undefined),
  });
  const started = Date.now();
  await hung.done;
  assert.equal(hung.result().status, 503);
  assert.equal(hung.keyReads(), 0);
  assert.ok(Date.now() - started < 1000);
});

void test('a successful call reserves, reads the key, then adjusts to the real token count', async () => {
  resetPhrasePlanStateForTests();
  const { sql, queries } = sqlMock((query) => {
    if (query.text.includes('jev_ip')) return [{ calls: 1 }];
    if (query.text.includes('INSERT INTO jev_spend')) return [{ tokens: '80' }];
    return [];
  });
  const run = harness({ sql });
  await run.done;
  const result = run.result();
  assert.equal(result.status, 200);
  assert.equal(run.keyReads(), 1);
  assert.equal(run.sent.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(run.sent.init?.headers.authorization, 'Bearer test-key');
  const body = JSON.parse(run.sent.init?.body ?? '{}') as { model?: string };
  assert.equal(body.model, 'jev-1.13.0');
  const reservation = Buffer.byteLength(run.sent.init?.body ?? '');
  const spend = queries.find((query) => query.text.includes('INSERT INTO jev_spend'));
  assert.equal(spend?.values[0], '2026-10');
  assert.equal(spend?.values[1], reservation);
  assert.equal(spend?.values.at(-1), PHRASE_PLAN_TOKEN_CAP);
  const adjust = queries.find((query) => query.text.includes('UPDATE jev_spend'));
  assert.equal(adjust?.values[0], 40 - reservation);
  const payload = result.payload as { distributions?: { cadence?: { third?: number } } };
  assert.equal(payload.distributions?.cadence?.third, 1);
  const again = harness({
    sql: () => {
      throw new Error('cache should skip the database');
    },
  });
  await again.done;
  assert.equal(again.result().status, 200);
  assert.equal(again.keyReads(), 0);
  assert.equal(again.sent.url, undefined);
});

void test('a missing key refunds the reservation and does not call upstream', async () => {
  resetPhrasePlanStateForTests();
  const { sql, queries } = sqlMock((query) => {
    if (query.text.includes('jev_ip')) return [{ calls: 1 }];
    if (query.text.includes('INSERT INTO jev_spend')) return [{ tokens: 20 }];
    return [];
  });
  const run = harness({
    sql,
    env: {
      TYPESAFE_API_KEY: undefined,
      JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
      VERCEL_ENV: 'production',
    },
  });
  await run.done;
  assert.equal(run.result().status, 503);
  assert.equal(run.sent.url, undefined);
  assert.equal(run.keyReads(), 1);
  const refund = queries.find((query) => query.text.includes('UPDATE jev_spend'));
  const reservation = queries.find((query) => query.text.includes('INSERT INTO jev_spend'));
  assert.equal(refund?.values[0], -Number(reservation?.values[1]));
});

void test('an upstream failure keeps the reservation', async () => {
  resetPhrasePlanStateForTests();
  const { sql, queries } = sqlMock((query) => {
    if (query.text.includes('jev_ip')) return [{ calls: 1 }];
    if (query.text.includes('INSERT INTO jev_spend')) return [{ tokens: 20 }];
    return [];
  });
  const run = harness({
    sql,
    fetch: async () => ({ ok: false, json: async () => ({}) }),
  });
  await run.done;
  assert.equal(run.result().status, 503);
  assert.equal(queries.some((query) => query.text.includes('UPDATE jev_spend')), false);
});

void test('the browser client treats 503 as off and 403 or 429 as a one-shot fallback', async () => {
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const scaleNotes = spell('C', scale.formula);
  assert.equal(tonicChordSymbol('C', scaleNotes), 'C');
  assert.equal(tonicChordSymbol('A', spell('A', SCALES.find((item) => item.id === 'dorian')!.formula)), 'Am');
  const calls: number[] = [];
  const planner = createPhrasePlanner({
    origin: 'https://progger.studio',
    fetch: async () => {
      calls.push(503);
      return new Response(JSON.stringify({ error: 'planner-unavailable' }), { status: 503 });
    },
  });
  const input = {
    seed: 3,
    bars: 2 as const,
    scaleNotes,
    chordNotes: scaleNotes.slice(0, 3),
    scaleId: 'major',
    scaleRoot: 'C',
    chordSymbol: 'C',
    locks: { rhythm: 'quarters' as const },
    planner,
  };
  const first = await generatePhraseWithPlanner(input);
  const second = await generatePhraseWithPlanner({ ...input, seed: 4 });
  assert.equal(first.ok && first.phrase.source, 'rules');
  assert.equal(second.ok && second.phrase.source, 'rules');
  assert.equal(calls.length, 1);
  const limited: number[] = [];
  const retry = createPhrasePlanner({
    fetch: async () => {
      limited.push(1);
      return new Response(JSON.stringify({ error: 'rate-limit' }), { status: 429 });
    },
  });
  await generatePhraseWithPlanner({ ...input, planner: retry });
  await generatePhraseWithPlanner({ ...input, seed: 8, planner: retry });
  assert.equal(limited.length, 2);
  const forbidden: number[] = [];
  const blocked = createPhrasePlanner({
    fetch: async () => {
      forbidden.push(1);
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    },
  });
  const denied = await generatePhraseWithPlanner({ ...input, planner: blocked });
  assert.equal(denied.ok && denied.phrase.source, 'rules');
  assert.equal(forbidden.length, 1);
});
