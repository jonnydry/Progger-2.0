import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  BAR_VARIATIONS,
  MOTIF_CONTOURS,
  MOTIF_RHYTHMS,
  PHRASE_PLAN_CACHE_LIMIT,
  PHRASE_PLAN_DB_DOWN_BACKOFF_MS,
  PHRASE_PLAN_DB_TIMEOUT_MS,
  PHRASE_PLAN_INFLIGHT_LIMIT,
  PHRASE_PLAN_IP_DAILY_LIMIT,
  PHRASE_PLAN_MAX_CALL_TOKENS,
  PHRASE_PLAN_TOKEN_CAP,
  PHRASE_PLAN_TOKEN_MARGIN,
  PHRASE_PLAN_UPSTREAM_TIMEOUT_MS,
  phrasePlanReservationBytes,
  QUESTION_DEGREES,
  distributionsFromAnswers,
  handlePhrasePlan,
  phrasePlanClientIp,
  phrasePlanIpHash,
  phrasePlanOriginAllowed,
  resetPhrasePlanStateForTests,
  type PhrasePlanRequest,
  type PhrasePlanSql,
} from '../api/phrase-plan.ts';
import {
  createPhrasePlanner,
  parseDistributions,
} from '../lib/phrase-planner-client.ts';
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
    JEV_IP_HASH_SALT?: string;
    VERCEL_ENV?: string;
    VERCEL_URL?: string;
    VERCEL_BRANCH_URL?: string;
  };
  sql?: PhrasePlanSql;
  fetch?: (url: string, init: { body: string; headers: Record<string, string>; signal?: AbortSignal }) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;
  tokenCap?: number;
  body?: unknown;
  method?: string;
  now?: () => number;
}) {
  const sent: { url?: string; init?: { body: string; headers: Record<string, string> } } = {};
  let keyReads = 0;
  const env = {
    VERCEL_ENV: 'production' as string | undefined,
    JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
    JEV_IP_HASH_SALT: 'test-salt' as string | undefined,
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
      now: options?.now ?? (() => Date.UTC(2026, 9, 21, 3, 4, 5)),
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
  assert.equal(route.split('console.').length - 1, 1);
  assert.match(
    route,
    /console\.warn\(\s*'\[phrase-plan\] JEV_IP_HASH_SALT missing: Jev disabled, serving rules',?\s*\)/,
  );
  assert.equal(route.includes('progger-jev-ip-v1'), false);
  assert.equal(route.includes('jonnys-projects'), false);
  assert.equal(route.includes('JEV_IP_HASH_SALT'), true);
});

void test('origin allowlist accepts the studio, this deployment’s exact hosts, and local dev only', () => {
  const deployment = {
    url: 'progger-abc123.vercel.app',
    branchUrl: 'progger-git-cursor-phrase-shape-a77ca5.vercel.app',
  };
  assert.equal(phrasePlanOriginAllowed('https://progger.studio', 'production'), true);
  assert.equal(phrasePlanOriginAllowed('https://www.progger.studio', 'production'), true);
  assert.equal(
    phrasePlanOriginAllowed(
      'https://progger-abc123.vercel.app',
      'preview',
      deployment,
    ),
    true,
  );
  assert.equal(
    phrasePlanOriginAllowed(
      'https://progger-git-cursor-phrase-shape-a77ca5.vercel.app',
      'preview',
      deployment,
    ),
    true,
  );
  assert.equal(
    phrasePlanOriginAllowed(
      'https://progger-jonnys-projects-8f4138ff.vercel.app',
      'production',
      deployment,
    ),
    false,
  );
  assert.equal(
    phrasePlanOriginAllowed(
      'https://progger-git-cursor-phrase-shape-a77ca5-jonnys-projects-8f4138ff.vercel.app',
      'preview',
      deployment,
    ),
    false,
  );
  assert.equal(
    phrasePlanOriginAllowed('https://progger-other.vercel.app', 'preview', deployment),
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
  const salt = 'test-salt';
  const day = '2026-10-21';
  const hash = phrasePlanIpHash('203.0.113.4', salt, day);
  assert.equal(
    hash,
    createHash('sha256')
      .update(salt)
      .update('\0')
      .update(day)
      .update('\0')
      .update('203.0.113.4')
      .digest('hex'),
  );
  assert.equal(hash.includes('203.0.113.4'), false);
  assert.notEqual(hash, phrasePlanIpHash('203.0.113.4', salt, '2026-10-22'));
  assert.notEqual(hash, phrasePlanIpHash('203.0.113.4', 'other-salt', day));
  const prefix = phrasePlanIpHash('2001:db8:85a3::8a2e:370:7334', salt, day);
  assert.equal(
    prefix,
    phrasePlanIpHash('2001:0db8:85a3:0000:1111:2222:3333:4444', salt, day),
  );
  assert.equal(prefix, phrasePlanIpHash('2001:DB8:85A3::1%eth0', salt, day));
  assert.notEqual(prefix, phrasePlanIpHash('2001:db8:85a3:1::1', salt, day));
  assert.equal(phrasePlanIpHash('::ffff:203.0.113.4', salt, day), hash);
  assert.equal(phrasePlanIpHash('[::ffff:203.0.113.4]', salt, day), hash);
  assert.notEqual(
    phrasePlanIpHash('not-an-ip%a', salt, day),
    phrasePlanIpHash('not-an-ip%b', salt, day),
  );
  assert.notEqual(
    phrasePlanIpHash('1:2:3:4:5:6:7::8', salt, day),
    phrasePlanIpHash('1:2:3:4:5:6:7:8', salt, day),
  );
  assert.notEqual(
    phrasePlanIpHash('::ffff:1e2.0.0.1', salt, day),
    phrasePlanIpHash('100.0.0.1', salt, day),
  );
  assert.equal(
    phrasePlanIpHash('not-an-ip', salt, day),
    createHash('sha256')
      .update(salt)
      .update('\0')
      .update(day)
      .update('\0')
      .update('not-an-ip')
      .digest('hex'),
  );
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
  const ipQuery = queries.find((query) => query.text.includes('jev_ip'));
  assert.ok(ipQuery);
  assert.match(ipQuery.text, /DELETE FROM jev_ip/);
  assert.match(ipQuery.text, /day < CAST\(\? AS date\)/);
  assert.match(ipQuery.text, /INSERT INTO jev_ip/);
  assert.match(ipQuery.text, /jev_ip\.calls \+ 1 <= \?/);
  const hash = phrasePlanIpHash('203.0.113.9', 'test-salt', '2026-10-21');
  assert.equal(ipQuery.values[0], '2026-10-21');
  assert.equal(ipQuery.values[1], '2026-10-21');
  assert.equal(ipQuery.values[2], hash);
  assert.equal(ipQuery.values[3], PHRASE_PLAN_IP_DAILY_LIMIT);
  assert.equal(ipQuery.values.includes(hash), true);
  assert.equal(ipQuery.values.includes('203.0.113.9'), false);
  assert.equal(JSON.stringify(run.result().payload).includes('test-key'), false);
});

void test('a reservation above the cap refuses before the key, and a full month discards Jev', async () => {
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
  assert.deepEqual(blocked.result().payload, { error: 'planner-unavailable' });
  assert.equal(blocked.keyReads(), 1);
  const again = harness({ sql: full.sql });
  await again.done;
  assert.equal(again.result().status, 503);
  assert.equal(again.keyReads(), 0);
  assert.equal(again.sent.url, undefined);
  assert.equal(PHRASE_PLAN_INFLIGHT_LIMIT, 30_000);
  assert.equal(
    PHRASE_PLAN_TOKEN_MARGIN,
    PHRASE_PLAN_INFLIGHT_LIMIT * PHRASE_PLAN_MAX_CALL_TOKENS,
  );
  assert.equal(PHRASE_PLAN_TOKEN_CAP + PHRASE_PLAN_TOKEN_MARGIN, 238_000_000);
  assert.ok(PHRASE_PLAN_TOKEN_CAP > 0);
  const largest = phrasePlanReservationBytes({
    scaleId: 'locrian-natural6',
    root: 'C#',
    chord: 'C#m7b5',
    bars: 4,
    rhythm: 'eighths',
  });
  assert.equal(largest, PHRASE_PLAN_MAX_CALL_TOKENS);
  const smaller = phrasePlanReservationBytes({
    scaleId: 'major',
    root: 'C',
    chord: 'C',
    bars: 2,
    rhythm: 'quarters',
  });
  assert.ok(smaller < PHRASE_PLAN_MAX_CALL_TOKENS);
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
  assert.deepEqual(broken.result().payload, { error: 'planner-unavailable' });
  resetPhrasePlanStateForTests();
  const hung = harness({
    sql: () => new Promise(() => undefined),
  });
  const started = Date.now();
  await hung.done;
  assert.equal(hung.result().status, 503);
  assert.deepEqual(hung.result().payload, { error: 'planner-unavailable' });
  const hungElapsed = Date.now() - started;
  assert.ok(hungElapsed >= 1_100, `elapsed ${hungElapsed}`);
  assert.ok(hungElapsed < 2_500, `elapsed ${hungElapsed}`);
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
  assert.match(adjust?.text ?? '', /LEAST\(GREATEST\(tokens \+ \?, 0\), \?\)/);
  assert.equal(adjust?.values[0], 40 - reservation);
  assert.equal(adjust?.values[1], PHRASE_PLAN_TOKEN_CAP);
  assert.equal(adjust?.values[2], '2026-10');
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

void test('the browser client backs off a 503 or 429 and latches a 403', async () => {
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
  assert.equal(limited.length, 1);
  const forbidden: number[] = [];
  const blocked = createPhrasePlanner({
    fetch: async () => {
      forbidden.push(1);
      return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    },
  });
  const denied = await generatePhraseWithPlanner({ ...input, planner: blocked });
  await generatePhraseWithPlanner({ ...input, seed: 8, planner: blocked });
  assert.equal(denied.ok && denied.phrase.source, 'rules');
  assert.equal(forbidden.length, 1);
});

const NON_FINITE = Number('1e999');

const PLAN_REQUEST: PhrasePlanRequest = {
  scaleId: 'major',
  root: 'C',
  chord: 'C',
  bars: 4,
  rhythm: 'quarters',
};

function weightedAnswers(value: number) {
  const probabilities = (key: string) => ({ probabilities: { [key]: value } });
  return {
    motifContour: probabilities('step-up-step-down'),
    motifRhythm: probabilities('even'),
    questionDegree: probabilities('4'),
    cadence: probabilities('third'),
    variation2: probabilities('sequence-up'),
    variation3: probabilities('sequence-down'),
    variation4: probabilities('altered-ending'),
  };
}

function acceptingSql() {
  return sqlMock((query) => {
    if (query.text.includes('jev_ip')) return [{ calls: 1 }];
    if (query.text.includes('INSERT INTO jev_spend')) return [{ tokens: '80' }];
    return [];
  });
}

void test('a cached plan is refused once the salt is gone', async () => {
  resetPhrasePlanStateForTests();
  const first = harness({ sql: acceptingSql().sql });
  await first.done;
  assert.equal(first.result().status, 200);
  let queried = false;
  const second = harness({
    env: {
      JEV_IP_HASH_SALT: undefined,
      JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
      VERCEL_ENV: 'production',
    },
    sql: () => {
      queried = true;
      return Promise.resolve([]);
    },
  });
  await second.done;
  assert.deepEqual(second.result(), {
    status: 503,
    payload: { error: 'planner-unavailable' },
  });
  assert.equal(queried, false);
  assert.equal(second.keyReads(), 0);
  assert.equal(second.sent.url, undefined);
});

void test('a missing salt skips Jev before a query or an unsalted hash', async () => {
  for (const salt of [undefined, ''] as const) {
    resetPhrasePlanStateForTests();
    let queried = false;
    const run = harness({
      env: {
        JEV_IP_HASH_SALT: salt,
        JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
        VERCEL_ENV: 'production',
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
  }
});

void test('a missing salt warns once per cold start and does not print a value', async () => {
  resetPhrasePlanStateForTests();
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args);
  };
  try {
    const env = {
      JEV_IP_HASH_SALT: undefined,
      JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
      VERCEL_ENV: 'production',
    };
    const first = harness({ env });
    await first.done;
    const second = harness({ env });
    await second.done;
    assert.equal(first.result().status, 503);
    assert.equal(second.result().status, 503);
    assert.deepEqual(first.result().payload, { error: 'planner-unavailable' });
    assert.equal(warnings.length, 1);
    assert.deepEqual(warnings[0], [
      '[phrase-plan] JEV_IP_HASH_SALT missing: Jev disabled, serving rules',
    ]);
    assert.equal(JSON.stringify(warnings[0]).includes('test-salt'), false);
  } finally {
    console.warn = original;
  }
});

void test('non-finite and all-zero menus are rejected and never cached', async () => {
  assert.equal(
    distributionsFromAnswers(PLAN_REQUEST, weightedAnswers(NON_FINITE)),
    null,
  );
  assert.equal(distributionsFromAnswers(PLAN_REQUEST, weightedAnswers(0)), null);
  const wide = distributionsFromAnswers(PLAN_REQUEST, weightedAnswers(2));
  assert.equal(wide?.motifContour['step-up-step-down'], 2);
  const repeatOnly = weightedAnswers(1);
  repeatOnly.variation3 = { probabilities: { repeat: 1 } };
  assert.equal(distributionsFromAnswers(PLAN_REQUEST, repeatOnly), null);

  for (const value of [NON_FINITE, 0]) {
    resetPhrasePlanStateForTests();
    let fetches = 0;
    const fetch = async () => {
      fetches += 1;
      return {
        ok: true,
        json: async () => ({
          answers: weightedAnswers(value),
          usage: { input_tokens: 40 },
        }),
      };
    };
    const first = harness({ sql: acceptingSql().sql, fetch });
    await first.done;
    assert.equal(first.result().status, 503);
    const second = harness({ sql: acceptingSql().sql, fetch });
    await second.done;
    assert.equal(second.result().status, 503);
    assert.equal(fetches, 2);
    assert.equal(second.keyReads(), 1);
  }
});

void test('an all-zero contour menu is rejected and not cached', async () => {
  const answers = weightedAnswers(1);
  answers.motifContour = { probabilities: { 'step-up-step-down': 0 } };
  assert.equal(distributionsFromAnswers(PLAN_REQUEST, answers), null);
  resetPhrasePlanStateForTests();
  let fetches = 0;
  const fetch = async () => {
    fetches += 1;
    return {
      ok: true,
      json: async () => ({ answers, usage: { input_tokens: 40 } }),
    };
  };
  const first = harness({ sql: acceptingSql().sql, fetch });
  await first.done;
  const second = harness({ sql: acceptingSql().sql, fetch });
  await second.done;
  assert.equal(first.result().status, 503);
  assert.equal(second.result().status, 503);
  assert.equal(fetches, 2);
});

void test('weights that sum to Infinity are rejected and not cached', async () => {
  const answers = weightedAnswers(1);
  answers.motifContour = {
    probabilities: {
      'step-up-step-down': Number.MAX_VALUE,
      'step-down-step-down': Number.MAX_VALUE,
    },
  };
  assert.equal(Number.isFinite(Number.MAX_VALUE), true);
  assert.equal(
    Number.isFinite(Number.MAX_VALUE + Number.MAX_VALUE),
    false,
  );
  assert.equal(distributionsFromAnswers(PLAN_REQUEST, answers), null);
  resetPhrasePlanStateForTests();
  let fetches = 0;
  const fetch = async () => {
    fetches += 1;
    return {
      ok: true,
      json: async () => ({ answers, usage: { input_tokens: 40 } }),
    };
  };
  const first = harness({ sql: acceptingSql().sql, fetch });
  await first.done;
  const second = harness({ sql: acceptingSql().sql, fetch });
  await second.done;
  assert.equal(first.result().status, 503);
  assert.equal(second.result().status, 503);
  assert.equal(fetches, 2);
});

void test('the browser client does not cache a non-finite or all-zero menu', async () => {
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const scaleNotes = spell('C', scale.formula);
  const menu = (value: number) => ({
    distributions: {
      motifContour: { 'step-up-step-down': value },
      motifRhythm: { even: value },
      questionDegree: { '4': value },
      cadence: { third: value },
      variations: [{ repeat: value }, { 'sequence-down': value }],
    },
  });
  assert.equal(parseDistributions(menu(NON_FINITE)), null);
  assert.equal(parseDistributions(menu(0)), null);
  assert.equal(parseDistributions(menu(2))?.motifRhythm.even, 2);
  const finite = menu(1);
  const overflow = {
    distributions: {
      ...finite.distributions,
      motifContour: {
        'step-up-step-down': Number.MAX_VALUE,
        'step-down-step-down': Number.MAX_VALUE,
      },
    },
  };
  assert.equal(parseDistributions(overflow), null);
  const input = {
    seed: 3,
    bars: 2 as const,
    scaleNotes,
    chordNotes: scaleNotes.slice(0, 3),
    scaleId: 'major',
    scaleRoot: 'C',
    chordSymbol: 'C',
    locks: { rhythm: 'quarters' as const },
  };
  for (const value of [NON_FINITE, 0]) {
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: (async () => {
        fetches += 1;
        return Object.assign(new Response(null, { status: 200 }), {
          json: async () => menu(value),
        });
      }) as typeof fetch,
    });
    const first = await generatePhraseWithPlanner({ ...input, planner });
    const second = await generatePhraseWithPlanner({ ...input, seed: 4, planner });
    assert.equal(first.ok && first.phrase.source, 'rules');
    assert.equal(second.ok && second.phrase.source, 'rules');
    assert.equal(fetches, 2);
  }
  let cachedFetches = 0;
  const caching = createPhrasePlanner({
    fetch: (async () => {
      cachedFetches += 1;
      return Object.assign(new Response(null, { status: 200 }), {
        json: async () => menu(2),
      });
    }) as typeof fetch,
  });
  await generatePhraseWithPlanner({ ...input, planner: caching });
  await generatePhraseWithPlanner({ ...input, seed: 9, planner: caching });
  assert.equal(cachedFetches, 1);
  let overflowFetches = 0;
  const overflowing = createPhrasePlanner({
    fetch: (async () => {
      overflowFetches += 1;
      return Object.assign(new Response(null, { status: 200 }), {
        json: async () => overflow,
      });
    }) as typeof fetch,
  });
  const overflowed = await generatePhraseWithPlanner({
    ...input,
    planner: overflowing,
  });
  await generatePhraseWithPlanner({
    ...input,
    seed: 5,
    planner: overflowing,
  });
  assert.equal(overflowed.ok && overflowed.phrase.source, 'rules');
  assert.equal(overflowFetches, 2);
});

void test('the 500 ms upstream timeout falls back and keeps the reservation', async () => {
  assert.equal(PHRASE_PLAN_UPSTREAM_TIMEOUT_MS, 500);
  resetPhrasePlanStateForTests();
  const { sql, queries } = acceptingSql();
  const started = Date.now();
  const run = harness({
    sql,
    fetch: (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (!signal) {
          reject(new Error('missing abort signal'));
          return;
        }
        const fail = () => reject(signal.reason ?? new Error('aborted'));
        if (signal.aborted) fail();
        else signal.addEventListener('abort', fail, { once: true });
      }),
  });
  await run.done;
  const elapsed = Date.now() - started;
  assert.equal(run.result().status, 503);
  assert.ok(elapsed >= 450, `elapsed ${elapsed}`);
  assert.ok(elapsed < 2000, `elapsed ${elapsed}`);
  assert.equal(
    queries.some((query) => query.text.includes('UPDATE jev_spend')),
    false,
  );
  let fetchedAgain = false;
  const again = harness({
    sql: acceptingSql().sql,
    fetch: async () => {
      fetchedAgain = true;
      return { ok: true, json: async () => ANSWERS };
    },
  });
  await again.done;
  assert.equal(fetchedAgain, true);
  assert.equal(again.result().status, 200);
});

void test('the server cache drops the oldest context past its bound', async () => {
  assert.equal(PHRASE_PLAN_CACHE_LIMIT, 32);
  resetPhrasePlanStateForTests();
  const roots = [
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
  ];
  let fetches = 0;
  const fetch = async () => {
    fetches += 1;
    return { ok: true, json: async () => ANSWERS };
  };
  const bodies = roots.flatMap((root) =>
    [2, 4].map((bars) => ({ ...BODY, root, bars })),
  );
  assert.equal(bodies.length, PHRASE_PLAN_CACHE_LIMIT + 2);
  for (const body of bodies) {
    const run = harness({ body, fetch, sql: acceptingSql().sql });
    await run.done;
    assert.equal(run.result().status, 200);
  }
  assert.equal(fetches, bodies.length);
  const oldest = bodies[0];
  const refreshed = bodies[2];
  const nextOldest = bodies[3];
  const hit = harness({ body: refreshed, fetch, sql: acceptingSql().sql });
  await hit.done;
  assert.equal(hit.result().status, 200);
  assert.equal(fetches, bodies.length);
  for (const scaleId of ['dorian', 'phrygian']) {
    const run = harness({
      body: { ...BODY, scaleId },
      fetch,
      sql: acceptingSql().sql,
    });
    await run.done;
    assert.equal(run.result().status, 200);
  }
  assert.equal(fetches, bodies.length + 2);
  const evicted = harness({ body: nextOldest, fetch, sql: acceptingSql().sql });
  await evicted.done;
  assert.equal(fetches, bodies.length + 3);
  const kept = harness({ body: refreshed, fetch, sql: acceptingSql().sql });
  await kept.done;
  assert.equal(fetches, bodies.length + 3);
  const first = harness({ body: oldest, fetch, sql: acceptingSql().sql });
  await first.done;
  assert.equal(fetches, bodies.length + 4);
});

void test('a cold database that answers after Jev is used when both checks pass', async () => {
  resetPhrasePlanStateForTests();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let jevAnswered = false;
  const gated: PhrasePlanSql = async (strings, ...values) => {
    await gate;
    const text = strings.join('?');
    void values;
    if (text.includes('jev_ip')) return [{ calls: 1 }];
    if (text.includes('INSERT INTO jev_spend')) return [{ tokens: 80 }];
    return [];
  };
  const run = harness({
    sql: gated,
    fetch: async () => {
      jevAnswered = true;
      return { ok: true, json: async () => ANSWERS };
    },
  });
  await Promise.resolve();
  assert.equal(jevAnswered, true);
  release();
  await run.done;
  assert.equal(run.result().status, 200);
  const payload = run.result().payload as {
    distributions?: { cadence?: { third?: number } };
  };
  assert.equal(payload.distributions?.cadence?.third, 1);
});

void test('a database timeout discards Jev and serves the rules fallback', async () => {
  assert.equal(PHRASE_PLAN_DB_TIMEOUT_MS, 1_200);
  assert.equal(PHRASE_PLAN_UPSTREAM_TIMEOUT_MS, 500);
  assert.equal(PHRASE_PLAN_DB_DOWN_BACKOFF_MS, 30_000);
  resetPhrasePlanStateForTests();
  const started = Date.UTC(2026, 9, 21, 3, 4, 5);
  let fetches = 0;
  const fetch = async () => {
    fetches += 1;
    return { ok: true, json: async () => ANSWERS };
  };
  const run = harness({
    sql: () => new Promise(() => undefined),
    fetch,
  });
  await run.done;
  assert.equal(fetches, 1);
  assert.deepEqual(run.result(), {
    status: 503,
    payload: { error: 'planner-unavailable' },
  });
  assert.equal(JSON.stringify(run.result().payload).includes('step-up-step-down'), false);
  const again = harness({
    sql: acceptingSql().sql,
    fetch,
  });
  await again.done;
  assert.equal(again.result().status, 503);
  assert.equal(fetches, 1);
  const early = harness({
    now: () => started + PHRASE_PLAN_DB_DOWN_BACKOFF_MS - 1,
    sql: acceptingSql().sql,
    fetch,
  });
  await early.done;
  assert.equal(early.result().status, 503);
  assert.equal(fetches, 1);
  const later = harness({
    now: () => started + PHRASE_PLAN_DB_DOWN_BACKOFF_MS,
    sql: acceptingSql().sql,
    fetch,
  });
  await later.done;
  assert.equal(later.result().status, 200);
  assert.equal(fetches, 2);
});

void test('a negative usage count keeps the reservation and does not zero the month', async () => {
  resetPhrasePlanStateForTests();
  let tokens = 50_000;
  let updates = 0;
  let reservation = 0;
  const sql: PhrasePlanSql = (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('jev_ip')) return Promise.resolve([{ calls: 1 }]);
    if (text.includes('INSERT INTO jev_spend')) {
      reservation = Number(values[1]);
      tokens += reservation;
      return Promise.resolve([{ tokens }]);
    }
    if (text.includes('UPDATE jev_spend')) {
      updates += 1;
      const delta = Number(values[0]);
      const limit = Number(values[1]);
      tokens = Math.min(Math.max(tokens + delta, 0), limit);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  const negative = harness({
    sql,
    fetch: async () => ({
      ok: true,
      json: async () => ({ ...ANSWERS, usage: { input_tokens: -1_000_000 } }),
    }),
  });
  await negative.done;
  assert.equal(negative.result().status, 200);
  assert.equal(updates, 0);
  assert.ok(reservation > 0);
  assert.equal(tokens, 50_000 + reservation);

  resetPhrasePlanStateForTests();
  tokens = 50_000;
  updates = 0;
  reservation = 0;
  const positive = harness({
    sql,
    fetch: async () => ({
      ok: true,
      json: async () => ({ ...ANSWERS, usage: { input_tokens: 40 } }),
    }),
  });
  await positive.done;
  assert.equal(positive.result().status, 200);
  assert.equal(updates, 1);
  assert.equal(tokens, 50_040);
});

void test('a spend refusal after Jev answers does not serve Jev or raise the counter', async () => {
  resetPhrasePlanStateForTests();
  const cap = 1_000_000;
  let tokens = cap;
  let fetches = 0;
  const sql: PhrasePlanSql = (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('jev_ip')) return Promise.resolve([{ calls: 1 }]);
    if (text.includes('INSERT INTO jev_spend')) {
      const reservation = Number(values[1]);
      if (tokens + reservation > cap) return Promise.resolve([]);
      tokens += reservation;
      return Promise.resolve([{ tokens }]);
    }
    if (text.includes('UPDATE jev_spend')) {
      const delta = Number(values[0]);
      const limit = Number(values[1]);
      tokens = Math.min(Math.max(tokens + delta, 0), limit);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  const fetch = async () => {
    fetches += 1;
    return { ok: true, json: async () => ANSWERS };
  };
  const run = harness({ sql, tokenCap: cap, fetch });
  await run.done;
  assert.equal(fetches, 1);
  assert.equal(tokens, cap);
  assert.deepEqual(run.result(), {
    status: 503,
    payload: { error: 'planner-unavailable' },
  });
  const again = harness({ sql, tokenCap: cap, fetch });
  await again.done;
  assert.equal(fetches, 1);
  assert.equal(tokens, cap);
  assert.equal(again.result().status, 503);
});

void test('a per-IP refusal in parallel discards Jev and refunds the reservation', async () => {
  resetPhrasePlanStateForTests();
  let calls = PHRASE_PLAN_IP_DAILY_LIMIT;
  let tokens = 0;
  let fetches = 0;
  const sql: PhrasePlanSql = (strings, ...values) => {
    const text = strings.join('?');
    if (text.includes('jev_ip')) {
      if (calls + 1 > PHRASE_PLAN_IP_DAILY_LIMIT) return Promise.resolve([]);
      calls += 1;
      return Promise.resolve([{ calls }]);
    }
    if (text.includes('INSERT INTO jev_spend')) {
      tokens += Number(values[1]);
      return Promise.resolve([{ tokens }]);
    }
    if (text.includes('UPDATE jev_spend')) {
      tokens += Number(values[0]);
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  const run = harness({
    sql,
    fetch: async () => {
      fetches += 1;
      return { ok: true, json: async () => ANSWERS };
    },
  });
  await run.done;
  assert.equal(fetches, 1);
  assert.equal(tokens, 0);
  assert.deepEqual(run.result(), { status: 429, payload: { error: 'rate-limit' } });
  assert.equal(JSON.stringify(run.result().payload).includes('step-up-step-down'), false);
});

void test('waitUntil reconciles the reservation after the response', async () => {
  resetPhrasePlanStateForTests();
  let status = 0;
  let payload: unknown;
  let responded = false;
  let reconciled = false;
  const background: Promise<unknown>[] = [];
  const started = Date.now();
  await handlePhrasePlan(
    {
      method: 'POST',
      body: BODY,
      headers: {
        origin: 'https://progger.studio',
        'x-vercel-forwarded-for': '203.0.113.9',
      },
    },
    {
      status(code) {
        status = code;
        return {
          json(body) {
            responded = true;
            payload = body;
          },
        };
      },
    },
    {
      env: {
        VERCEL_ENV: 'production',
        JEV_COUNTER_DATABASE_URL: 'postgres://counter.example/jev',
        JEV_IP_HASH_SALT: 'test-salt',
        TYPESAFE_API_KEY: 'test-key',
      },
      now: () => Date.UTC(2026, 9, 21, 3, 4, 5),
      random: () => 0.1,
      sql: async (strings, ...values) => {
        const text = strings.join('?');
        if (text.includes('UPDATE jev_spend')) {
          assert.equal(responded, true);
          await new Promise((resolve) => setTimeout(resolve, 400));
          reconciled = true;
          void values;
          return [];
        }
        if (text.includes('jev_ip')) return [{ calls: 1 }];
        if (text.includes('INSERT INTO jev_spend')) return [{ tokens: 80 }];
        return [];
      },
      fetch: async () => ({ ok: true, json: async () => ANSWERS }),
      waitUntil(work) {
        background.push(work);
      },
    },
  );
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assert.equal(reconciled, false);
  assert.ok(elapsed < 350, `elapsed ${elapsed}`);
  assert.equal(background.length, 1);
  await Promise.all(background);
  assert.equal(reconciled, true);
  const body = payload as { distributions?: { cadence?: { third?: number } } };
  assert.equal(body.distributions?.cadence?.third, 1);
  assert.equal(JSON.stringify(payload).includes('test-key'), false);
});
