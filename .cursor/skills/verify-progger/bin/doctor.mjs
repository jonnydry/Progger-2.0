#!/usr/bin/env node
import {
  chromeVersion,
  gitSha,
  isDescendant,
  listeners,
  packageVersion,
  pageIsReady,
  pidAlive,
  processCwd,
  readCurrent,
  repoRoot,
  vinextLock,
} from './run-state.mjs';

export async function diagnose(state) {
  const problems = [];
  if (!state) {
    problems.push('No verify state. Run launch.mjs.');
    return problems;
  }
  if (state.stopped) {
    problems.push('This run is stopped. Run launch.mjs.');
  }
  if (!pidAlive(state.pid)) {
    problems.push(`Launch pid ${state.pid} is not running. Run launch.mjs.`);
  } else if (processCwd(state.pid) !== repoRoot) {
    problems.push(`Launch pid ${state.pid} cwd is not ${repoRoot}.`);
  }
  if (state.repoRoot !== repoRoot) {
    problems.push(`State repo ${state.repoRoot} does not match ${repoRoot}.`);
  }
  if (state.packageVersion !== packageVersion()) {
    problems.push(
      `Package version is ${packageVersion()}, state recorded ${state.packageVersion}. Relaunch.`,
    );
  }
  if (state.gitSha !== gitSha()) {
    problems.push(`HEAD is ${gitSha()}, state recorded ${state.gitSha}. Relaunch.`);
  }
  const lock = vinextLock();
  if (!lock || !pidAlive(lock.pid)) {
    problems.push('No live vinext lock. The dev server is not the one launch started.');
  } else if (!isDescendant(state.pid, lock.pid) && lock.pid !== state.pid) {
    problems.push(
      `vinext pid ${lock.pid} is not the process launch started (${state.pid}).`,
    );
  } else if (lock.appUrl !== state.origin || lock.port !== state.port) {
    problems.push(
      `vinext lock says ${lock.appUrl}, state says ${state.origin}.`,
    );
  }
  const owners = listeners(state.port);
  if (owners.length === 0) {
    problems.push(`Nothing is listening on ${state.origin}.`);
  } else if (
    !owners.every((pid) => pid === state.pid || isDescendant(state.pid, pid))
  ) {
    problems.push(
      `Port ${state.port} is owned by pid ${owners.join(', ')}, not launch pid ${state.pid}.`,
    );
  }
  if (!chromeVersion()) {
    problems.push('Google Chrome is not on PATH. Drive uses Playwright channel chrome.');
  }
  if (problems.length > 0) return problems;
  try {
    const page = await pageIsReady(state.origin);
    if (!page.ready) {
      problems.push(
        `${state.origin} returned HTTP ${page.status} without the Explore page.`,
      );
    }
  } catch (error) {
    problems.push(
      `GET ${state.origin} failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return problems;
}

const isMain = process.argv[1] && process.argv[1].endsWith('doctor.mjs');
if (isMain) {
  const problems = await diagnose(readCurrent());
  if (problems.length === 0) {
    const state = readCurrent();
    console.log(`ok ${state.origin}`);
    console.log(`pid ${state.pid}`);
    console.log(`chrome ${chromeVersion()}`);
    console.log(`sha ${state.gitSha}`);
    process.exit(0);
  }
  for (const problem of problems) console.error(problem);
  process.exit(1);
}
