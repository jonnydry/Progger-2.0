#!/usr/bin/env node
import { pidAlive, readCurrent, writeCurrent } from './run-state.mjs';

function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
    return true;
  } catch {
    try {
      process.kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

const state = readCurrent();
if (!state) {
  console.log('No verify run to stop.');
  process.exit(0);
}

if (!state.stopped && pidAlive(state.pid)) {
  signalGroup(state.pid, 'SIGTERM');
  const deadline = Date.now() + 8_000;
  while (pidAlive(state.pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (pidAlive(state.pid)) {
    signalGroup(state.pid, 'SIGKILL');
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (pidAlive(state.pid)) {
    console.error(`Could not stop pid ${state.pid}.`);
    console.error(`evidence ${state.evidenceDir}`);
    process.exit(1);
  }
}

state.stopped = true;
writeCurrent(state);
console.log(`stopped ${state.origin}`);
console.log(`evidence ${state.evidenceDir}`);
