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
import {
  HEADROOM_FLOAT_TOLERANCE,
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
