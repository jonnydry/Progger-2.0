import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { vinextShareDir } from './dev-server.ts';

// Lifecycle tests for the shared dev server, driven only in child
// processes. scripts/run-tests.ts places this file in the render slice:
// the render files launch browsers but never acquire the dev server, so
// that job starts cold and the first holder below is provably the process
// that spawns vinext — the role that used to stay alive until the file
// timeout killed it. (The unit slice would also be cold, but a vinext
// cold start there starves timing-sensitive audio tests.) When the server
// is warm or another file holds it (a local `npm test`, a dev's own
// server), the tests skip rather than interfere.
const CHECKOUT = fileURLToPath(new URL('..', import.meta.url));
const SHARE = vinextShareDir(CHECKOUT);
const REFS = join(SHARE, 'refs');
const VINE_LOCK = fileURLToPath(
  new URL('../.vinext/dev/lock.json', import.meta.url),
);
const DEV_SERVER_URL = new URL('./dev-server.ts', import.meta.url).href;

// A holder is a separate process, like a browser test file: it acquires the
// shared server, waits to be told over stdin (or for stdin to close),
// releases, and ends. Whether the process then exits is the behavior under
// test.
const HOLDER = `
const url = process.env.PROGGER_DEV_SERVER;
if (!url) throw new Error('missing PROGGER_DEV_SERVER');
const { acquireDevServer: acquire } = await import(url);
const server = await acquire();
console.log(\`READY \${server.origin}\`);
await new Promise((resolve) => {
  process.stdin.once('data', resolve);
  process.stdin.once('end', resolve);
});
process.stdin.destroy();
await server.release();
console.log('RELEASED');
`;

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type Exit = { code: number | null; signal: string | null };

type Holder = {
  child: ChildProcess;
  out: () => string;
  err: () => string;
  exit: () => Exit | null;
};

function startHolder(script: string): Holder {
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', script],
    {
      cwd: CHECKOUT,
      env: { ...process.env, PROGGER_DEV_SERVER: DEV_SERVER_URL },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  let out = '';
  let err = '';
  let exit: Exit | null = null;
  child.stdout?.on('data', (chunk) => {
    out += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    err = `${err}${chunk.toString()}`.slice(-4000);
  });
  child.on('error', (error) => {
    err = `${err}\nspawn error: ${error.message}`.slice(-4000);
  });
  child.stdin?.on('error', () => {});
  child.on('close', (code, signal) => {
    exit = { code, signal };
  });
  return { child, out: () => out, err: () => err, exit: () => exit };
}

async function waitUntil(
  check: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return check();
}

function readyOrigin(holder: Holder): string {
  return /READY (\S+)/.exec(holder.out())?.[1] ?? '';
}

function serverLogTail(): string {
  try {
    return readFileSync(join(SHARE, 'server.log'), 'utf8').slice(-2000);
  } catch {
    return '';
  }
}

/** Waits for READY, failing fast if the holder dies first. */
async function acquireReady(
  holder: Holder,
  timeoutMs: number,
  label: string,
): Promise<string> {
  await waitUntil(
    () => readyOrigin(holder) !== '' || holder.exit() !== null,
    timeoutMs,
  );
  const origin = readyOrigin(holder);
  assert.ok(
    origin,
    `${label} never acquired the server (exit ${JSON.stringify(holder.exit())})\n` +
      `stdout: ${holder.out()}\nstderr: ${holder.err()}\nserver log: ${serverLogTail()}`,
  );
  return origin;
}

function releaseHolder(holder: Holder) {
  holder.child.stdin?.end('release\n');
}

/** Asserts the holder ended cleanly: exit code 0, no signal, RELEASED flushed. */
async function assertExitedCleanly(
  holder: Holder,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const done = await waitUntil(() => holder.exit() !== null, timeoutMs);
  assert.ok(
    done,
    `${label} stayed alive after release\nstdout: ${holder.out()}\nstderr: ${holder.err()}`,
  );
  assert.deepEqual(
    holder.exit(),
    { code: 0, signal: null },
    `${label} did not exit cleanly\nstdout: ${holder.out()}\nstderr: ${holder.err()}`,
  );
  assert.ok(
    holder.out().includes('RELEASED'),
    `${label} exited without finishing release\nstdout: ${holder.out()}`,
  );
}

function recordedServerPid(): number {
  try {
    return Number(readFileSync(join(SHARE, 'pid'), 'utf8'));
  } catch {
    return 0;
  }
}

function liveVineOrigin(): string {
  try {
    const info = JSON.parse(readFileSync(VINE_LOCK, 'utf8')) as {
      pid?: number;
      appUrl?: string;
    };
    return pidAlive(info.pid ?? 0) ? (info.appUrl ?? '') : '';
  } catch {
    return '';
  }
}

function serverAlreadyRunning(): boolean {
  return liveVineOrigin() !== '';
}

/** Refs held by live processes other than ours: someone else's tests. */
function foreignLiveRefs(ownPids: Set<number>): string[] {
  try {
    return readdirSync(REFS).filter((name) => {
      const pid = Number(name.split('-')[0]);
      return pidAlive(pid) && !ownPids.has(pid);
    });
  } catch {
    return [];
  }
}

/**
 * Captures the server pid the first holder must have spawned, and checks
 * the vine lock agrees on the origin. The captured pid is also the only
 * pid cleanup is ever allowed to signal.
 */
async function captureServerPid(
  origin: string,
  holderPids: number[],
): Promise<number> {
  const pid = recordedServerPid();
  assert.ok(
    Number.isInteger(pid) && pid > 0 && pidAlive(pid),
    `no live server pid recorded (got ${pid})\nserver log: ${serverLogTail()}`,
  );
  assert.ok(
    pid !== process.pid && !holderPids.includes(pid),
    `recorded server pid ${pid} is one of the test processes`,
  );
  assert.ok(
    await waitUntil(() => liveVineOrigin() === origin, 10_000),
    `vine lock origin ${liveVineOrigin()} does not match ${origin}`,
  );
  return pid;
}

function httpStatus(origin: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const request = get(origin, { agent: false }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode ?? 0));
    });
    request.on('error', reject);
    request.setTimeout(15_000, () =>
      request.destroy(new Error('request timed out')),
    );
  });
}

/** Probes until the server answers; the first request pays the cold compile. */
async function probeServing(
  origin: string,
  timeoutMs: number,
): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      return await httpStatus(origin);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`server did not answer at ${origin}: ${lastError}`);
}

/**
 * After the last own holder releases, the share must disappear and the
 * captured server pid must die — unless a foreign process legitimately
 * holds the server (an `npm test` run racing browser files), in which case
 * this test proves nothing about stopping and says so in its message.
 */
async function assertServerStopped(
  serverPid: number,
  ownPids: Set<number>,
): Promise<void> {
  const stopped = await waitUntil(() => !existsSync(SHARE), 15_000);
  if (!stopped) {
    assert.ok(
      foreignLiveRefs(ownPids).length > 0,
      'the last release did not stop the shared server',
    );
    return;
  }
  assert.ok(
    await waitUntil(() => !pidAlive(serverPid), 10_000),
    `share removed but server pid ${serverPid} is still alive`,
  );
}

/**
 * Best-effort removal of a server these tests started but failed to stop.
 * Refuses to signal anything but the captured server pid, unchanged in the
 * pid file, with no refs left: an empty or foreign pid must never turn
 * into a process-group kill.
 */
function stopTestServer(capturedPid: number, ownPids: Set<number>) {
  try {
    for (const name of readdirSync(REFS)) {
      if (!pidAlive(Number(name.split('-')[0]))) rmSync(join(REFS, name));
    }
    if (readdirSync(REFS).length > 0) return;
    if (foreignLiveRefs(ownPids).length > 0) return;
    if (!existsSync(join(SHARE, 'owner'))) return;
    const pid = recordedServerPid();
    if (pid !== capturedPid || !pidAlive(pid)) return;
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    rmSync(SHARE, { recursive: true, force: true });
  } catch {
    /* best effort only */
  }
}

async function cleanupHolders(
  holders: Holder[],
  serverPid: number,
  ownPids: Set<number>,
): Promise<void> {
  for (const holder of holders) {
    if (holder.exit() === null) releaseHolder(holder);
  }
  await waitUntil(
    () => holders.every((holder) => holder.exit() !== null),
    5_000,
  );
  for (const holder of holders) holder.child.kill('SIGKILL');
  await waitUntil(
    () => holders.every((holder) => holder.exit() !== null),
    5_000,
  );
  stopTestServer(serverPid, ownPids);
}

function ownPids(holders: Holder[]): Set<number> {
  const pids = new Set<number>([process.pid]);
  for (const holder of holders) {
    if (holder.child.pid !== undefined) pids.add(holder.child.pid);
  }
  return pids;
}

/** True (after skipping) when the shared server is not cold and untouched. */
function skipUnlessCold(t: TestContext): boolean {
  if (serverAlreadyRunning() || existsSync(SHARE)) {
    t.skip('a dev server or share state already exists');
    return true;
  }
  return false;
}

function writeHolderScript(): { dir: string; script: string } {
  const dir = mkdtempSync(join(tmpdir(), 'progger-dev-server-'));
  const script = join(dir, 'holder.mts');
  writeFileSync(script, HOLDER);
  return { dir, script };
}

void test(
  'the process that starts the dev server exits while another still holds it',
  { timeout: 300_000 },
  async (t) => {
    if (skipUnlessCold(t)) return;
    const { dir, script } = writeHolderScript();
    const spawner = startHolder(script);
    const holders: Holder[] = [spawner];
    let serverPid = 0;
    try {
      const origin = await acquireReady(spawner, 120_000, 'the first holder');
      serverPid = await captureServerPid(origin, [spawner.child.pid ?? 0]);
      const holder = startHolder(script);
      holders.push(holder);
      const again = await acquireReady(holder, 60_000, 'the second holder');
      assert.equal(again, origin, 'both holders must share one server');

      if (foreignLiveRefs(ownPids(holders)).length > 0) {
        t.skip('another test file is using the shared server');
        return;
      }

      releaseHolder(spawner);
      await assertExitedCleanly(
        spawner,
        15_000,
        'the process that started the server',
      );
      assert.ok(
        pidAlive(serverPid),
        'the server died with the process that started it',
      );
      const status = await probeServing(origin, 60_000);
      assert.ok(status > 0, 'server stopped serving after its starter exited');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      assert.ok(pidAlive(serverPid), 'the server died shortly after serving');
      await probeServing(origin, 15_000);

      releaseHolder(holder);
      await assertExitedCleanly(holder, 15_000, 'the second holder');
      await assertServerStopped(serverPid, ownPids(holders));
    } finally {
      await cleanupHolders(holders, serverPid, ownPids(holders));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);

void test(
  'concurrent first acquires share one server and every holder exits',
  { timeout: 180_000 },
  async (t) => {
    if (skipUnlessCold(t)) return;
    const { dir, script } = writeHolderScript();
    const holders = Array.from({ length: 6 }, () => startHolder(script));
    let serverPid = 0;
    try {
      const origins: string[] = [];
      for (const [index, holder] of holders.entries()) {
        origins.push(
          await acquireReady(holder, 120_000, `concurrent holder ${index + 1}`),
        );
      }
      assert.ok(
        origins.every((origin) => origin === origins[0]),
        `concurrent holders got different servers: ${origins.join(', ')}`,
      );
      serverPid = await captureServerPid(
        origins[0],
        holders.map((holder) => holder.child.pid ?? 0),
      );

      if (foreignLiveRefs(ownPids(holders)).length > 0) {
        t.skip('another test file is using the shared server');
        return;
      }

      for (const holder of holders) releaseHolder(holder);
      for (const [index, holder] of holders.entries()) {
        await assertExitedCleanly(
          holder,
          15_000,
          `concurrent holder ${index + 1}`,
        );
      }
      await assertServerStopped(serverPid, ownPids(holders));
    } finally {
      await cleanupHolders(holders, serverPid, ownPids(holders));
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
