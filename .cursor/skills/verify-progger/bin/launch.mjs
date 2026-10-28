#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  chromeVersion,
  defaultPort,
  gitSha,
  isDescendant,
  listeners,
  packageVersion,
  pageIsReady,
  pidAlive,
  readCurrent,
  repoRoot,
  verifyRoot,
  vinextLock,
  writeCurrent,
} from './run-state.mjs';

const port = Number(process.env.VERIFY_APP_PORT || defaultPort);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`VERIFY_APP_PORT must be a TCP port. Got ${process.env.VERIFY_APP_PORT}.`);
  process.exit(1);
}

const current = readCurrent();
if (current && !current.stopped && pidAlive(current.pid)) {
  console.error(
    `A verify server is already running at ${current.origin} (pid ${current.pid}).`,
  );
  console.error('Drive that instance, or run cleanup.mjs before launching another.');
  process.exit(1);
}

const lock = vinextLock();
if (lock && pidAlive(lock.pid)) {
  console.error('Another vinext dev server is already running in this checkout.');
  console.error(`Local: ${lock.appUrl}`);
  console.error(`PID: ${lock.pid}`);
  console.error('This checkout can run one vinext dev server. Do not kill a server this skill did not start.');
  process.exit(1);
}

const held = listeners(port);
if (held.length > 0) {
  console.error(`Port ${port} is already in use by pid ${held.join(', ')}.`);
  console.error('Set VERIFY_APP_PORT to a free port, or stop the process that owns this one.');
  process.exit(1);
}

if (!chromeVersion()) {
  console.error('Google Chrome is not on PATH. Drive uses Playwright channel chrome.');
  process.exit(1);
}

const runId = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(3).toString('hex')}`;
const runDir = resolve(verifyRoot, runId);
const evidenceDir = resolve(runDir, 'evidence');
const logPath = resolve(runDir, 'server.log');
const origin = `http://127.0.0.1:${port}`;
mkdirSync(runDir, { recursive: true });
const logFd = openSync(logPath, 'a');
const child = spawn(
  'npm',
  ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(port)],
  {
    cwd: repoRoot,
    detached: true,
    stdio: ['ignore', logFd, logFd],
  },
);
child.unref();

const state = {
  runId,
  pid: child.pid,
  port,
  origin,
  repoRoot,
  packageVersion: packageVersion(),
  gitSha: gitSha(),
  startedAt: new Date().toISOString(),
  ready: false,
  stopped: false,
  runDir,
  evidenceDir,
  logPath,
  lockPid: null,
};
writeCurrent(state);

function stopLaunch() {
  if (!state.pid) return;
  try {
    process.kill(-state.pid, 'SIGTERM');
  } catch {
    try {
      process.kill(state.pid, 'SIGTERM');
    } catch {
      return;
    }
  }
}

const deadline = Date.now() + 120_000;
let last = 'no response yet';
while (Date.now() < deadline) {
  if (!pidAlive(state.pid)) {
    console.error(`The dev server exited before it was ready. See ${logPath}`);
    state.stopped = true;
    writeCurrent(state);
    process.exit(1);
  }
  try {
    const result = await pageIsReady(origin);
    if (result.ready) {
      const seen = vinextLock();
      const ours =
        seen &&
        pidAlive(seen.pid) &&
        seen.appUrl === origin &&
        (seen.pid === state.pid || isDescendant(state.pid, seen.pid));
      if (!ours) {
        last = `vinext lock is ${seen?.appUrl ?? 'missing'} pid ${seen?.pid ?? 'none'}`;
      } else {
        state.ready = true;
        state.lockPid = seen.pid;
        writeCurrent(state);
        console.log(`ready ${origin}`);
        console.log(`evidence ${evidenceDir}`);
        console.log(`log ${logPath}`);
        process.exit(0);
      }
    }
    last = `HTTP ${result.status}`;
  } catch (error) {
    last = error instanceof Error ? error.message : String(error);
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 300));
}

stopLaunch();
state.stopped = true;
writeCurrent(state);
console.error(`Timed out waiting for ${origin} (${last}). See ${logPath}`);
process.exit(1);
