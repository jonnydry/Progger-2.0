import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const repoRoot = resolve(here, '../../../..');
export const verifyRoot = '/tmp/progger-verify';
export const currentPath = resolve(verifyRoot, 'current.json');
export const defaultPort = 4173;

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n');
  renameSync(temporary, path);
}

export function readCurrent() {
  try {
    const pointer = readJson(currentPath);
    return readJson(pointer.statePath);
  } catch {
    return null;
  }
}

export function writeCurrent(state) {
  writeJson(resolve(state.runDir, 'state.json'), state);
  writeJson(currentPath, {
    runId: state.runId,
    statePath: resolve(state.runDir, 'state.json'),
  });
}

export function packageVersion() {
  const pkg = readJson(resolve(repoRoot, 'package.json'));
  if (pkg.name !== 'progger') {
    throw new Error(`expected package progger in ${repoRoot}`);
  }
  return pkg.version;
}

export function gitSha() {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: repoRoot,
    encoding: 'utf8',
  }).trim();
}

export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

export function isDescendant(ancestor, pid) {
  let current = pid;
  const seen = new Set();
  while (current > 1 && !seen.has(current)) {
    if (current === ancestor) return true;
    seen.add(current);
    let status;
    try {
      status = readFileSync(`/proc/${current}/status`, 'utf8');
    } catch {
      return false;
    }
    const parent = Number(status.match(/^PPid:\s+(\d+)/m)?.[1] ?? 0);
    current = parent;
  }
  return false;
}

export function processCwd(pid) {
  try {
    return readlinkSync(`/proc/${pid}/cwd`);
  } catch {
    return null;
  }
}

export function vinextLock() {
  try {
    return readJson(resolve(repoRoot, '.vinext/dev/lock.json'));
  } catch {
    return null;
  }
}

export function chromeVersion() {
  for (const bin of ['google-chrome', 'google-chrome-stable', 'chrome']) {
    try {
      return execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim();
    } catch {
      continue;
    }
  }
  return null;
}

function listenersFromProc(port) {
  const hex = port.toString(16).toUpperCase().padStart(4, '0');
  const inodes = new Set();
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 10) continue;
      if (!parts[1].endsWith(`:${hex}`)) continue;
      if (parts[3] !== '0A') continue;
      inodes.add(parts[9]);
    }
  }
  if (inodes.size === 0) return [];
  const pids = [];
  for (const dir of readdirSync('/proc')) {
    if (!/^\d+$/.test(dir)) continue;
    let fds = [];
    try {
      fds = readdirSync(`/proc/${dir}/fd`);
    } catch {
      continue;
    }
    for (const fd of fds) {
      try {
        const target = readlinkSync(`/proc/${dir}/fd/${fd}`);
        const match = /^socket:\[(\d+)\]$/.exec(target);
        if (match && inodes.has(match[1])) {
          pids.push(Number(dir));
          break;
        }
      } catch {
        continue;
      }
    }
  }
  return [...new Set(pids)];
}

export function listeners(port) {
  try {
    const out = execFileSync('ss', ['-H', '-ltnp', `sport = :${port}`], {
      encoding: 'utf8',
    });
    const pids = [...out.matchAll(/pid=(\d+)/g)].map((match) =>
      Number(match[1]),
    );
    if (pids.length > 0 || out.trim() === '') return [...new Set(pids)];
  } catch {
    return listenersFromProc(port);
  }
  return listenersFromProc(port);
}

export async function pageIsReady(origin) {
  const response = await fetch(`${origin}/`, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  const ready =
    response.status === 200 &&
    body.includes('<title>Progger') &&
    body.includes('A Dorian guitar reference') &&
    body.includes('aria-label="Guitar reference explorer"');
  return { ready, status: response.status, body };
}
