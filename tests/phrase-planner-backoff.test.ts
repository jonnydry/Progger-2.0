import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createPhrasePlanner } from '../lib/phrase-planner-client.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  generatePhrase,
  generatePhraseWithPlanner,
  PHRASE_PLANNER_CANCEL_REASON,
  PHRASE_PLANNER_TIMEOUT_MS,
  type PhrasePlanner,
} from '../lib/phrase.ts';

const PLAN = {
  distributions: {
    motifContour: { 'step-up-step-down': 1 },
    motifRhythm: { even: 1 },
    questionDegree: { '4': 1 },
    cadence: { third: 1 },
    variations: [{ 'sequence-up': 1 }],
  },
};

const scale = SCALES.find((item) => item.id === 'major');
if (!scale) throw new Error('major scale missing');
const scaleNotes = spell('C', scale.formula);
const chordNotes = scaleNotes.slice(0, 3);

function request(
  planner: PhrasePlanner,
  seed: number,
  chordSymbol = 'C',
) {
  return {
    seed,
    bars: 2 as const,
    scaleNotes,
    chordNotes,
    scaleId: 'major',
    scaleRoot: 'C',
    chordSymbol,
    locks: { rhythm: 'quarters' as const },
    planner,
  };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status });
}

void test('a 503 backs off, then a later Generate uses the planner', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: (async () => {
        fetches += 1;
        if (fetches === 1) {
          return jsonResponse({ error: 'planner-unavailable' }, 503);
        }
        return jsonResponse(PLAN, 200);
      }) as typeof fetch,
    });
    const rules = generatePhrase({
      seed: 3,
      bars: 2,
      scaleNotes,
      chordNotes,
      locks: { rhythm: 'quarters' },
    });
    const first = await generatePhraseWithPlanner(request(planner, 3));
    assert.deepEqual(first, rules);
    assert.equal(fetches, 1);
    const during = await generatePhraseWithPlanner(request(planner, 4));
    assert.equal(during.ok && during.phrase.source, 'rules');
    assert.equal(fetches, 1);
    context.mock.timers.tick(30_000 - 1);
    await generatePhraseWithPlanner(request(planner, 5));
    assert.equal(fetches, 1);
    context.mock.timers.tick(1);
    const retried = await generatePhraseWithPlanner(request(planner, 6));
    assert.equal(fetches, 2);
    assert.equal(retried.ok && retried.phrase.source, 'planner');
    assert.equal(retried.ok && retried.phrase.plan.cadence, 'third');
    assert.ok(retried.ok && retried.phrase.plan.shape);
  } finally {
    context.mock.timers.reset();
  }
});

void test('a Generate during the backoff does not call fetch', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: (async () => {
        fetches += 1;
        return jsonResponse({ error: 'planner-unavailable' }, 503);
      }) as typeof fetch,
    });
    await generatePhraseWithPlanner(request(planner, 1));
    await generatePhraseWithPlanner(request(planner, 2, 'G'));
    context.mock.timers.tick(29_999);
    await generatePhraseWithPlanner(request(planner, 3));
    assert.equal(fetches, 1);
  } finally {
    context.mock.timers.reset();
  }
});

void test('repeated 5xx grows the backoff to five minutes and a success resets it', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    const delays = [30_000, 60_000, 120_000, 240_000, 300_000, 300_000];
    const statuses = [500, 502, 503, 504, 500, 503];
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: (async (_url, init) => {
        fetches += 1;
        const raw = init?.body;
        const body = (
          typeof raw === 'string' ? JSON.parse(raw) : {}
        ) as { chord?: string };
        if (body.chord === 'G') {
          return jsonResponse({ error: 'planner-unavailable' }, 503);
        }
        const status = statuses[fetches - 1];
        if (status) return jsonResponse({ error: 'planner-unavailable' }, status);
        return jsonResponse(PLAN, 200);
      }) as typeof fetch,
    });
    let seed = 1;
    for (const delay of delays) {
      const before = fetches;
      const failed = await generatePhraseWithPlanner(request(planner, seed));
      seed += 1;
      assert.equal(failed.ok && failed.phrase.source, 'rules');
      assert.equal(fetches, before + 1);
      await generatePhraseWithPlanner(request(planner, seed));
      seed += 1;
      context.mock.timers.tick(delay - 1);
      await generatePhraseWithPlanner(request(planner, seed));
      seed += 1;
      assert.equal(fetches, before + 1);
      context.mock.timers.tick(1);
    }
    const beforePlan = fetches;
    await generatePhraseWithPlanner(request(planner, seed));
    seed += 1;
    assert.equal(fetches, beforePlan + 1);
    const planned = await generatePhraseWithPlanner(request(planner, 6));
    assert.equal(fetches, beforePlan + 1);
    assert.equal(planned.ok && planned.phrase.source, 'planner');
    assert.equal(planned.ok && planned.phrase.plan.cadence, 'third');
    const resetAt = fetches;
    const again = await generatePhraseWithPlanner(request(planner, seed, 'G'));
    seed += 1;
    assert.equal(again.ok && again.phrase.source, 'rules');
    assert.equal(fetches, resetAt + 1);
    context.mock.timers.tick(30_000 - 1);
    await generatePhraseWithPlanner(request(planner, seed, 'G'));
    assert.equal(fetches, resetAt + 1);
    context.mock.timers.tick(1);
    await generatePhraseWithPlanner(request(planner, seed + 1, 'G'));
    assert.equal(fetches, resetAt + 2);
  } finally {
    context.mock.timers.reset();
  }
});

void test('a timeout or a network error backs off like a 5xx', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: ((_url, init) => {
        fetches += 1;
        if (fetches === 1) {
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            const fail = () =>
              reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
            if (!signal) {
              fail();
              return;
            }
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          });
        }
        return Promise.resolve(jsonResponse(PLAN, 200));
      }) as typeof fetch,
    });
    const pending = generatePhraseWithPlanner(request(planner, 1));
    context.mock.timers.tick(PHRASE_PLANNER_TIMEOUT_MS - 1);
    assert.equal(fetches, 1);
    context.mock.timers.tick(1);
    const timed = await pending;
    assert.equal(timed.ok && timed.phrase.source, 'rules');
    assert.equal(fetches, 1);
    await generatePhraseWithPlanner(request(planner, 2));
    assert.equal(fetches, 1);
    context.mock.timers.tick(30_000 - 1);
    await generatePhraseWithPlanner(request(planner, 3));
    assert.equal(fetches, 1);
    context.mock.timers.tick(1);
    const recovered = await generatePhraseWithPlanner(request(planner, 4));
    assert.equal(fetches, 2);
    assert.equal(recovered.ok && recovered.phrase.source, 'planner');

    let network = 0;
    const dropped = createPhrasePlanner({
      fetch: (async () => {
        network += 1;
        if (network === 1) throw new TypeError('Failed to fetch');
        return jsonResponse(PLAN, 200);
      }) as typeof fetch,
    });
    const failed = await generatePhraseWithPlanner(request(dropped, 5));
    assert.equal(failed.ok && failed.phrase.source, 'rules');
    await generatePhraseWithPlanner(request(dropped, 6));
    assert.equal(network, 1);
    context.mock.timers.tick(30_000);
    const after = await generatePhraseWithPlanner(request(dropped, 4));
    assert.equal(network, 2);
    assert.equal(after.ok && after.phrase.source, 'planner');
  } finally {
    context.mock.timers.reset();
  }
});

void test('a panel cleanup abort does not arm the backoff', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: ((_url, init) => {
        fetches += 1;
        if (fetches === 1) {
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            const fail = () =>
              reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
            if (!signal) {
              fail();
              return;
            }
            if (signal.aborted) fail();
            else signal.addEventListener('abort', fail, { once: true });
          });
        }
        return Promise.resolve(jsonResponse(PLAN, 200));
      }) as typeof fetch,
    });
    const caller = new AbortController();
    const pending = generatePhraseWithPlanner({
      ...request(planner, 1),
      signal: caller.signal,
    });
    caller.abort(PHRASE_PLANNER_CANCEL_REASON);
    const cancelled = await pending;
    assert.equal(cancelled.ok && cancelled.phrase.source, 'rules');
    assert.equal(fetches, 1);
    const next = await generatePhraseWithPlanner(request(planner, 4));
    assert.equal(fetches, 2);
    assert.equal(next.ok && next.phrase.source, 'planner');
    const panel = readFileSync(
      new URL('../components/phrase-panel.tsx', import.meta.url),
      'utf8',
    );
    assert.match(panel, /controller\.abort\(PHRASE_PLANNER_CANCEL_REASON\)/);
  } finally {
    context.mock.timers.reset();
  }
});

void test('a config-error status latches off and never retries', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    for (const status of [400, 401, 403, 404, 405]) {
      let fetches = 0;
      const planner = createPhrasePlanner({
        fetch: (async () => {
          fetches += 1;
          return jsonResponse({ error: 'config' }, status);
        }) as typeof fetch,
      });
      const denied = await generatePhraseWithPlanner(request(planner, 1));
      assert.equal(denied.ok && denied.phrase.source, 'rules');
      context.mock.timers.tick(24 * 60 * 60 * 1000);
      await generatePhraseWithPlanner(request(planner, 2));
      assert.equal(fetches, 1, `status ${status}`);
      const other = await generatePhraseWithPlanner(request(planner, 3, 'G'));
      assert.equal(other.ok && other.phrase.source, 'rules');
      assert.equal(fetches, 2, `status ${status}`);
    }
  } finally {
    context.mock.timers.reset();
  }
});

void test('a 403 latch does not block another context, and 429 waits out its period', async (context) => {
  context.mock.timers.enable({
    apis: ['setTimeout', 'Date'],
    now: Date.UTC(2026, 9, 21, 15, 0, 0),
  });
  try {
    let fetches = 0;
    const planner = createPhrasePlanner({
      fetch: (async (_url, init) => {
        fetches += 1;
        const raw = init?.body;
        const body = (
          typeof raw === 'string' ? JSON.parse(raw) : {}
        ) as { chord?: string };
        if (body.chord === 'C') {
          return jsonResponse({ error: 'bad-request' }, 400);
        }
        return jsonResponse(PLAN, 200);
      }) as typeof fetch,
    });
    await generatePhraseWithPlanner(request(planner, 1, 'C'));
    const other = await generatePhraseWithPlanner(request(planner, 2, 'G'));
    assert.equal(other.ok && other.phrase.source, 'planner');
    assert.equal(fetches, 2);
    await generatePhraseWithPlanner(request(planner, 3, 'C'));
    assert.equal(fetches, 2);

    let limited = 0;
    const rated = createPhrasePlanner({
      fetch: (async () => {
        limited += 1;
        if (limited === 1) return jsonResponse({ error: 'rate-limit' }, 429);
        return jsonResponse(PLAN, 200);
      }) as typeof fetch,
    });
    const blocked = await generatePhraseWithPlanner(request(rated, 4));
    assert.equal(blocked.ok && blocked.phrase.source, 'rules');
    context.mock.timers.tick(9 * 60 * 60 * 1000 - 1);
    await generatePhraseWithPlanner(request(rated, 5, 'G'));
    assert.equal(limited, 1);
    context.mock.timers.tick(1);
    const nextDay = await generatePhraseWithPlanner(request(rated, 6));
    assert.equal(limited, 2);
    assert.equal(nextDay.ok && nextDay.phrase.source, 'planner');

    let unsigned = 0;
    const vague = createPhrasePlanner({
      fetch: (async () => {
        unsigned += 1;
        return jsonResponse({ error: 'slow-down' }, 429);
      }) as typeof fetch,
    });
    await generatePhraseWithPlanner(request(vague, 7));
    context.mock.timers.tick(5 * 60 * 1000 - 1);
    await generatePhraseWithPlanner(request(vague, 8));
    assert.equal(unsigned, 1);
    context.mock.timers.tick(1);
    await generatePhraseWithPlanner(request(vague, 9));
    assert.equal(unsigned, 2);
  } finally {
    context.mock.timers.reset();
  }
});
