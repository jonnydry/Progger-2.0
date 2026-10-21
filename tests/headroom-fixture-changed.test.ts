import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TIMING_OFFSETS } from './drone-headroom-run.ts';
import {
  HEADROOM_FLOAT_TOLERANCE,
  HEADROOM_OFFSET_STEP_LIMIT,
  HEADROOM_TIMING_STEP,
  formatHeadroomFixture,
  headroomFixtureChanged,
  parseHeadroomFixture,
  type HeadroomFixture,
} from '../scripts/headroom-fixture-changed.ts';

const fixtureUrl = new URL('./fixtures/headroom-worst.json', import.meta.url);
const scriptPath = fileURLToPath(
  new URL('../scripts/headroom-fixture-changed.ts', import.meta.url),
);
const committed = readFileSync(fixtureUrl, 'utf8');

function load(): HeadroomFixture {
  return parseHeadroomFixture(committed);
}

function nudgeWithin(value: number): number {
  // Adding 1e-6 can round a hair past the tolerance. Search for the largest
  // step whose measured absolute delta is still <= 1e-6.
  let low = 0;
  let high = 1;
  let best = value;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const mid = (low + high) / 2;
    const next = value + HEADROOM_FLOAT_TOLERANCE * mid;
    const delta = Math.abs(next - value);
    if (delta <= HEADROOM_FLOAT_TOLERANCE && delta > 0) {
      best = next;
      low = mid;
    } else {
      high = mid;
    }
  }
  const delta = Math.abs(best - value);
  if (!(delta <= HEADROOM_FLOAT_TOLERANCE && delta > 0.99e-6)) {
    throw new Error(
      `could not nudge ${value} within ${HEADROOM_FLOAT_TOLERANCE} (got ${delta})`,
    );
  }
  return best;
}

function nudgeOver(value: number): number {
  const next = value + HEADROOM_FLOAT_TOLERANCE * 2;
  if (!(Math.abs(next - value) > HEADROOM_FLOAT_TOLERANCE)) {
    throw new Error(
      `could not nudge ${value} past ${HEADROOM_FLOAT_TOLERANCE}`,
    );
  }
  return next;
}

function noiseFloats(fixture: HeadroomFixture): void {
  for (const sweep of [fixture.chromium, fixture.firefox]) {
    for (const item of sweep.cases) {
      item.prediction = nudgeWithin(item.prediction);
      item.confirmed = nudgeWithin(item.confirmed);
      item.chordShift = nudgeWithin(item.chordShift);
      item.noteShifts = item.noteShifts.map((shift) => nudgeWithin(shift));
    }
  }
}

function maxCaseDelta(
  baseline: HeadroomFixture,
  candidate: HeadroomFixture,
): number {
  let max = 0;
  for (const name of ['chromium', 'firefox'] as const) {
    const left = baseline[name].cases;
    const right = candidate[name].cases;
    assert.equal(left.length, right.length);
    for (let index = 0; index < left.length; index += 1) {
      const item = left[index];
      const other = right[index];
      if (!item || !other) throw new Error(`missing case ${name} ${index}`);
      const deltas = [
        Math.abs(item.prediction - other.prediction),
        Math.abs(item.confirmed - other.confirmed),
        Math.abs(item.chordShift - other.chordShift),
        ...item.noteShifts.map((shift, shiftIndex) => {
          const next = other.noteShifts[shiftIndex];
          if (next === undefined) throw new Error('missing shift');
          return Math.abs(shift - next);
        }),
      ];
      for (const delta of deltas) if (delta > max) max = delta;
    }
  }
  return max;
}

function reverseNearTies(cases: HeadroomFixture['chromium']['cases']): {
  predictionSpan: number;
  confirmedSpan: number;
} {
  const indexes: number[] = [];
  for (let index = 0; index < cases.length; index += 1) {
    const item = cases[index];
    if (
      item?.sound === 'cello' &&
      item.root === 'D' &&
      item.mode === 'dorian'
    ) {
      indexes.push(index);
    }
  }
  assert.equal(indexes.length, 3);
  const group = indexes.map((index) => {
    const item = cases[index];
    if (!item) throw new Error('missing near-tie');
    return item;
  });
  const predictions = group.map((item) => item.prediction);
  const confirmed = group.map((item) => item.confirmed);
  const reversed = [...group].reverse();
  for (let slot = 0; slot < indexes.length; slot += 1) {
    const at = indexes[slot];
    const item = reversed[slot];
    if (at === undefined || !item) throw new Error('missing reversed case');
    cases[at] = item;
  }
  return {
    predictionSpan: Math.max(...predictions) - Math.min(...predictions),
    confirmedSpan: Math.max(...confirmed) - Math.min(...confirmed),
  };
}

function loudest(
  fixture: HeadroomFixture,
): HeadroomFixture['chromium']['cases'][number] {
  let item = fixture.chromium.cases[0];
  if (!item) throw new Error('fixture has no cases');
  for (const sweep of [fixture.chromium, fixture.firefox]) {
    for (const candidate of sweep.cases) {
      if (candidate.confirmed > item.confirmed) item = candidate;
    }
  }
  return item;
}

void test('regenerated fixture with new seconds, 1e-6 float noise, and one-per-line arrays is not a change', () => {
  assert.equal(HEADROOM_FLOAT_TOLERANCE, 1e-6);
  const baseline = load();
  const next = structuredClone(baseline);
  next.chromium.seconds = baseline.chromium.seconds + 400;
  next.firefox.seconds = 1;
  noiseFloats(next);
  const pretty = `${JSON.stringify(next, null, 2)}\n`;
  assert.match(pretty, /"noteShifts": \[\n/);
  assert.notEqual(pretty, formatHeadroomFixture(next));
  const parsed = parseHeadroomFixture(pretty);
  const noise = maxCaseDelta(baseline, parsed);
  console.log(
    `no-change seconds ${baseline.chromium.seconds} -> ${parsed.chromium.seconds}, max float noise ${noise}`,
  );
  assert.ok(noise > 0.9e-6 && noise <= 1e-6, `max float noise ${noise}`);
  assert.equal(headroomFixtureChanged(baseline, parsed), false);
});

void test('a worst confirmed value moving by more than 1e-6 is a change', () => {
  const baseline = load();
  const next = structuredClone(baseline);
  const item = loudest(next);
  const before = item.confirmed;
  item.confirmed = nudgeOver(before);
  const delta = Math.abs(item.confirmed - before);
  console.log(
    `change ${item.sound} ${item.root} ${item.mode} confirmed ${before} -> ${item.confirmed} delta ${delta}`,
  );
  assert.ok(delta > HEADROOM_FLOAT_TOLERANCE, `delta ${delta}`);
  assert.equal(headroomFixtureChanged(baseline, next), true);
});

void test('adding or dropping a headroom case is a change', () => {
  const baseline = load();
  const dropped = structuredClone(baseline);
  const removed = dropped.chromium.cases.pop();
  assert.ok(removed);
  console.log(
    `dropped chromium cases ${baseline.chromium.cases.length} -> ${dropped.chromium.cases.length}`,
  );
  assert.equal(headroomFixtureChanged(baseline, dropped), true);

  const added = structuredClone(baseline);
  const extra = structuredClone(added.firefox.cases[0]);
  if (!extra) throw new Error('firefox has no cases');
  extra.root = 'ZZ';
  extra.fromRoot = 'ZZ';
  added.firefox.cases.push(extra);
  console.log(
    `added firefox cases ${baseline.firefox.cases.length} -> ${added.firefox.cases.length}`,
  );
  assert.equal(headroomFixtureChanged(baseline, added), true);
});

void test('an exact duplicate of an existing case is a change, and matching duplicates are not', () => {
  const baseline = load();
  const source = baseline.chromium.cases[0];
  if (!source) throw new Error('chromium has no cases');
  const added = structuredClone(baseline);
  added.chromium.cases.push(structuredClone(source));
  console.log(
    `duplicate ${source.sound} ${source.root} ${source.mode} via ${source.via} from "${source.from}" chromium ${baseline.chromium.cases.length} -> ${added.chromium.cases.length}`,
  );
  assert.equal(headroomFixtureChanged(baseline, added), true);

  const paired = structuredClone(baseline);
  const twin = paired.chromium.cases[0];
  if (!twin) throw new Error('chromium has no cases');
  paired.chromium.cases.push(structuredClone(twin));
  const matched = structuredClone(paired);
  const copy = matched.chromium.cases[matched.chromium.cases.length - 1];
  if (!copy) throw new Error('missing duplicate');
  const before = copy.prediction;
  copy.prediction = nudgeWithin(before);
  const noise = Math.abs(copy.prediction - before);
  console.log(
    `matching duplicates ${paired.chromium.cases.length} on both sides, prediction noise ${noise}`,
  );
  assert.ok(noise > 0.9e-6 && noise <= HEADROOM_FLOAT_TOLERANCE);
  assert.equal(headroomFixtureChanged(paired, matched), false);
});

void test('a note shift or chord shift moving by more than 1e-6 is a change', () => {
  const baseline = load();
  const shifted = structuredClone(baseline);
  const noteCase = shifted.chromium.cases[0];
  const originalNote = baseline.chromium.cases[0];
  if (!noteCase || !originalNote || noteCase.noteShifts.length === 0) {
    throw new Error('chromium case has no note shifts');
  }
  const beforeShift = noteCase.noteShifts[0];
  if (beforeShift === undefined) throw new Error('missing note shift');
  noteCase.noteShifts[0] = nudgeOver(beforeShift);
  const noteDelta = Math.abs(noteCase.noteShifts[0] - beforeShift);
  assert.equal(noteCase.prediction, originalNote.prediction);
  assert.equal(noteCase.confirmed, originalNote.confirmed);
  console.log(
    `noteShift ${beforeShift} -> ${noteCase.noteShifts[0]} delta ${noteDelta}, prediction ${noteCase.prediction}, confirmed ${noteCase.confirmed}`,
  );
  assert.ok(noteDelta > HEADROOM_FLOAT_TOLERANCE, `note delta ${noteDelta}`);
  assert.equal(headroomFixtureChanged(baseline, shifted), true);

  const retimed = structuredClone(baseline);
  const chordCase = retimed.firefox.cases[0];
  const originalChord = baseline.firefox.cases[0];
  if (!chordCase || !originalChord) throw new Error('firefox has no cases');
  const beforeChord = chordCase.chordShift;
  chordCase.chordShift = nudgeOver(beforeChord);
  const chordDelta = Math.abs(chordCase.chordShift - beforeChord);
  assert.equal(chordCase.prediction, originalChord.prediction);
  assert.equal(chordCase.confirmed, originalChord.confirmed);
  console.log(
    `chordShift ${beforeChord} -> ${chordCase.chordShift} delta ${chordDelta}, prediction ${chordCase.prediction}, confirmed ${chordCase.confirmed}`,
  );
  assert.ok(chordDelta > HEADROOM_FLOAT_TOLERANCE, `chord delta ${chordDelta}`);
  assert.equal(headroomFixtureChanged(baseline, retimed), true);
});

void test('a sources hash change is a change', () => {
  const baseline = load();
  const next = structuredClone(baseline);
  next.sources = '0'.repeat(baseline.sources.length);
  assert.notEqual(next.sources, baseline.sources);
  console.log(`sources ${baseline.sources} -> ${next.sources}`);
  assert.equal(headroomFixtureChanged(baseline, next), true);
});

void test('reordering near-tied cases within 1e-6 is not a change', () => {
  const baseline = load();
  const next = structuredClone(baseline);
  const chromiumTies = reverseNearTies(next.chromium.cases);
  const firefoxTies = reverseNearTies(next.firefox.cases);
  assert.ok(chromiumTies.predictionSpan <= HEADROOM_FLOAT_TOLERANCE);
  assert.ok(firefoxTies.predictionSpan <= HEADROOM_FLOAT_TOLERANCE);
  assert.ok(chromiumTies.confirmedSpan <= HEADROOM_FLOAT_TOLERANCE);
  assert.ok(firefoxTies.confirmedSpan <= HEADROOM_FLOAT_TOLERANCE);
  console.log(
    `cello near-tie prediction span chromium ${chromiumTies.predictionSpan} firefox ${firefoxTies.predictionSpan}`,
  );
  assert.equal(headroomFixtureChanged(baseline, next), false);

  for (const sweep of [next.chromium, next.firefox]) {
    for (const item of sweep.cases) {
      if (
        item.sound === 'cello' &&
        item.root === 'D' &&
        item.mode === 'dorian'
      ) {
        item.prediction = nudgeWithin(item.prediction);
        item.confirmed = nudgeWithin(item.confirmed);
      }
    }
  }
  console.log(
    'near-tie reorder of the three D dorian cello cases, plus 1e-6 noise, is not a change',
  );
  assert.equal(headroomFixtureChanged(baseline, next), false);
});

void test('a prediction near-tie reorder stays quiet when confirmed differs by more than 1e-6', () => {
  const baseline = load();
  const widened = structuredClone(baseline);
  const moved = widened.chromium.cases.find(
    (item) =>
      item.sound === 'cello' &&
      item.root === 'D' &&
      item.mode === 'dorian' &&
      item.from === 'reed',
  );
  if (!moved) throw new Error('missing the reed cello near-tie');
  const before = moved.confirmed;
  moved.confirmed = nudgeOver(before);
  const reordered = structuredClone(widened);
  reverseNearTies(reordered.chromium.cases);
  const span = Math.abs(moved.confirmed - before);
  console.log(`prediction-tie reorder with confirmed delta ${span}`);
  assert.ok(span > HEADROOM_FLOAT_TOLERANCE);
  assert.equal(headroomFixtureChanged(widened, reordered), false);
});

void test('overlapping shifts on one identity are matched as a near-tie reorder', () => {
  const template = load().chromium.cases[0];
  if (!template) throw new Error('missing template case');
  const build = (shifts: number[]): HeadroomFixture => {
    const fixture = load();
    fixture.chromium.cases = shifts.map((shift) => {
      const item = structuredClone(template);
      item.sound = 'cello';
      item.root = 'D';
      item.mode = 'dorian';
      item.octave = 'layered';
      item.via = 'sustain';
      item.from = '';
      item.fromRoot = 'D';
      item.fromMode = 'dorian';
      item.kind = 'pair';
      item.index = 1;
      item.chordFrets = 'x,x,x,14,15,13';
      item.noteShifts = [shift];
      item.chordShift = 0;
      item.prediction = 0;
      item.confirmed = 0;
      return item;
    });
    const anchor = structuredClone(template);
    anchor.sound = 'reed';
    anchor.noteShifts = [0];
    anchor.prediction = 0;
    anchor.confirmed = 0;
    anchor.chordShift = 0;
    fixture.firefox.cases = [anchor];
    return fixture;
  };
  const baseline = build([0, 0.8e-6, 1.6e-6]);
  const rotated = build([0.8e-6, 1.6e-6, 0]);
  console.log('rotated noteShifts [0, 0.8e-6, 1.6e-6] on one identity');
  assert.equal(headroomFixtureChanged(baseline, rotated), false);
});

void test('reordering cases that are not near-tied is a change', () => {
  const baseline = load();
  const next = structuredClone(baseline);
  const first = next.chromium.cases[0];
  const second = next.chromium.cases[1];
  if (!first || !second) throw new Error('chromium has fewer than two cases');
  const span = Math.abs(first.prediction - second.prediction);
  assert.ok(span > HEADROOM_FLOAT_TOLERANCE, `prediction span ${span}`);
  next.chromium.cases[0] = second;
  next.chromium.cases[1] = first;
  console.log(
    `reorder ${first.sound} ${first.root} ${first.mode} with ${second.sound} ${second.root} ${second.mode}, prediction span ${span}`,
  );
  assert.equal(headroomFixtureChanged(baseline, next), true);
});

void test('formatHeadroomFixture matches the committed headroom fixture', () => {
  const parsed = load();
  assert.equal(formatHeadroomFixture(parsed), committed);
  const pretty = `${JSON.stringify(parsed, null, 2)}\n`;
  assert.notEqual(pretty, committed);
  assert.match(committed, /"noteShifts": \[0, -0\.016\]/);
  assert.match(pretty, /"noteShifts": \[\n/);
});

void test('the nightly script restores a regenerated fixture and rewrites a real change in the committed style', () => {
  const directory = mkdtempSync(join(tmpdir(), 'headroom-fixture-'));
  const relative = 'tests/fixtures/headroom-worst.json';
  try {
    const target = join(directory, relative);
    mkdirSync(join(directory, 'tests/fixtures'), { recursive: true });
    writeFileSync(target, committed);
    execFileSync('git', ['init', '-b', 'main'], {
      cwd: directory,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', relative], { cwd: directory, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=test@example.com',
        '-c',
        'user.name=Test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'init',
      ],
      { cwd: directory, stdio: 'ignore' },
    );

    const regenerated = structuredClone(load());
    regenerated.chromium.seconds += 500;
    regenerated.firefox.seconds = 3;
    noiseFloats(regenerated);
    reverseNearTies(regenerated.chromium.cases);
    reverseNearTies(regenerated.firefox.cases);
    writeFileSync(target, `${JSON.stringify(regenerated, null, 2)}\n`);
    const unchanged = execFileSync(
      process.execPath,
      ['--experimental-strip-types', scriptPath, relative],
      { cwd: directory, encoding: 'utf8' },
    ).trim();
    console.log(`script regenerated fixture: ${unchanged}`);
    assert.equal(unchanged, 'changed=false');
    assert.equal(readFileSync(target, 'utf8'), committed);

    const changed = structuredClone(load());
    const item = loudest(changed);
    const before = item.confirmed;
    item.confirmed = nudgeOver(before);
    writeFileSync(target, `${JSON.stringify(changed, null, 2)}\n`);
    const updated = execFileSync(
      process.execPath,
      ['--experimental-strip-types', scriptPath, relative],
      { cwd: directory, encoding: 'utf8' },
    ).trim();
    const written = readFileSync(target, 'utf8');
    console.log(
      `script real change: ${updated}, confirmed ${before} -> ${item.confirmed}, compact noteShifts ${written.includes('"noteShifts": [0, -0.016]')}`,
    );
    assert.equal(updated, 'changed=true');
    assert.equal(written, formatHeadroomFixture(changed));
    assert.match(written, /"noteShifts": \[0, -0\.016\]/);
    assert.doesNotMatch(written, /"noteShifts": \[\n/);
    assert.notEqual(written, committed);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

type WorstCase = HeadroomFixture['chromium']['cases'][number];

/** Identity used to replay the chromium rows that moved in pull request 41. */
function pull41Key(item: WorstCase): string {
  return [
    item.sound,
    item.root,
    item.mode,
    item.via,
    item.from,
    item.fromRoot,
    item.kind,
    String(item.index),
  ].join('|');
}

/**
 * Chromium rows from closed pull request 41 (run 39122869154, commit
 * e1e2469) measured against the fixture on main. Firefox cases were identical.
 * Deltas are prediction, then confirmed. The one noteShifts entry is the
 * new grid point.
 */
const pull41ChromiumDrift: ReadonlyArray<
  | readonly [string, number, number]
  | readonly [string, number, number, readonly number[]]
> = [
  ['reed|A|aeolian|sustain||A|pair|1', 1.4901161193847656e-8, 0],
  ['reed|Ab|mixolydian|sustain||Ab|triple|14', 1.4901161193847656e-8, 0],
  ['reed|F#|lydian|sustain||F#|pair|1', -1.4901161193847656e-8, 0],
  [
    'reed|F#|lydian|key-change|reed|G|pair|1',
    1.4901161193847656e-8,
    1.1920928955078125e-7,
  ],
  ['reed|F#|lydian|sound-switch|cello|F#|pair|1', 1.4901161193847656e-8, 0],
  [
    'reed|F#|lydian|sound-switch|bow|F#|pair|1',
    0,
    1.1920928955078125e-7,
  ],
  [
    'reed|C|locrian|sound-switch|bow|C|pair|5',
    -7.450580596923828e-9,
    0,
    [-0.02, -0.012],
  ],
  ['reed|B|locrian|sound-switch|cello|B|pair|1', -3.725290298461914e-8, 0],
  ['bow|F#|lydian|sound-switch|reed|F#|pair|1', -(2 ** -25), 0],
  ['bow|F#|lydian|key-change|bow|G|pair|1', 1.4901161193847656e-8, 0],
  ['bow|F#|lydian|sound-switch|cello|F#|pair|1', 1.4901161193847656e-8, 0],
  ['bow|Ab|mixolydian|sustain||Ab|triple|14', 1.4901161193847656e-8, 0],
  ['bow|Ab|mixolydian|key-change|bow|A|triple|14', 5.960464477539063e-8, 0],
  [
    'bow|Ab|mixolydian|sound-switch|cello|Ab|triple|14',
    -1.4901161193847656e-8,
    0,
  ],
  ['bow|B|locrian|sound-switch|cello|B|pair|1', -1.4901161193847656e-8, 0],
  ['bow|C#|ionian|key-change|bow|D|pair|12', 1.4901161193847656e-8, 0],
  [
    'bow|Ab|mixolydian|sound-switch|reed|Ab|triple|14',
    -1.4901161193847656e-8,
    0,
  ],
  ['bow|F#|lydian|sustain||F#|pair|1', -2.2351741790771484e-8, 0],
  ['cello|C|locrian|sustain||C|pair|11', -1.4901161193847656e-8, 0],
  ['cello|C|ionian|sustain||C|triple|10', 1.4901161193847656e-8, 0],
  [
    'cello|B|locrian|sustain||B|pair|1',
    -(2 ** -25),
    1.1920928955078125e-7,
  ],
  ['cello|C#|ionian|sustain||C#|pair|12', 1.4901161193847656e-8, 0],
  [
    'cello|Ab|mixolydian|sound-switch|reed|Ab|triple|14',
    7.450580596923828e-9,
    0,
  ],
  [
    'cello|D|dorian|key-change|cello|Eb|triple|11',
    -7.450580596923828e-9,
    0,
  ],
  [
    'cello|D|dorian|sound-switch|bow|D|triple|11',
    7.450580596923828e-9,
    0,
  ],
  [
    'cello|D|dorian|sound-switch|reed|D|triple|11',
    2.2351741790771484e-8,
    0,
  ],
];

/** Rebuild the fixture pull request 41 would have committed, on top of main. */
function applyPullRequest41(fixture: HeadroomFixture): void {
  fixture.chromium.seconds = 1040.7233;
  fixture.firefox.seconds = 536.982;
  const byKey = new Map(
    fixture.chromium.cases.map((item) => [pull41Key(item), item]),
  );
  for (const row of pull41ChromiumDrift) {
    const [key, predictionDelta, confirmedDelta] = row;
    const item = byKey.get(key);
    if (!item) throw new Error(`missing pull request 41 case ${key}`);
    item.prediction += predictionDelta;
    item.confirmed += confirmedDelta;
    const noteShifts = row[3];
    if (noteShifts) item.noteShifts = [...noteShifts];
  }
  const cases = fixture.chromium.cases;
  const from = cases.findIndex(
    (item) => pull41Key(item) === 'cello|D|dorian|key-change|cello|Eb|triple|11',
  );
  const to = cases.findIndex(
    (item) => pull41Key(item) === 'cello|D|dorian|sound-switch|reed|D|triple|11',
  );
  const left = cases[from];
  const right = cases[to];
  if (from < 0 || to < 0 || !left || !right) {
    throw new Error('missing the D dorian cello tie from pull request 41');
  }
  cases[from] = right;
  cases[to] = left;
}

function matchedPeakDrift(
  baseline: HeadroomFixture,
  candidate: HeadroomFixture,
): { prediction: number; confirmed: number } {
  let prediction = 0;
  let confirmed = 0;
  for (const name of ['chromium', 'firefox'] as const) {
    const byKey = new Map(
      candidate[name].cases.map((item) => [pull41Key(item), item]),
    );
    for (const item of baseline[name].cases) {
      const other = byKey.get(pull41Key(item));
      if (!other) throw new Error(`missing ${name} ${pull41Key(item)}`);
      prediction = Math.max(prediction, Math.abs(item.prediction - other.prediction));
      confirmed = Math.max(confirmed, Math.abs(item.confirmed - other.confirmed));
    }
  }
  return { prediction, confirmed };
}

function reedLocrianBow(fixture: HeadroomFixture): WorstCase {
  const item = fixture.chromium.cases.find(
    (candidate) => pull41Key(candidate) === 'reed|C|locrian|sound-switch|bow|C|pair|5',
  );
  if (!item) throw new Error('missing reed C locrian');
  return item;
}

function withFixtureRepo(body: (directory: string, relative: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'headroom-fixture-'));
  const relative = 'tests/fixtures/headroom-worst.json';
  try {
    mkdirSync(join(directory, 'tests/fixtures'), { recursive: true });
    writeFileSync(join(directory, relative), committed);
    execFileSync('git', ['init', '-b', 'main'], {
      cwd: directory,
      stdio: 'ignore',
    });
    execFileSync('git', ['add', relative], { cwd: directory, stdio: 'ignore' });
    execFileSync(
      'git',
      [
        '-c',
        'user.email=test@example.com',
        '-c',
        'user.name=Test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '-m',
        'init',
      ],
      { cwd: directory, stdio: 'ignore' },
    );
    body(directory, relative);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function runFixtureScript(directory: string, relative: string): string {
  return execFileSync(
    process.execPath,
    ['--experimental-strip-types', scriptPath, relative],
    { cwd: directory, encoding: 'utf8' },
  ).trim();
}

void test('pull request 41 seconds, float drift, and a timing-grid note shift are unchanged', () => {
  const step = TIMING_OFFSETS[1];
  const origin = TIMING_OFFSETS[0];
  if (step === undefined || origin === undefined) {
    throw new Error('timing grid is missing its first step');
  }
  assert.equal(HEADROOM_TIMING_STEP, step - origin);
  const baseline = load();
  const next = structuredClone(baseline);
  applyPullRequest41(next);
  const drift = matchedPeakDrift(baseline, next);
  const shifted = reedLocrianBow(next);
  assert.deepEqual(shifted.noteShifts, [-0.02, -0.012]);
  assert.deepEqual(next.firefox.cases, baseline.firefox.cases);
  assert.equal(next.sources, baseline.sources);
  assert.equal(next.chromium.seconds, 1040.7233);
  assert.equal(next.firefox.seconds, 536.982);
  const keyChange = 'cello|D|dorian|key-change|cello|Eb|triple|11';
  const fromReed = 'cello|D|dorian|sound-switch|reed|D|triple|11';
  const at = (cases: readonly WorstCase[], key: string) =>
    cases.findIndex((item) => pull41Key(item) === key);
  assert.ok(at(baseline.chromium.cases, keyChange) < at(baseline.chromium.cases, fromReed));
  assert.ok(at(next.chromium.cases, keyChange) > at(next.chromium.cases, fromReed));
  assert.equal(drift.prediction, 5.960464477539063e-8);
  assert.equal(drift.confirmed, 1.1920928955078125e-7);
  assert.ok(drift.prediction < HEADROOM_FLOAT_TOLERANCE);
  assert.ok(drift.confirmed < HEADROOM_FLOAT_TOLERANCE);
  console.log(
    `pull request 41 seconds ${baseline.chromium.seconds} -> ${next.chromium.seconds}, prediction drift ${drift.prediction}, confirmed drift ${drift.confirmed}, noteShift [-0.02, -0.02] -> [-0.02, -0.012]`,
  );
  assert.equal(headroomFixtureChanged(baseline, next), false);

  withFixtureRepo((directory, relative) => {
    writeFileSync(
      join(directory, relative),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    const output = runFixtureScript(directory, relative);
    console.log(`script pull request 41: ${output}`);
    assert.equal(output, 'changed=false');
    assert.equal(readFileSync(join(directory, relative), 'utf8'), committed);
  });
});

void test('a confirmed value moving past 1e-6 is still a change when the same drift is present', () => {
  const baseline = load();
  const drifted = structuredClone(baseline);
  applyPullRequest41(drifted);
  assert.equal(headroomFixtureChanged(baseline, drifted), false);

  const next = structuredClone(drifted);
  const item = reedLocrianBow(next);
  const before = item.confirmed;
  item.confirmed = nudgeOver(before);
  const delta = Math.abs(item.confirmed - before);
  console.log(
    `pull request 41 drift plus confirmed ${before} -> ${item.confirmed} delta ${delta}`,
  );
  assert.ok(delta > HEADROOM_FLOAT_TOLERANCE);
  assert.equal(headroomFixtureChanged(baseline, next), true);

  withFixtureRepo((directory, relative) => {
    writeFileSync(
      join(directory, relative),
      `${JSON.stringify(next, null, 2)}\n`,
    );
    const output = runFixtureScript(directory, relative);
    const written = readFileSync(join(directory, relative), 'utf8');
    console.log(`script real headroom change: ${output}`);
    assert.equal(output, 'changed=true');
    assert.equal(written, formatHeadroomFixture(next));
    assert.match(written, /"noteShifts": \[-0\.02, -0\.012\]/);
    assert.match(written, /"seconds": 1040\.7233/);
    assert.notEqual(written, committed);
  });
});

void test('one timing-grid step stays quiet at a 1e-6 peak delta and is a change just past it', () => {
  const baseline = load();
  const original = reedLocrianBow(baseline);
  const beforeShift = original.noteShifts[1];
  const beforeConfirmed = original.confirmed;
  const beforeChord = original.chordShift;
  if (beforeShift === undefined) throw new Error('missing note shift');

  const atBoundary = structuredClone(baseline);
  const atItem = reedLocrianBow(atBoundary);
  atItem.noteShifts[1] = beforeShift + HEADROOM_TIMING_STEP;
  atItem.confirmed = nudgeWithin(beforeConfirmed);
  const atDelta = Math.abs(atItem.confirmed - beforeConfirmed);
  assert.equal(atItem.noteShifts[1], -0.016);
  assert.ok(atDelta <= HEADROOM_FLOAT_TOLERANCE && atDelta > 0.99e-6);
  console.log(
    `grid step ${beforeShift} -> ${atItem.noteShifts[1]} with confirmed delta ${atDelta}`,
  );
  assert.equal(headroomFixtureChanged(baseline, atBoundary), false);

  const past = structuredClone(baseline);
  const pastItem = reedLocrianBow(past);
  pastItem.noteShifts[1] = beforeShift + HEADROOM_TIMING_STEP;
  pastItem.confirmed = nudgeOver(beforeConfirmed);
  const pastDelta = Math.abs(pastItem.confirmed - beforeConfirmed);
  assert.ok(pastDelta > HEADROOM_FLOAT_TOLERANCE);
  console.log(`same grid step with confirmed delta ${pastDelta}`);
  assert.equal(headroomFixtureChanged(baseline, past), true);

  const dust = structuredClone(baseline);
  const dustItem = reedLocrianBow(dust);
  dustItem.noteShifts[1] = beforeShift + HEADROOM_FLOAT_TOLERANCE * 2;
  const dustDelta = Math.abs(dustItem.noteShifts[1] - beforeShift);
  assert.ok(dustDelta > HEADROOM_FLOAT_TOLERANCE);
  assert.notEqual(
    Math.abs((dustItem.noteShifts[1] ?? 0) / HEADROOM_TIMING_STEP) % 1,
    0,
  );
  console.log(`off-grid note shift delta ${dustDelta}`);
  assert.equal(headroomFixtureChanged(baseline, dust), true);

  const chord = structuredClone(baseline);
  const chordItem = reedLocrianBow(chord);
  chordItem.chordShift = beforeChord + HEADROOM_TIMING_STEP;
  assert.equal(chordItem.chordShift, 0);
  assert.equal(chordItem.prediction, original.prediction);
  assert.equal(chordItem.confirmed, original.confirmed);
  console.log(`chord grid step ${beforeChord} -> ${chordItem.chordShift}`);
  assert.equal(headroomFixtureChanged(baseline, chord), false);
});

void test('a four-step grid move is quiet and a longer alignment change is not', () => {
  assert.equal(HEADROOM_OFFSET_STEP_LIMIT, 4);
  const baseline = load();
  for (const sweep of [baseline.chromium, baseline.firefox]) {
    for (const item of sweep.cases) {
      for (const shift of item.noteShifts) {
        assert.ok(TIMING_OFFSETS.includes(shift), `${shift} is off the timing grid`);
      }
      assert.ok(
        TIMING_OFFSETS.includes(item.chordShift),
        `${item.chordShift} is off the timing grid`,
      );
    }
  }
  const original = reedLocrianBow(baseline);
  const beforeShift = original.noteShifts[1];
  const fromIndex = beforeShift === undefined ? -1 : TIMING_OFFSETS.indexOf(beforeShift);
  const withinOffset = TIMING_OFFSETS[fromIndex + HEADROOM_OFFSET_STEP_LIMIT];
  const beyondOffset = TIMING_OFFSETS[fromIndex + HEADROOM_OFFSET_STEP_LIMIT + 1];
  const farOffset = TIMING_OFFSETS[TIMING_OFFSETS.length - 1];
  if (fromIndex < 0 || withinOffset === undefined || beyondOffset === undefined || farOffset === undefined) {
    throw new Error('timing grid does not cover the step limit');
  }

  const within = structuredClone(baseline);
  reedLocrianBow(within).noteShifts[1] = withinOffset;
  console.log(`quiet grid move ${beforeShift} -> ${withinOffset}`);
  assert.equal(headroomFixtureChanged(baseline, within), false);

  const beyond = structuredClone(baseline);
  reedLocrianBow(beyond).noteShifts[1] = beyondOffset;
  console.log(`grid move past the limit ${beforeShift} -> ${beyondOffset}`);
  assert.equal(headroomFixtureChanged(baseline, beyond), true);

  const far = structuredClone(baseline);
  reedLocrianBow(far).noteShifts[1] = farOffset;
  console.log(`full-window note shift ${beforeShift} -> ${farOffset}`);
  assert.equal(headroomFixtureChanged(baseline, far), true);

  const later = structuredClone(baseline);
  const zeroChord = later.chromium.cases.find((item) => item.chordShift === 0);
  if (!zeroChord) throw new Error('missing a chord shift of 0');
  zeroChord.chordShift = 1;
  console.log(`chord shift 0 -> 1 on ${zeroChord.sound} ${zeroChord.root} ${zeroChord.mode}`);
  assert.equal(headroomFixtureChanged(baseline, later), true);

  const swapped = structuredClone(baseline);
  const triple = swapped.chromium.cases.find(
    (item) => pull41Key(item) === 'bow|Ab|mixolydian|sound-switch|cello|Ab|triple|14',
  );
  if (!triple) throw new Error('missing the bow Ab mixolydian triple');
  assert.deepEqual(triple.noteShifts, [-0.016, 0.016, -0.02]);
  triple.noteShifts = [0.016, -0.016, -0.02];
  console.log('swapped the first two note shifts of bow Ab mixolydian');
  assert.equal(headroomFixtureChanged(baseline, swapped), true);

  const prediction = structuredClone(baseline);
  const predItem = reedLocrianBow(prediction);
  const oneStep = TIMING_OFFSETS[fromIndex + 1];
  if (oneStep === undefined) throw new Error('missing the next grid point');
  predItem.noteShifts[1] = oneStep;
  const beforePrediction = predItem.prediction;
  predItem.prediction = nudgeOver(beforePrediction);
  assert.equal(predItem.confirmed, original.confirmed);
  console.log(
    `one grid step plus prediction ${beforePrediction} -> ${predItem.prediction}`,
  );
  assert.equal(headroomFixtureChanged(baseline, prediction), true);
});

void test('the nightly workflow compares parsed fixtures instead of git diff --quiet', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/headroom-nightly.yml', import.meta.url),
    'utf8',
  );
  assert.match(
    workflow,
    /node --experimental-strip-types scripts\/headroom-fixture-changed\.ts tests\/fixtures\/headroom-worst\.json/,
  );
  assert.doesNotMatch(
    workflow,
    /git diff --quiet -- tests\/fixtures\/headroom-worst\.json/,
  );
});
