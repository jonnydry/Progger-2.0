import assert from 'node:assert/strict';
import { test } from 'node:test';
import pg from 'pg';
import {
  PHRASE_PLAN_DB_TIMEOUT_MS,
  phrasePlanCountExcess,
  phrasePlanReconcile,
  phrasePlanReleaseStaleIps,
  phrasePlanReserve,
  type PhrasePlanReserveResult,
  type PhrasePlanSql,
} from '../api/phrase-plan.ts';

function redact(error: unknown): Error {
  const message = error instanceof Error ? error.message : 'postgres_unavailable';
  return new Error(message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgres://redacted'));
}

function pgSql(pool: pg.Pool): PhrasePlanSql {
  return async (strings, ...values) => {
    let text = '';
    strings.forEach((part, index) => {
      text += part;
      if (index < values.length) text += `$${index + 1}`;
    });
    try {
      const result = await pool.query(text, values as unknown[]);
      return result.rows as Record<string, unknown>[];
    } catch (error) {
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? (error as { code?: unknown }).code
          : undefined;
      if (code === '40P01' || code === '40001') throw error;
      throw redact(error);
    }
  };
}

function succeeded(result: PhrasePlanReserveResult): boolean {
  if (result.status !== 'ok') return false;
  const row = result.rows[0];
  return row?.calls != null && row.tokens != null;
}

function callsWithoutTokens(result: PhrasePlanReserveResult): boolean {
  if (result.status !== 'ok') return false;
  const row = result.rows[0];
  return row?.calls != null && row.tokens == null;
}

const day = '2026-10-21';
const month = '2026-10';

void test('postgres phrase plan gate', async (t) => {
  const url = process.env.PG_TEST_URL;
  if (!url) {
    if (process.env.CI) throw new Error('PG_TEST_URL is unset in CI');
    t.skip('PG_TEST_URL is unset');
    return;
  }
  // The route budget is 1200 ms. These races share one spend row, so on
  // the CI container the later calls wait longer than that. A wider
  // budget lets the test see the reservation. A deadlock stays a deadlock.
  const raceBudget = { budgetMs: 60_000 };
  const pool = new pg.Pool({
    connectionString: url,
    max: 320,
    statement_timeout: 120_000,
  });
  t.after(() => pool.end());
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    throw redact(error);
  }
  await pool.query('DROP TABLE IF EXISTS jev_ip, jev_spend');
  await pool.query(`
    CREATE TABLE jev_spend (
      month text PRIMARY KEY,
      tokens bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE jev_ip (
      day date NOT NULL,
      ip_hash text NOT NULL,
      calls int NOT NULL DEFAULT 0,
      PRIMARY KEY (day, ip_hash)
    );
  `);
  const sql = pgSql(pool);

  async function reset(): Promise<void> {
    await pool.query('TRUNCATE jev_ip, jev_spend');
  }

  async function stored(): Promise<{ calls: number; tokens: number; ips: number; stale: number }> {
    const result = await pool.query(`
      SELECT
        (SELECT COALESCE(sum(calls), 0) FROM jev_ip WHERE day = DATE '2026-10-21') AS calls,
        (SELECT tokens FROM jev_spend WHERE month = '2026-10') AS tokens,
        (SELECT count(*) FROM jev_ip WHERE day = DATE '2026-10-21') AS ips,
        (SELECT count(*) FROM jev_ip WHERE day < DATE '2026-10-21') AS stale
    `);
    const row = result.rows[0] as {
      calls: string;
      tokens: string | null;
      ips: string;
      stale: string;
    };
    return {
      calls: Number(row.calls),
      tokens: row.tokens == null ? 0 : Number(row.tokens),
      ips: Number(row.ips),
      stale: Number(row.stale),
    };
  }

  async function race(
    count: number,
    call: (index: number) => Promise<PhrasePlanReserveResult>,
  ): Promise<PhrasePlanReserveResult[]> {
    return Promise.all(Array.from({ length: count }, (_, index) => call(index)));
  }

  function tally(label: string, results: PhrasePlanReserveResult[]): void {
    const deadlocks = results.filter((result) => result.status === 'deadlock').length;
    const downs = results.filter((result) => result.status === 'down').length;
    const retries = results.reduce((sum, result) => sum + result.attempts - 1, 0);
    const orphan = results.filter(callsWithoutTokens).length;
    console.log(JSON.stringify({ label, deadlocks, downs, retries, orphan, ok: results.filter(succeeded).length }));
    assert.equal(deadlocks, 0, label);
    assert.equal(downs, 0, label);
    assert.equal(orphan, 0, label);
  }

  await t.test('a refused month does not move the IP counter', async () => {
    await reset();
    await pool.query(`INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 1000)`);
    await pool.query(
      `INSERT INTO jev_ip (day, ip_hash, calls) VALUES ('2026-10-21', 'h1', 5)`,
    );
    const refused = await phrasePlanReserve(sql, {
      day,
      hash: 'h1',
      month,
      reservation: 100,
      limit: 200,
      cap: 1000,
    });
    assert.equal(refused.status, 'ok');
    if (refused.status !== 'ok') return;
    assert.equal(refused.rows[0]?.ip_ok, true);
    assert.equal(refused.rows[0]?.spend_ok, false);
    assert.equal(refused.rows[0]?.calls, null);
    assert.equal((await stored()).calls, 5);
    assert.equal((await stored()).tokens, 1000);
  });

  await t.test('300 parallel gates with no IP rows yet', async () => {
    await reset();
    const results = await race(300, (index) =>
      phrasePlanReserve(sql, {
        day,
        hash: `ip-${index}`,
        month,
        reservation: 100,
        limit: 200,
        cap: 1_000_000_000,
      }, raceBudget),
    );
    tally('a-300-new', results);
    assert.equal(results.filter(succeeded).length, 300);
    const after = await stored();
    assert.equal(after.calls, 300);
    assert.equal(after.tokens, 30_000);
    assert.equal(after.ips, 300);
  });

  await t.test('200 parallel gates with stale IP rows and an empty month', async () => {
    await reset();
    const values: string[] = [];
    for (let index = 0; index < 400; index += 1) {
      values.push(`('2026-10-20', 'stale-${index}', 3)`);
    }
    await pool.query(`INSERT INTO jev_ip (day, ip_hash, calls) VALUES ${values.join(',')}`);
    const results = await race(200, (index) =>
      phrasePlanReserve(sql, {
        day,
        hash: `fresh-${index}`,
        month,
        reservation: 100,
        limit: 200,
        cap: 1_000_000_000,
      }, raceBudget),
    );
    tally('b-200-stale-empty', results);
    assert.equal(results.filter(succeeded).length, 200);
    const after = await stored();
    assert.equal(after.calls, 200);
    assert.equal(after.tokens, 20_000);
    assert.equal(after.ips, 200);
    assert.equal(after.stale, 400);
    await phrasePlanReleaseStaleIps(sql, day);
    assert.equal((await stored()).stale, 0);
    assert.equal((await stored()).ips, 200);
  });

  await t.test('a near-cap race lets exactly K reservations through', async () => {
    await reset();
    const reservation = 100;
    const cap = 1_000;
    const results = await race(40, (index) =>
      phrasePlanReserve(sql, {
        day,
        hash: `cap-${index}`,
        month,
        reservation,
        limit: 200,
        cap,
      }, raceBudget),
    );
    tally('c-near-cap', results);
    const wins = results.filter(succeeded);
    assert.equal(wins.length, cap / reservation);
    for (const win of wins) {
      if (win.status !== 'ok') continue;
      assert.ok(Number(win.rows[0]?.tokens) <= cap);
    }
    const after = await stored();
    assert.equal(after.tokens, cap);
    assert.equal(after.calls, cap / reservation);
    assert.equal(after.ips, cap / reservation);
  });

  await t.test('20 parallel gates on an IP at 199 let exactly one through', async () => {
    await reset();
    await pool.query(`INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 0)`);
    await pool.query(
      `INSERT INTO jev_ip (day, ip_hash, calls) VALUES ('2026-10-21', 'same', 199)`,
    );
    const results = await race(20, () =>
      phrasePlanReserve(sql, {
        day,
        hash: 'same',
        month,
        reservation: 100,
        limit: 200,
        cap: 1_000_000,
      }, raceBudget),
    );
    tally('d-ip-199', results);
    assert.equal(results.filter(succeeded).length, 1);
    const after = await stored();
    assert.equal(after.calls, 200);
    assert.equal(after.tokens, 100);
    assert.equal(after.ips, 1);
  });

  await t.test('concurrent reserve-then-reconcile ends at the billed sum', async () => {
    await reset();
    const reservation = 100;
    const cap = 1_000_000;
    const bills = Array.from({ length: 20 }, (_, index) => index);
    await Promise.all(
      bills.map(async (billed, index) => {
        const reserved = await phrasePlanReserve(sql, {
          day,
          hash: `bill-${index}`,
          month,
          reservation,
          limit: 200,
          cap,
        }, raceBudget);
        assert.equal(reserved.status, 'ok');
        await phrasePlanReconcile(sql, {
          month,
          unused: reservation - billed,
          billed,
          cap,
        });
      }),
    );
    const after = await stored();
    const billedSum = bills.reduce((sum, billed) => sum + billed, 0);
    assert.equal(after.tokens, billedSum);
    assert.equal(after.calls, bills.length);
    console.log(JSON.stringify({ label: 'reconcile', tokens: after.tokens, billedSum, calls: after.calls }));
  });

  await t.test('usage above the reservation adds the excess up to the cap', async () => {
    await reset();
    const reserved = await phrasePlanReserve(sql, {
      day,
      hash: 'excess',
      month,
      reservation: 100,
      limit: 200,
      cap: 150,
    }, raceBudget);
    assert.equal(reserved.status, 'ok');
    await phrasePlanCountExcess(sql, { month, excess: 80, cap: 150 });
    assert.equal((await stored()).tokens, 150);
    assert.equal((await stored()).calls, 1);
  });

  await t.test('excess does not lower a month already above the cap', async () => {
    await reset();
    await pool.query(`INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 200)`);
    await phrasePlanCountExcess(sql, { month, excess: 80, cap: 150 });
    assert.equal((await stored()).tokens, 200);
    assert.equal((await stored()).calls, 0);
  });

  await t.test('reconcile does not pull a month already above the cap down to the cap', async () => {
    await reset();
    await pool.query(`INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 200)`);
    await phrasePlanReconcile(sql, { month, unused: 10, billed: 40, cap: 150 });
    assert.equal((await stored()).tokens, 190);
  });

  await t.test('300 callers on one new IP at the 1200 ms budget stop at the IP limit', async () => {
    await reset();
    assert.equal(PHRASE_PLAN_DB_TIMEOUT_MS, 1_200);
    const reservation = 100;
    const limit = 200;
    await pool.query(`INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 0)`);
    const gateTexts: string[] = [];
    const watching: PhrasePlanSql = async (strings, ...values) => {
      const text = strings.join('');
      if (text.includes('INSERT INTO jev_ip')) gateTexts.push(text);
      return sql(strings, ...values);
    };
    const results = await race(300, () =>
      phrasePlanReserve(watching, {
        day,
        hash: 'one-new',
        month,
        reservation,
        limit,
        cap: 1_000_000_000,
      }, { budgetMs: PHRASE_PLAN_DB_TIMEOUT_MS }),
    );
    const deadlocks = results.filter((result) => result.status === 'deadlock').length;
    const downs = results.filter((result) => result.status === 'down').length;
    const retries = results.reduce((sum, result) => sum + result.attempts - 1, 0);
    const orphan = results.filter(callsWithoutTokens).length;
    const ok = results.filter(succeeded).length;
    const ipRefused = results.filter((result) => {
      if (result.status !== 'ok') return false;
      const row = result.rows[0];
      return row?.ip_ok === false && row.spend_ok === true && row.calls == null && row.tokens == null;
    }).length;
    // A new-row insert can lose the race after both flags were true.
    // That caller writes nothing, same as an IP-limit refusal.
    const lostInsert = results.filter((result) => {
      if (result.status !== 'ok') return false;
      const row = result.rows[0];
      return row?.ip_ok === true && row.spend_ok === true && row.calls == null && row.tokens == null;
    }).length;
    let after = await stored();
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const next = await stored();
      const stable = next.calls === after.calls && next.tokens === after.tokens;
      after = next;
      if (stable) break;
    }
    console.log(JSON.stringify({
      label: 'budget-1200-one-ip',
      deadlocks,
      downs,
      retries,
      orphan,
      ok,
      ipRefused,
      lostInsert,
      calls: after.calls,
      tokens: after.tokens,
    }));
    assert.equal(deadlocks, 0);
    assert.equal(downs, 0);
    assert.equal(retries, 0);
    assert.equal(orphan, 0);
    assert.equal(ok, limit);
    assert.equal(ipRefused + lostInsert, 300 - limit);
    assert.equal(after.calls, limit);
    assert.equal(after.tokens, limit * reservation);
    assert.equal(after.ips, 1);
    assert.ok(gateTexts.length > 0);
    assert.ok(gateTexts.every((text) => text.includes('AND EXISTS (SELECT 1 FROM spend_lock)')));
  });

  await t.test('200 existing IP rows at the 1200 ms budget do not deadlock or orphan', async () => {
    await reset();
    assert.equal(PHRASE_PLAN_DB_TIMEOUT_MS, 1_200);
    const reservation = 100;
    const racers = 200;
    const cap = racers * reservation;
    const hashes = Array.from({ length: 20 }, (_, index) => `held-${index}`);
    await pool.query(
      `INSERT INTO jev_ip (day, ip_hash, calls) VALUES ${hashes
        .map((hash) => `('${day}', '${hash}', 1)`)
        .join(',')}`,
    );
    const gateTexts: string[] = [];
    const watching: PhrasePlanSql = async (strings, ...values) => {
      const text = strings.join('');
      if (text.includes('INSERT INTO jev_ip')) gateTexts.push(text);
      return sql(strings, ...values);
    };
    const results = await race(racers, (index) =>
      phrasePlanReserve(watching, {
        day,
        hash: hashes[index % hashes.length],
        month,
        reservation,
        limit: 200,
        cap,
      }, { budgetMs: PHRASE_PLAN_DB_TIMEOUT_MS }),
    );
    const deadlocks = results.filter((result) => result.status === 'deadlock').length;
    const downs = results.filter((result) => result.status === 'down').length;
    const orphan = results.filter(callsWithoutTokens).length;
    const ok = results.filter(succeeded).length;
    let after = await stored();
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const next = await stored();
      const stable = next.calls === after.calls && next.tokens === after.tokens;
      after = next;
      if (stable) break;
    }
    const added = after.calls - hashes.length;
    console.log(JSON.stringify({
      label: 'budget-1200-existing',
      deadlocks,
      downs,
      orphan,
      ok,
      added,
      tokens: after.tokens,
      cap,
    }));
    assert.equal(deadlocks, 0);
    assert.equal(orphan, 0);
    assert.ok(after.tokens <= cap);
    assert.equal(after.tokens, added * reservation);
    assert.ok(added >= ok);
    assert.ok(added <= ok + downs);
    assert.ok(gateTexts.length > 0);
    assert.ok(gateTexts.every((text) => text.includes('AND EXISTS (SELECT 1 FROM spend_lock)')));
  });
});
