-- Phrase planner counters. Apply this file by hand to the Neon database
-- whose connection string is JEV_COUNTER_DATABASE_URL.
-- The api/phrase-plan function does not run this file and does not CREATE TABLE.

CREATE TABLE IF NOT EXISTS jev_spend (
  month text PRIMARY KEY,
  tokens bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS jev_ip (
  day date NOT NULL,
  ip_hash text NOT NULL,
  calls int NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ip_hash)
);
