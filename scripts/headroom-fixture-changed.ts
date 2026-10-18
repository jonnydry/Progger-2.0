/**
 * Decide whether a nightly headroom sweep should update the bot pull request.
 *
 * The sweep writes tests/fixtures/headroom-worst.json with JSON.stringify
 * indent 2. Arrays then sit one element per line, and `seconds` is wall-clock
 * time, so `git diff --quiet` reports a change every night. Compare the
 * parsed cases instead. Floats within 1e-6 match. `seconds` is ignored. A
 * reorder counts only when the cases that moved are not a near tie on
 * prediction, which is what the sweep sorts by. A real change is rewritten
 * in the committed fixture style (compact number arrays).
 *
 * Run: node --experimental-strip-types scripts/headroom-fixture-changed.ts <fixture>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { sep } from 'node:path';

/** Absolute tolerance for shifts, prediction, confirmed, and near-tie order. */
export const HEADROOM_FLOAT_TOLERANCE = 1e-6;

type WorstCase = {
  sound: string;
  root: string;
  mode: string;
  octave: string;
  via: string;
  from: string;
  fromRoot: string;
  fromMode: string;
  kind: string;
  index: number;
  noteShifts: number[];
  chordShift: number;
  chordFrets: string;
  prediction: number;
  confirmed: number;
};

type BrowserSweep = {
  seconds: number;
  cases: WorstCase[];
};

export type HeadroomFixture = {
  sources: string;
  chromium: BrowserSweep;
  firefox: BrowserSweep;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not an object`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} is not a string`);
  return value;
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label} is not a finite number`);
  }
  return value;
}

function integer(value: unknown, label: string): number {
  const parsed = finite(value, label);
  if (!Number.isInteger(parsed)) throw new Error(`${label} is not an integer`);
  return parsed;
}

function shifts(value: unknown, label: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`);
  return value.map((item, index) => finite(item, `${label}[${index}]`));
}

function parseCase(value: unknown, label: string): WorstCase {
  const item = record(value, label);
  return {
    sound: text(item.sound, `${label}.sound`),
    root: text(item.root, `${label}.root`),
    mode: text(item.mode, `${label}.mode`),
    octave: text(item.octave, `${label}.octave`),
    via: text(item.via, `${label}.via`),
    from: text(item.from, `${label}.from`),
    fromRoot: text(item.fromRoot, `${label}.fromRoot`),
    fromMode: text(item.fromMode, `${label}.fromMode`),
    kind: text(item.kind, `${label}.kind`),
    index: integer(item.index, `${label}.index`),
    noteShifts: shifts(item.noteShifts, `${label}.noteShifts`),
    chordShift: finite(item.chordShift, `${label}.chordShift`),
    chordFrets: text(item.chordFrets, `${label}.chordFrets`),
    prediction: finite(item.prediction, `${label}.prediction`),
    confirmed: finite(item.confirmed, `${label}.confirmed`),
  };
}

function parseBrowser(value: unknown, label: string): BrowserSweep {
  const sweep = record(value, label);
  if (!Array.isArray(sweep.cases))
    throw new Error(`${label}.cases is not an array`);
  return {
    seconds: finite(sweep.seconds, `${label}.seconds`),
    cases: sweep.cases.map((item, index) =>
      parseCase(item, `${label}.cases[${index}]`),
    ),
  };
}

export function parseHeadroomFixture(value: string): HeadroomFixture {
  const parsed: unknown = JSON.parse(value);
  const fixture = record(parsed, 'fixture');
  return {
    sources: text(fixture.sources, 'sources'),
    chromium: parseBrowser(fixture.chromium, 'chromium'),
    firefox: parseBrowser(fixture.firefox, 'firefox'),
  };
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= HEADROOM_FLOAT_TOLERANCE;
}

function identityKey(item: WorstCase): string {
  return [
    item.sound,
    item.root,
    item.mode,
    item.octave,
    item.via,
    item.from,
    item.fromRoot,
    item.fromMode,
    item.kind,
    String(item.index),
    item.chordFrets,
  ].join('\0');
}

function floatsMatch(left: WorstCase, right: WorstCase): boolean {
  if (left.noteShifts.length !== right.noteShifts.length) return false;
  for (let index = 0; index < left.noteShifts.length; index += 1) {
    const shift = left.noteShifts[index];
    const other = right.noteShifts[index];
    if (shift === undefined || other === undefined || !close(shift, other))
      return false;
  }
  return (
    close(left.chordShift, right.chordShift) &&
    close(left.prediction, right.prediction) &&
    close(left.confirmed, right.confirmed)
  );
}

/** The sweep sorts by prediction only, so only that tie can swap order. */
function nearTie(left: WorstCase, right: WorstCase): boolean {
  return close(left.prediction, right.prediction);
}

/**
 * Pair cases that share an identity. Backtrack so a within-tolerance neighbor
 * is not taken before the only partner that fits. Groups are tiny; a huge
 * duplicate group is reported as a change rather than searched.
 */
function assignGroup(
  baseline: readonly WorstCase[],
  candidate: readonly WorstCase[],
  baselineIndexes: readonly number[],
  candidateIndexes: readonly number[],
): number[] | null {
  if (baselineIndexes.length > 12) return null;
  const assignment = Array.from({ length: baselineIndexes.length }, () => -1);
  const used = Array.from({ length: candidateIndexes.length }, () => false);
  const search = (slot: number): boolean => {
    if (slot === baselineIndexes.length) return true;
    const from = baselineIndexes[slot];
    const item = from === undefined ? undefined : baseline[from];
    if (from === undefined || !item) return false;
    for (let option = 0; option < candidateIndexes.length; option += 1) {
      if (used[option]) continue;
      const to = candidateIndexes[option];
      const other = to === undefined ? undefined : candidate[to];
      if (to === undefined || !other || !floatsMatch(item, other)) continue;
      used[option] = true;
      assignment[slot] = to;
      if (search(slot + 1)) return true;
      used[option] = false;
    }
    return false;
  };
  return search(0) ? assignment : null;
}

function casesChanged(
  baseline: readonly WorstCase[],
  candidate: readonly WorstCase[],
): boolean {
  if (baseline.length !== candidate.length) return true;
  const groups = new Map<string, { baseline: number[]; candidate: number[] }>();
  for (let index = 0; index < baseline.length; index += 1) {
    const item = baseline[index];
    if (!item) return true;
    const key = identityKey(item);
    const group = groups.get(key) ?? { baseline: [], candidate: [] };
    group.baseline.push(index);
    groups.set(key, group);
  }
  for (let index = 0; index < candidate.length; index += 1) {
    const item = candidate[index];
    if (!item) return true;
    const group = groups.get(identityKey(item));
    if (!group) return true;
    group.candidate.push(index);
  }
  const landing = Array.from({ length: baseline.length }, () => -1);
  for (const group of groups.values()) {
    if (group.baseline.length !== group.candidate.length) return true;
    const assignment = assignGroup(
      baseline,
      candidate,
      group.baseline,
      group.candidate,
    );
    if (!assignment) return true;
    for (let slot = 0; slot < group.baseline.length; slot += 1) {
      const from = group.baseline[slot];
      const to = assignment[slot];
      if (from === undefined || to === undefined) return true;
      landing[from] = to;
    }
  }
  for (let index = 0; index < baseline.length; index += 1) {
    const found = landing[index];
    if (found === undefined || found < 0) return true;
    if (found === index) continue;
    const item = baseline[index];
    const displaced = baseline[found];
    if (!item || !displaced || !nearTie(item, displaced)) return true;
  }
  return false;
}

/** True when the sweep should open or update the bot pull request. */
export function headroomFixtureChanged(
  baseline: HeadroomFixture,
  candidate: HeadroomFixture,
): boolean {
  if (baseline.sources !== candidate.sources) return true;
  return (
    casesChanged(baseline.chromium.cases, candidate.chromium.cases) ||
    casesChanged(baseline.firefox.cases, candidate.firefox.cases)
  );
}

function formatValue(value: unknown, level: number): string {
  if (
    typeof value === 'number' ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    value === null
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    }
    const pad = ' '.repeat(level + 2);
    const inner = value
      .map((item) => `${pad}${formatValue(item, level + 2)}`)
      .join(',\n');
    return `[\n${inner}\n${' '.repeat(level)}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const pad = ' '.repeat(level + 2);
    const inner = Object.entries(value)
      .map(
        ([key, item]) =>
          `${pad}${JSON.stringify(key)}: ${formatValue(item, level + 2)}`,
      )
      .join(',\n');
    return `{\n${inner}\n${' '.repeat(level)}}`;
  }
  throw new Error('The headroom fixture has a value that is not JSON.');
}

function orderedFixture(fixture: HeadroomFixture): HeadroomFixture {
  const browser = (sweep: BrowserSweep): BrowserSweep => ({
    seconds: sweep.seconds,
    cases: sweep.cases.map((item) => ({
      sound: item.sound,
      root: item.root,
      mode: item.mode,
      octave: item.octave,
      via: item.via,
      from: item.from,
      fromRoot: item.fromRoot,
      fromMode: item.fromMode,
      kind: item.kind,
      index: item.index,
      noteShifts: item.noteShifts,
      chordShift: item.chordShift,
      chordFrets: item.chordFrets,
      prediction: item.prediction,
      confirmed: item.confirmed,
    })),
  });
  return {
    sources: fixture.sources,
    chromium: browser(fixture.chromium),
    firefox: browser(fixture.firefox),
  };
}

/** Pretty-print with number arrays on one line, matching the committed fixture. */
export function formatHeadroomFixture(fixture: HeadroomFixture): string {
  return `${formatValue(orderedFixture(fixture), 0)}\n`;
}

function main(): void {
  const fixturePath = process.argv[2];
  if (!fixturePath) {
    process.stderr.write('usage: headroom-fixture-changed.ts <fixture>\n');
    process.exit(1);
  }
  const candidateText = readFileSync(fixturePath, 'utf8');
  const baselineText = execFileSync('git', ['show', `HEAD:${fixturePath}`], {
    encoding: 'utf8',
  });
  const baseline = parseHeadroomFixture(baselineText);
  const candidate = parseHeadroomFixture(candidateText);
  if (!headroomFixtureChanged(baseline, candidate)) {
    writeFileSync(fixturePath, baselineText);
    process.stdout.write('changed=false\n');
    return;
  }
  writeFileSync(fixturePath, formatHeadroomFixture(candidate));
  process.stdout.write('changed=true\n');
}

const entry = process.argv[1];
if (entry?.endsWith(`${sep}headroom-fixture-changed.ts`)) main();
