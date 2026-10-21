import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { phrasePlanGate, type PhrasePlanSql } from '../api/phrase-plan.ts';

function quote(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^[0-9A-Za-z_.:-]+$/.test(value)) return `'${value}'`;
  throw new Error('refusing to interpolate a gate value');
}

function psql(statement: string, database = 'phrase_plan_gate_test'): string {
  return execFileSync(
    'sudo',
    [
      '-n',
      '-u',
      'postgres',
      'psql',
      '-d',
      database,
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-c',
      statement,
    ],
    { encoding: 'utf8' },
  ).trim();
}

function postgresReady(): boolean {
  try {
    psql('SELECT 1', 'postgres');
    return true;
  } catch {
    return false;
  }
}

const sql: PhrasePlanSql = async (strings, ...values) => {
  let text = '';
  strings.forEach((part, index) => {
    text += part;
    if (index < values.length) text += quote(values[index]);
  });
  const line = psql(text);
  const [calls, tokens, ipOk, spendOk] = line.split('|');
  return [
    {
      calls: calls === '' ? null : Number(calls),
      tokens: tokens === '' ? null : Number(tokens),
      ip_ok: ipOk === 't',
      spend_ok: spendOk === 't',
    },
  ];
};

void test('postgres does not move the IP counter when spend is refused', async (t) => {
  if (!postgresReady()) {
    t.skip('local postgres is not available');
    return;
  }
  psql('DROP DATABASE IF EXISTS phrase_plan_gate_test', 'postgres');
  psql('CREATE DATABASE phrase_plan_gate_test', 'postgres');
  t.after(() => {
    psql('DROP DATABASE IF EXISTS phrase_plan_gate_test', 'postgres');
  });
  psql(`
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
  psql(`
    INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 1000);
    INSERT INTO jev_ip (day, ip_hash, calls) VALUES ('2026-10-21', 'h1', 5);
  `);
  const refused = await phrasePlanGate(sql, {
    day: '2026-10-21',
    hash: 'h1',
    month: '2026-10',
    reservation: 100,
    limit: 200,
    cap: 1000,
  });
  assert.equal(refused[0]?.ip_ok, true);
  assert.equal(refused[0]?.spend_ok, false);
  assert.equal(refused[0]?.calls, null);
  assert.equal(psql(`SELECT calls FROM jev_ip WHERE ip_hash = 'h1'`), '5');
  assert.equal(psql(`SELECT tokens FROM jev_spend WHERE month = '2026-10'`), '1000');

  psql('TRUNCATE jev_ip, jev_spend');
  psql(`
    INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 100);
    INSERT INTO jev_ip (day, ip_hash, calls) VALUES ('2026-10-21', 'h1', 5);
  `);
  const accepted = await phrasePlanGate(sql, {
    day: '2026-10-21',
    hash: 'h1',
    month: '2026-10',
    reservation: 100,
    limit: 200,
    cap: 1000,
  });
  assert.equal(accepted[0]?.calls, 6);
  assert.equal(accepted[0]?.tokens, 200);
  assert.equal(psql(`SELECT calls FROM jev_ip WHERE ip_hash = 'h1'`), '6');
  assert.equal(psql(`SELECT tokens FROM jev_spend WHERE month = '2026-10'`), '200');

  psql('TRUNCATE jev_ip, jev_spend');
  psql(`
    INSERT INTO jev_spend (month, tokens) VALUES ('2026-10', 100);
    INSERT INTO jev_ip (day, ip_hash, calls) VALUES ('2026-10-21', 'h1', 200);
  `);
  const limited = await phrasePlanGate(sql, {
    day: '2026-10-21',
    hash: 'h1',
    month: '2026-10',
    reservation: 100,
    limit: 200,
    cap: 1000,
  });
  assert.equal(limited[0]?.ip_ok, false);
  assert.equal(limited[0]?.spend_ok, true);
  assert.equal(psql(`SELECT calls FROM jev_ip WHERE ip_hash = 'h1'`), '200');
  assert.equal(psql(`SELECT tokens FROM jev_spend WHERE month = '2026-10'`), '100');
});
