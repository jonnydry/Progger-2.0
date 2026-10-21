# Vercel deployment

Primary URL: https://progger.studio

Vercel project: `progger`, under `<your-vercel-team>`.
The connected repository is `jonnydry/Progger-2.0`, production branch `main`.
The repository root is this directory; do not set another `app/` root in Vercel.

## Build

Vercel uses the Other/static preset (`framework: null`), `npm ci`,
`npm run build:vercel`, and output directory `dist/client`.

The build script sets `PROGGER_STATIC_EXPORT=1` for its child process only.
Vinext then uses `output: 'export'` and omits the Sites/Cloudflare runtime plugins.
The script verifies both `index.html` and `index.txt` (static RSC hydration
payload) exist before succeeding. The normal development and Workers-preview
commands remain available.

There is one deployed server function, `api/phrase-plan`. It plans a phrase
with TypeSafe (`jev-1.13.0`) and otherwise leaves the browser on its rules
line. The function reads `TYPESAFE_API_KEY`, `JEV_COUNTER_DATABASE_URL`, and
`JEV_IP_HASH_SALT`. None of those values is logged. The database URL points
at a Neon Postgres database. `db/jev-spend.sql` creates `jev_spend` and
`jev_ip` and is not run by the build or by the function; apply it by hand
before the planner can spend. The counter role is also applied by hand.
`jev_counter` can log in, its `statement_timeout` is 2 seconds, and it
has `USAGE` on `public` with no `CREATE`. It can `SELECT`, `INSERT`,
`UPDATE`, and `DELETE` `jev_ip`, and `SELECT`, `INSERT`, and `UPDATE`
`jev_spend`. The password below is a placeholder:

```sql
CREATE ROLE jev_counter LOGIN PASSWORD '<password>';
ALTER ROLE jev_counter SET statement_timeout = '2s';
GRANT USAGE ON SCHEMA public TO jev_counter;
GRANT SELECT, INSERT, UPDATE, DELETE ON jev_ip TO jev_counter;
GRANT SELECT, INSERT, UPDATE ON jev_spend TO jev_counter;
```

The function reads the month row and
inserts it at 0 only when that read is empty, so an existing month does
not queue on the spend lock. The gate still locks that row before the
IP row. It writes the IP counter only when the spend reservation is
written, and writes that reservation only when the IP write returns,
and calls TypeSafe only after both succeed. A refused month does not
spend a daily IP slot. Stale IP rows are deleted in a separate
best-effort statement after the response. A deadlock (SQLSTATE 40P01
or 40001) is retried once inside the 1200 ms database budget. A second
deadlock logs `db_deadlock` and does not arm the 30 s outage skip. A
timeout on that retry logs `db_timeout` and does arm it. The whole
reservation is refunded only when the call never starts. A 200 with a
valid usage object gives back the unused part of that reservation in
`waitUntil`: billed tokens are `input_tokens` plus `output_tokens` when
the response reports them. Usage above the reservation logs
`usage_over_reservation` and adds the excess, up to the cap. Anything
else keeps the full reservation. At 40 tokens a call, the 143,080,000
cap is about 3.5 million calls. A database failure is logged as
`db_error`, `db_timeout`, or `db_deadlock`. A reconcile failure is
`reconcile_error` or `reconcile_timeout`. Stale-IP cleanup is
`ip_cleanup_error` or `ip_cleanup_timeout`. The error text is not
logged. A missing salt
does the same, after one warning that does not include the salt. A
waiter behind a non-200 keeps the rest of its work inside the 1700 ms
server budget, and returns without reserving when that remainder
cannot hold both a database attempt and an upstream attempt. One
process shares a 200 for an in-flight context. Any other status is not
reused, so that caller runs its own reservation. Another instance can
still reserve the same context; each of those duplicates is counted
under the cap. The browser waits up to 2000 ms. The coded server worst
case is 1700 ms, so the margin is 300 ms. The rules line is already
playing, so that wait does not delay the sound. A change of seed alone
reuses the in-flight request. The request is aborted when the musical
context changes or the panel unmounts.
Requests whose Origin is not
progger.studio, www.progger.studio, exactly `https://${VERCEL_URL}` or
`https://${VERCEL_BRANCH_URL}`, or localhost in development are rejected
before the database or the key is touched.

The initial page and hydration payload are still prerendered. Matching,
diagrams, themes, and audio run in the browser. Hash navigation needs no
catch-all rewrite; missing assets stay 404. Only hashed `/_next/static/`
assets receive immutable cache headers.

Before publishing changes:

```sh
npm test
npm run typecheck
npm run lint
npm run build:vercel
```

Pushes to `main` deploy through the Vercel Git integration. For an explicit CLI
preview, use `vercel deploy --target preview`; verify it before promoting.
Vercel assigns a new project's first deployment to production even without
`--prod`. Subsequent CLI preview behavior should still be selected explicitly.

Local `.vercel/` state and `.env*` are ignored by Git and upload rules. Do not
commit Vercel tokens or downloaded local environment files.

## Domains

`progger.studio` is a verified project domain using its existing Vercel
nameservers. `www.progger.studio` is a verified 308 redirect to the apex domain.
Vercel provisions HTTPS. Existing default DNS/CAA records were preserved;
no registrar or nameserver migration was required.

## Launch verification — 9 September 2026

- Static build rendered `/` and `/404`, with no skipped routes.
- All 68 existing named tests, typecheck and lint pass.
- Independent reviewers checked static output, assets, cache scope and runtime
  independence; parent verified browser hydration and interaction.
- Hosted `#match` loads directly, equivalent diminished inversions retain their
  corrected ranking, Show on neck navigates, and Hear voicing starts/stops.
- Hosted HTML-referenced scripts/styles/fonts return 200 with correct MIME and
  expected cache headers. Missing assets, unknown paths and `.env.local` return 404.
- Apex HTTPS returns 200; both HTTP apex and HTTPS www return 308 to the apex.
  TLS certificates validate for both names.

Initial launch deployment: `dpl_H4NmaSpUxR87moXce9swkuAvK3mb`.
The saved Git release may create a subsequent equivalent production deployment.
Refer to Vercel deployment history for the current artifact and rollback target.
