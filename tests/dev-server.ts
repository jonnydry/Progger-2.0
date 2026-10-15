import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
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
  try {
    await access(OWNER);
  } catch {
    return;
  }
  const pid = Number(await readFile(`${SHARE}/pid`, 'utf8').catch(() => '0'));
  if (pidAlive(pid)) return;
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
  let captured = '';
  const child = spawn(
    'npx',
    ['vinext', 'dev', '--port', String(port), '--hostname', '127.0.0.1'],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const keep = (chunk: Buffer) => {
    captured = `${captured}${chunk.toString()}`.slice(-4000);
  };
  child.stdout?.on('data', keep);
  child.stderr?.on('data', keep);
  child.unref();
  return { child, log: () => captured };
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
      await handle.close();
      weOwn = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }

    if (!weOwn) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      continue;
    }

    const port = await reservePort();
    const { child, log } = startServer(port);
    await writeFile(`${SHARE}/pid`, String(child.pid ?? ''));
    try {
      await waitForPort(port, 90_000);
      await writeFile(`${SHARE}/origin`, `http://127.0.0.1:${port}`);
      return `http://127.0.0.1:${port}`;
    } catch (error) {
      const fallback = await readLiveOrigin();
      if (fallback) {
        await rm(OWNER, { force: true });
        return fallback;
      }
      stopProcess(child.pid ?? 0);
      await rm(OWNER, { force: true });
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${log()}`,
      );
    }
  }
  throw new Error('timed out waiting for the dev server');
}

/** One vinext dev server for the browser tests. A server already on disk is reused. */
export async function acquireDevServer(): Promise<{
  origin: string;
  release: () => Promise<void>;
}> {
  await mkdir(REFS, { recursive: true });
  await sweepDeadRefs();
  const ref = `${REFS}/${process.pid}-${randomUUID()}`;
  await writeFile(ref, '');
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
    throw error;
  }
}
