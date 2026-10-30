import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync } from 'node:fs';
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createConnection, createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

/** Lock directory for one checkout, so two worktrees do not share a vinext server. */
export function vinextShareDir(checkout: string): string {
  const key = createHash('sha256').update(checkout).digest('hex').slice(0, 16);
  return `/tmp/progger-vinext-share-${key}`;
}

const SHARE = vinextShareDir(fileURLToPath(new URL('..', import.meta.url)));
const REFS = `${SHARE}/refs`;
const OWNER = `${SHARE}/owner`;
const VINE_LOCK = fileURLToPath(
  new URL('../.vinext/dev/lock.json', import.meta.url),
);

type VineLock = {
  pid: number;
  appUrl: string;
};

function pidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') {
        probe.close();
        reject(new Error('no port'));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function waitForPort(port: number, timeoutMs: number) {
  const started = Date.now();
  return new Promise<void>((resolve, reject) => {
    const attempt = () => {
      const socket = createConnection({ port, host: '127.0.0.1' }, () => {
        socket.end();
        resolve();
      });
      socket.on('error', () => {
        socket.destroy();
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`dev server did not open port ${port}`));
          return;
        }
        setTimeout(attempt, 200);
      });
    };
    attempt();
  });
}

async function readLiveOrigin(): Promise<string | null> {
  try {
    const info = JSON.parse(await readFile(VINE_LOCK, 'utf8')) as VineLock;
    if (!pidAlive(info.pid) || !info.appUrl) return null;
    const port = Number(new URL(info.appUrl).port);
    await waitForPort(port, 1_000);
    return info.appUrl;
  } catch {
    return null;
  }
}

async function sweepDeadRefs() {
  const names = await readdir(REFS).catch(() => []);
  await Promise.all(
    names.map(async (name) => {
      const pid = Number(name.split('-')[0]);
      if (!pidAlive(pid)) await rm(`${REFS}/${name}`, { force: true });
    }),
  );
}

async function recoverStaleOwner() {
  if (await readLiveOrigin()) return;
  let ownerAgeMs: number;
  try {
    ownerAgeMs = Date.now() - (await stat(OWNER)).mtimeMs;
  } catch {
    return;
  }
  // OWNER names the process that claimed it. While that process lives it
  // owns startup (including a server child that died on the way), so never
  // steal; its own cleanup removes OWNER. Stealing mid-startup starts a
  // second server whose pid overwrites the real one, and the loser's
  // fallback then deletes OWNER, so the running server is never stopped.
  // An OWNER left by a dead process (or an empty one from before the
  // naming) is stale once it is old enough that a live owner would have
  // written its pid.
  const ownerPid = Number(await readFile(OWNER, 'utf8').catch(() => '0'));
  if (pidAlive(ownerPid)) return;
  if (ownerAgeMs < 15_000) return;
  await rm(OWNER, { force: true });
  await rm(`${SHARE}/stopping`, { force: true });
}

function stopProcess(pid: number) {
  if (!pidAlive(pid)) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already gone */
    }
  }
}

async function stopIfOwnerAndIdle() {
  try {
    await access(OWNER);
  } catch {
    return;
  }
  const refs = await readdir(REFS).catch(() => ['pending']);
  if (refs.length > 0) return;
  try {
    const handle = await open(`${SHARE}/stopping`, 'wx');
    await handle.close();
  } catch {
    return;
  }
  const again = await readdir(REFS).catch(() => ['pending']);
  if (again.length > 0) {
    await rm(`${SHARE}/stopping`, { force: true });
    return;
  }
  const pid = Number(await readFile(`${SHARE}/pid`, 'utf8').catch(() => '0'));
  stopProcess(pid);
  await rm(SHARE, { recursive: true, force: true });
}

function startServer(port: number): { child: ChildProcess; log: () => string } {
  // The server must outlive this process: the test file that starts it
  // exits as soon as its own tests finish, while other files still use the
  // server. Piped stdio breaks that both ways: child.unref() does not
  // unref the pipes, so this process cannot exit until the server dies,
  // and unref'ing the pipes instead would leave the server writing to a
  // pipe with no reader, which kills a Node process with EPIPE. A log file
  // keeps neither side hostage and still gives log() a tail to quote.
  const logPath = `${SHARE}/server.log`;
  const logFd = openSync(logPath, 'w');
  const child = spawn(
    'npx',
    ['vinext', 'dev', '--port', String(port), '--hostname', '127.0.0.1'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      detached: true,
      stdio: ['ignore', logFd, logFd],
    },
  );
  closeSync(logFd);
  child.unref();
  return {
    child,
    log: () => {
      try {
        return readFileSync(logPath, 'utf8').slice(-4000);
      } catch {
        return '';
      }
    },
  };
}

async function ensureOrigin(): Promise<string> {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    await recoverStaleOwner();
    const live = await readLiveOrigin();
    if (live) return live;

    let weOwn = false;
    try {
      const handle = await open(OWNER, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      weOwn = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    if (!weOwn) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }

    // Every startup step after the claim runs under the same cleanup: a
    // throw anywhere here must release OWNER, or the live owner pid in it
    // would make the claim unstealable until this process exits.
    let child: ChildProcess | undefined;
    let log: () => string = () => '';
    try {
      const port = await reservePort();
      const started = startServer(port);
      child = started.child;
      log = started.log;
      await writeFile(`${SHARE}/pid`, String(started.child.pid ?? ''));
      await waitForPort(port, 90_000);
      await writeFile(`${SHARE}/origin`, `http://127.0.0.1:${port}`);
      return `http://127.0.0.1:${port}`;
    } catch (error) {
      const fallback = await readLiveOrigin();
      if (fallback) {
        await rm(OWNER, { force: true });
        return fallback;
      }
      if (child) stopProcess(child.pid ?? 0);
      await rm(OWNER, { force: true });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${log()}`,
      );
    }
  }
  throw new Error('timed out waiting for the dev server');
}

async function stoppingInProgress(): Promise<boolean> {
  try {
    await access(`${SHARE}/stopping`);
    return true;
  } catch {
    return false;
  }
}

/** One vinext dev server for the browser tests. A server already on disk is reused. */
export async function acquireDevServer(): Promise<{
  origin: string;
  release: () => Promise<void>;
}> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    await mkdir(REFS, { recursive: true });
    await sweepDeadRefs();
    const ref = `${REFS}/${process.pid}-${randomUUID()}`;
    let wroteRef = true;
    try {
      await writeFile(ref, '');
    } catch {
      wroteRef = false;
    }
    // The last holder claims `stopping`, rechecks the refs, then kills the
    // server and removes SHARE. A ref written after that recheck would be
    // deleted with SHARE and its origin killed underneath us, so when a
    // stop is in progress (or just removed SHARE under our ref write),
    // back out and retry once the stop finishes (SHARE gone, recreated
    // above) or aborts (flag removed). A ref the recheck can see makes
    // the stopper abort instead.
    let refGone = false;
    if (wroteRef) {
      try {
        await access(ref);
      } catch {
        refGone = true;
      }
    }
    if (!wroteRef || refGone || (await stoppingInProgress())) {
      await rm(ref, { force: true });
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for the dev server to stop');
      }
      while ((await stoppingInProgress()) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      continue;
    }
    try {
      const origin = await ensureOrigin();
      let released = false;
      return {
        origin,
        release: async () => {
          if (released) return;
          released = true;
          await rm(ref, { force: true });
          await stopIfOwnerAndIdle();
        },
      };
    } catch (error) {
      await rm(ref, { force: true });
      // A stop that slipped between the checks above and ensureOrigin
      // surfaces as a missing SHARE (e.g. opening OWNER): retry fresh
      // instead of failing the acquire.
      let shareGone = false;
      try {
        await access(SHARE);
      } catch {
        shareGone = true;
      }
      if (shareGone && Date.now() < deadline) continue;
      throw error;
    }
  }
}
