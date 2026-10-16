import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import {
  PHRASE_CELL_LIMIT,
  PHRASE_MIN_RANGE,
  PHRASE_RANGE,
  PHRASE_VARIETY_RUN,
  PHRASE_WIDE_LEAP,
  breakCircles,
  breakLoopsKeepArch,
  cadencePitchClasses,
  generatePhrase,
  melodicMotion,
  phraseCellLength,
  phraseOnsets,
  phraseRuleReport,
  type Phrase,
  type RhythmId,
} from '../lib/phrase.ts';

const CONTEXTS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['A', 'harmonic-minor', 'E7'],
  ['C', 'minor-pentatonic', 'Cm'],
  ['C', 'minor-blues', 'C7'],
  ['Bb', 'mixolydian', 'Bb7'],
];
const SEEDS = Array.from({ length: 24 }, (_, index) => index + 1);

const REGISTER_LOW = { low: 48, mid: 55, high: 64 } as const;

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/** Longest run on three note names or fewer. Octave copies share a name. */
function pcRun(midis: readonly number[]): number {
  let longest = midis.length > 0 ? 1 : 0;
  for (let start = 0; start < midis.length; start++) {
    const seen = new Set<number>();
    for (let end = start; end < midis.length; end++) {
      seen.add(pitchClass(midis[end]));
      if (seen.size > 3) break;
      longest = Math.max(longest, end - start + 1);
    }
  }
  return longest;
}

/** Longest stretch whose note names repeat every 4 notes. Twice is 8. */
function figureRun(midis: readonly number[]): number {
  let longest = 0;
  for (let from = 0; from < midis.length; from++) {
    let end = from;
    for (let index = from + 4; index < midis.length; index++) {
      if (pitchClass(midis[index]) !== pitchClass(midis[index - 4])) break;
      end = index;
    }
    if (end >= from + 4) longest = Math.max(longest, end - from + 1);
  }
  return longest;
}

/**
 * Inside the register window, or an octave copy of a pitch that sits inside
 * it. A step, a third, or any other non-octave leap has to stay inside.
 */
function assertRegister(phrase: Phrase): void {
  const low = REGISTER_LOW[phrase.plan.register];
  const high = low + PHRASE_RANGE;
  for (const note of phrase.notes) {
    if (note.midi >= low && note.midi <= high) continue;
    assert.ok(
      [note.midi - 12, note.midi + 12].some(
        (partner) => partner >= low && partner <= high,
      ),
      `${note.name}${note.midi} leaves the ${phrase.plan.register} window by a non-octave`,
    );
  }
}

function scaleOf(root: string, id: string): Note[] {
  const scale = SCALES.find((item) => item.id === id);
  assert.ok(scale, id);
  return spell(root, scale.formula);
}

function phraseFor(
  root: string,
  scaleId: string,
  symbol: string,
  seed: number,
  bars: 2 | 4,
): { phrase: Phrase; scaleNotes: Note[]; chordNotes: Note[] } {
  const scaleNotes = scaleOf(root, scaleId);
  const chordNotes = parseChord(symbol).notes;
  const result = generatePhrase({ seed, bars, scaleNotes, chordNotes });
  assert.equal(result.ok, true, `${symbol} ${scaleId} seed ${seed}`);
  if (!result.ok) throw new Error('unreachable');
  return { phrase: result.phrase, scaleNotes, chordNotes };
}

void test('a two-pitch cell is stuck once it sounds a fifth time', () => {
  assert.equal(PHRASE_CELL_LIMIT, 4);
  assert.equal(PHRASE_MIN_RANGE, 5);
  assert.equal(PHRASE_WIDE_LEAP, 7);
  assert.equal(phraseCellLength([67, 69, 67, 69]), 4);
  assert.equal(phraseCellLength([67, 69, 67, 69, 67]), 5);
  assert.equal(phraseCellLength([60, 62, 64, 65, 67]), 2);
});

/**
 * Quarter notes, cadence on the lowest chord tone in the register.
 * The only scale step into that pitch is one neighbor, so every strong
 * beat is forced back onto it. Leaving would need a new onset or a leap
 * onto the strong beat. These eight phrases stay loops. Every other
 * corpus phrase has to move by the fifth note of a cell.
 */
const GRID_TRAPS: readonly (readonly [string, string, string, number])[] = [
  ['C', 'major', 'C', 1],
  ['A', 'dorian', 'Am', 7],
  ['C', 'minor-pentatonic', 'Cm', 22],
  ['C', 'minor-blues', 'C7', 22],
];

function isGridTrap(
  root: string,
  scaleId: string,
  symbol: string,
  seed: number,
): boolean {
  return GRID_TRAPS.some(
    ([trapRoot, trapScale, trapSymbol, trapSeed]) =>
      trapRoot === root &&
      trapScale === scaleId &&
      trapSymbol === symbol &&
      trapSeed === seed,
  );
}

void test('a cadence on the bottom of the register can stay a two-note loop', () => {
  for (const [root, scaleId, symbol, seed] of GRID_TRAPS) {
    for (const bars of [2, 4] as const) {
      const { phrase } = phraseFor(root, scaleId, symbol, seed, bars);
      assert.equal(phrase.plan.rhythm, 'quarters');
      assert.deepEqual(
        phrase.notes.map((note) => note.beat),
        phraseOnsets('quarters', bars),
        `${symbol} ${scaleId} seed ${seed}`,
      );
      const cell = phraseCellLength(phrase.notes.map((note) => note.midi));
      assert.ok(cell > PHRASE_CELL_LIMIT, `${symbol} seed ${seed} ${bars}`);
      const pitches = new Set(phrase.notes.map((note) => note.midi));
      assert.equal(pitches.size, 2);
    }
  }
  const { phrase } = phraseFor('C', 'major', 'C', 1, 2);
  assert.deepEqual(
    phrase.notes.map((note) => `${note.name}${note.midi}@${note.beat}`),
    [
      'G55@0',
      'A57@1',
      'G55@2',
      'A57@3',
      'G55@4',
      'A57@5',
      'G55@6',
      'A57@7',
      'G55@8',
    ],
  );
});

void test('A minor blues over E7 breaks the two-note cell on the existing grid', () => {
  for (const seed of [1, 3, 6, 11, 17]) {
    for (const bars of [2, 4] as const) {
      const { phrase } = phraseFor('A', 'minor-blues', 'E7', seed, bars);
      assert.deepEqual(
        phrase.notes.map((note) => note.beat),
        phraseOnsets(phrase.plan.rhythm, bars),
        `seed ${seed} ${bars}`,
      );
      assert.ok(
        phraseCellLength(phrase.notes.map((note) => note.midi)) <=
          PHRASE_CELL_LIMIT,
        `seed ${seed} bars ${bars} ${phrase.notes.map((note) => note.name).join('')}`,
      );
    }
  }
  const { phrase } = phraseFor('A', 'minor-blues', 'E7', 1, 4);
  assert.equal(phrase.plan.rhythm, 'quarters');
  const midis = phrase.notes.map((note) => note.midi);
  assert.ok(phraseCellLength(midis) <= PHRASE_CELL_LIMIT);
  assert.equal(new Set(midis).size > 2, true);
  // The fall was under its plan. One weak beat steps Eb into D instead of
  // leaping from E down to C, which lifts the first third.
  assert.deepEqual(
    phrase.notes.map((note) => `${note.name}${note.midi}@${note.beat}`),
    [
      'E64@0',
      'G67@1',
      'E64@2',
      'Eb63@3',
      'D62@4',
      'G67@5',
      'E64@6',
      'C60@7',
      'D62@8',
      'C60@9',
      'D62@10',
      'Eb63@11',
      'E64@12',
      'Eb63@13',
      'D62@14',
      'G67@15',
      'E64@16',
    ],
  );
});

void test('an arch over the IV keeps its highest note', () => {
  const cases = [
    ['D', 'major', 'G', 7, 81, 'A'],
    ['Bb', 'major', 'Eb', 8, 65, 'F'],
  ] as const;
  for (const [root, scaleId, symbol, seed, peak, name] of cases) {
    const { phrase } = phraseFor(root, scaleId, symbol, seed, 4);
    assert.equal(phrase.plan.contour, 'arch', `${symbol} seed ${seed}`);
    assert.deepEqual(
      phrase.notes.map((note) => note.beat),
      phraseOnsets(phrase.plan.rhythm, 4),
    );
    const highest = Math.max(...phrase.notes.map((note) => note.midi));
    assert.equal(highest, peak, `${symbol} seed ${seed}`);
    assert.equal(
      phrase.notes.some((note) => note.midi === peak && note.name === name),
      true,
    );
  }
});

void test('the corpus keeps the musical checks on every seed', () => {
  let wide = 0;
  let moves = 0;
  for (const [root, scaleId, symbol] of CONTEXTS) {
    for (const bars of [2, 4] as const) {
      for (const seed of SEEDS) {
        const { phrase, scaleNotes, chordNotes } = phraseFor(
          root,
          scaleId,
          symbol,
          seed,
          bars,
        );
        const again = generatePhrase({
          seed,
          bars,
          scaleNotes,
          chordNotes,
        });
        assert.equal(again.ok, true);
        if (again.ok) assert.deepEqual(again.phrase.notes, phrase.notes);

        const scalePcs = new Set(scaleNotes.map((note) => note.pc));
        const report = phraseRuleReport(phrase, scaleNotes, chordNotes);
        assert.equal(report.unresolved, 0, `${symbol} ${seed}`);
        assert.equal(report.cadenceHit, true);
        assert.equal(report.unisons, 0);
        assertRegister(phrase);
        const trapped = isGridTrap(root, scaleId, symbol, seed);
        const cell = phraseCellLength(phrase.notes.map((note) => note.midi));
        if (trapped) {
          assert.ok(cell > PHRASE_CELL_LIMIT);
          assert.ok(report.range < PHRASE_MIN_RANGE);
        } else {
          assert.ok(
            report.range >= PHRASE_MIN_RANGE,
            `${symbol} ${scaleId} seed ${seed} spans ${report.range}`,
          );
          assert.ok(
            cell <= PHRASE_CELL_LIMIT,
            `${symbol} ${scaleId} seed ${seed} ${bars} cell ${cell}`,
          );
        }
        assert.deepEqual(
          phrase.notes.map((note) => note.beat),
          phraseOnsets(phrase.plan.rhythm, bars),
        );

        const roles = cadencePitchClasses(
          chordNotes,
          phrase.plan.cadence,
          scalePcs,
        );
        const last = phrase.notes.at(-1);
        assert.ok(last);
        assert.equal(roles.includes(last.pc), true);
        assert.equal(last.duration, 2);
        const before = phrase.notes.at(-2);
        assert.ok(before);
        assert.equal(
          melodicMotion(before.midi, last.midi, scalePcs),
          'step',
          `${symbol} seed ${seed} cadence approach`,
        );

        for (let index = 1; index < phrase.notes.length; index++) {
          const previous = phrase.notes[index - 1];
          const note = phrase.notes[index];
          const motion = melodicMotion(previous.midi, note.midi, scalePcs);
          moves += 1;
          if (note.strong) {
            assert.equal(note.chordTone, true);
            assert.equal(
              motion,
              'step',
              `${symbol} seed ${seed} beat ${note.beat}`,
            );
          }
          if (motion !== 'leap') continue;
          if (Math.abs(note.midi - previous.midi) >= PHRASE_WIDE_LEAP)
            wide += 1;
          const next = phrase.notes[index + 1];
          assert.ok(next, `${symbol} seed ${seed} leap at ${note.beat}`);
          const resolution = melodicMotion(note.midi, next.midi, scalePcs);
          const opposite =
            Math.sign(next.midi - note.midi) ===
            -Math.sign(note.midi - previous.midi);
          assert.equal(resolution, 'step');
          assert.equal(opposite, true);
        }
        for (const note of phrase.notes) {
          if (!note.strong) continue;
          assert.equal(note.chordTone, true);
        }
      }
    }
  }
  // Fifths still show up when a gap cannot hold the steps. They are
  // the minority of the motion, not the habit.
  assert.ok(wide / moves < 0.08, `wide leaps ${wide} of ${moves}`);
});

const MAIN_PHRASE = '00a5de376e061a16d6ae8a09076ea2e807cd31b3';
const RHYTHMS: readonly RhythmId[] = [
  'quarters',
  'eighths',
  'long-short',
  'push',
];
const SWEEP_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'Eb'] as const;
const SWEEP_SCALES = [
  'major',
  'dorian',
  'mixolydian',
  'minor',
  'minor-blues',
  'minor-pentatonic',
  'harmonic-minor',
] as const;
const FIFTH: Record<string, string> = {
  C: 'G',
  D: 'A',
  E: 'B',
  F: 'C',
  G: 'D',
  A: 'E',
  Bb: 'F',
  Eb: 'Bb',
};
const FOURTH: Record<string, string> = {
  C: 'F',
  D: 'G',
  E: 'A',
  F: 'Bb',
  G: 'C',
  A: 'D',
  Bb: 'Eb',
  Eb: 'Ab',
};

function sweepSymbols(root: string, scaleId: string): string[] {
  if (scaleId === 'major') return [root, FOURTH[root]];
  if (scaleId === 'mixolydian') return [`${root}7`, FOURTH[root]];
  if (scaleId === 'minor-blues') return [`${root}m7`, `${FIFTH[root]}7`];
  return [`${root}m`, `${FIFTH[root]}7`];
}

function baselinePhraseSource(): string {
  const spec = `${MAIN_PHRASE}:lib/phrase.ts`;
  const show = () => execFileSync('git', ['show', spec], { encoding: 'utf8' });
  try {
    return show();
  } catch {
    // CI checks out the pull request with a shallow history, so main's
    // commit is not in the local object store until it is fetched.
    execFileSync('git', ['fetch', '--depth=1', 'origin', MAIN_PHRASE], {
      timeout: 60_000,
    });
    return show();
  }
}

async function mainGenerator(): Promise<{
  generatePhrase: typeof generatePhrase;
}> {
  const source = baselinePhraseSource();
  const music = pathToFileURL(join(process.cwd(), 'lib/music.ts')).href;
  const marks = pathToFileURL(join(process.cwd(), 'lib/phrase-marks.ts')).href;
  const rewritten = source
    .replaceAll("from './music.ts'", `from '${music}'`)
    .replaceAll("from './phrase-marks.ts'", `from '${marks}'`);
  const dir = mkdtempSync(join(tmpdir(), 'phrase-main-rules-'));
  const file = join(dir, 'phrase.ts');
  writeFileSync(file, rewritten);
  try {
    return (await import(pathToFileURL(file).href)) as {
      generatePhrase: typeof generatePhrase;
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void test('shaping keeps every rhythm grid, including locks and progressions', async () => {
  const main = await mainGenerator();
  const seeds = Array.from({ length: 12 }, (_, index) => index + 1);
  let count = 0;
  for (const root of SWEEP_ROOTS) {
    for (const scaleId of SWEEP_SCALES) {
      const scaleNotes = scaleOf(root, scaleId);
      for (const symbol of sweepSymbols(root, scaleId)) {
        const chordNotes = parseChord(symbol).notes;
        for (const bars of [2, 4] as const) {
          for (const seed of seeds) {
            const locked: (RhythmId | undefined)[] = [undefined, ...RHYTHMS];
            for (const rhythm of locked) {
              const input = {
                seed,
                bars,
                scaleNotes,
                chordNotes,
                locks: rhythm ? { rhythm } : undefined,
              };
              const ours = generatePhrase(input);
              const theirs = main.generatePhrase(input);
              assert.equal(
                ours.ok,
                theirs.ok,
                `${root} ${scaleId} ${symbol} seed ${seed}`,
              );
              if (!ours.ok || !theirs.ok) continue;
              if (rhythm) assert.equal(ours.phrase.plan.rhythm, rhythm);
              const beats = ours.phrase.notes.map((note) => note.beat);
              const durations = ours.phrase.notes.map((note) => note.duration);
              assert.deepEqual(
                beats,
                theirs.phrase.notes.map((note) => note.beat),
                `${symbol} ${scaleId} seed ${seed} ${rhythm ?? 'free'} beats`,
              );
              assert.deepEqual(
                durations,
                theirs.phrase.notes.map((note) => note.duration),
              );
              assert.deepEqual(
                beats,
                phraseOnsets(ours.phrase.plan.rhythm, bars),
              );
              count += 1;
            }
          }
        }
      }
    }
  }
  console.log(
    `grid sweep ${count} phrases, 0 off the plan onsets and durations`,
  );
  assert.ok(count >= 8000, `sweep covered ${count} phrases`);
});

function thirdMeans(midis: readonly number[]): [number, number, number] {
  const third = Math.max(1, Math.floor(midis.length / 3));
  const mean = (slice: readonly number[]) =>
    slice.reduce((sum, midi) => sum + midi, 0) / slice.length;
  return [
    mean(midis.slice(0, third)),
    mean(midis.slice(third, third * 2)),
    mean(midis.slice(third * 2)),
  ];
}

function phraseCircles(midis: readonly number[]): boolean {
  for (let start = 0; start < midis.length; start++) {
    const seen = new Set<number>([midis[start]]);
    for (let end = start + 1; end < midis.length; end++) {
      if (end - start >= 3 && midis[end] !== midis[end - 3]) break;
      seen.add(midis[end]);
      if (seen.size > 3) break;
      if (Math.max(...seen) - Math.min(...seen) > 4) break;
      if (end - start + 1 > 4 && seen.size === 3) return true;
    }
  }
  return false;
}

void test('an arch repair keeps the middle third above both ends', () => {
  const { phrase } = phraseFor('C', 'dorian', 'G7', 8, 4);
  assert.equal(phrase.plan.contour, 'arch');
  assert.equal(phrase.plan.rhythm, 'long-short');
  assert.deepEqual(
    phrase.notes.map((note) => note.beat),
    phraseOnsets('long-short', 4),
  );
  const midis = phrase.notes.map((note) => note.midi);
  const [first, middle, last] = thirdMeans(midis);
  assert.ok(middle > first && middle > last);
  assert.equal(Math.max(...midis), 57);
  assert.ok(phraseCellLength(midis) <= PHRASE_CELL_LIMIT);
  assert.deepEqual(
    phrase.notes.map((note) => `${note.name}${note.midi}@${note.beat}`),
    [
      'D50@0',
      'A57@1.5',
      'G55@2',
      'F53@3.5',
      'G55@4',
      'A57@5.5',
      'G55@6',
      'Eb51@7.5',
      'F53@8',
      'A57@9.5',
      'G55@10',
      'F53@11.5',
      'G55@12',
      'Eb51@13.5',
      'F53@14',
      'C48@15.5',
      'D50@16',
    ],
  );
});

void test('a landing arch that uses a third pitch has no two-pitch cell past four notes', () => {
  let floorLoops = 0;
  for (const root of SWEEP_ROOTS) {
    for (const scaleId of SWEEP_SCALES) {
      const scaleNotes = scaleOf(root, scaleId);
      for (const symbol of sweepSymbols(root, scaleId)) {
        const chordNotes = parseChord(symbol).notes;
        for (const bars of [2, 4] as const) {
          for (let seed = 1; seed <= 12; seed++) {
            const phrase = generatePhrase({
              seed,
              bars,
              scaleNotes,
              chordNotes,
            });
            assert.equal(phrase.ok, true);
            if (!phrase.ok || phrase.phrase.plan.contour !== 'arch') continue;
            const midis = phrase.phrase.notes.map((note) => note.midi);
            const [first, middle, last] = thirdMeans(midis);
            if (!(middle > first && middle > last)) continue;
            const cell = phraseCellLength(midis);
            if (cell <= PHRASE_CELL_LIMIT) continue;
            const id = `${root} ${scaleId} ${symbol} seed ${seed} bars ${bars}`;
            assert.equal(
              new Set(midis).size,
              2,
              `${id} lands with a cell of ${cell} and another pitch`,
            );
            floorLoops += 1;
          }
        }
      }
    }
  }
  // These 44 are the whole phrase: two adjacent pitches on the register
  // floor. The cadence is the lowest chord tone, and the only scale step
  // into it is one neighbor, so the strong-beat rule keeps the cell.
  assert.equal(floorLoops, 44);

  const { phrase } = phraseFor('C', 'minor-pentatonic', 'G7', 7, 4);
  assert.equal(phrase.plan.contour, 'arch');
  assert.equal(phrase.plan.rhythm, 'quarters');
  assert.deepEqual(
    phrase.notes.map((note) => note.beat),
    phraseOnsets('quarters', 4),
  );
  const midis = phrase.notes.map((note) => note.midi);
  const [first, middle, last] = thirdMeans(midis);
  assert.ok(middle > first && middle > last);
  assert.equal(Math.max(...midis), 82);
  assert.ok(phraseCellLength(midis) <= PHRASE_CELL_LIMIT);
  const names = new Set(phrase.notes.map((note) => note.name));
  assert.ok(names.size > 3, `seed 7 names ${[...names].join(' ')}`);
  assert.equal(names.has('Eb'), true);
  for (let index = 1; index < midis.length; index++) {
    const gap = Math.abs(midis[index] - midis[index - 1]);
    assert.ok(gap !== 14 && gap !== 15, `seed 7 leaps ${gap}`);
  }
  assert.ok(pcRun(midis) <= PHRASE_VARIETY_RUN);
  assert.ok(figureRun(midis) < 12);
  assert.equal(phrase.notes.at(-1)?.midi, 67);
  assert.equal(phrase.notes.at(-1)?.duration, 2);
  const low = REGISTER_LOW.high;
  for (const midi of midis) {
    assert.ok(midi >= low && midi <= low + PHRASE_RANGE);
  }
  assert.deepEqual(
    phrase.notes.map((note) => `${note.name}${note.midi}@${note.beat}`),
    [
      'F65@0',
      'Bb70@1',
      'G67@2',
      'G79@3',
      'F77@4',
      'Eb75@5',
      'F77@6',
      'Bb82@7',
      'G79@8',
      'Eb75@9',
      'F77@10',
      'Bb82@11',
      'G79@12',
      'Eb75@13',
      'F77@14',
      'F65@15',
      'G67@16',
    ],
  );
});

void test('an eighth-note circle gives up one pitch on the existing grid', () => {
  const { phrase } = phraseFor('A', 'dorian', 'Am', 2, 4);
  assert.equal(phrase.plan.rhythm, 'eighths');
  assert.deepEqual(
    phrase.notes.map((note) => note.beat),
    phraseOnsets('eighths', 4),
  );
  const spelled = phrase.notes.map(
    (note) => `${note.name}${note.midi}@${note.beat}`,
  );
  assert.equal(spelled[18], 'A57@9');
  assert.equal(phraseCircles(phrase.notes.map((note) => note.midi)), false);
  assert.ok(
    phraseCellLength(phrase.notes.map((note) => note.midi)) <=
      PHRASE_CELL_LIMIT,
  );
});

void test('the arch guard and the circle break hold on the measured sets', async () => {
  const main = await mainGenerator();
  const tally = () => ({
    archHit: 0,
    arch: 0,
    circling: 0,
    loops: 0,
    changed: 0,
    eighthChanged: 0,
    onset: 0,
  });
  const fold = (
    bucket: ReturnType<typeof tally>,
    ours: Phrase,
    theirs: Phrase,
  ) => {
    if (ours.plan.contour === 'arch') {
      bucket.arch += 1;
      const [first, middle, last] = thirdMeans(
        ours.notes.map((note) => note.midi),
      );
      if (middle > first && middle > last) bucket.archHit += 1;
    }
    const midis = ours.notes.map((note) => note.midi);
    if (phraseCircles(midis)) bucket.circling += 1;
    if (phraseCellLength(midis) > PHRASE_CELL_LIMIT) bucket.loops += 1;
    const samePitch =
      midis.join(',') === theirs.notes.map((note) => note.midi).join(',');
    if (!samePitch) bucket.changed += 1;
    if (ours.plan.rhythm === 'eighths' && !samePitch) bucket.eighthChanged += 1;
    const grid = (phrase: Phrase) =>
      phrase.notes.map((note) => `${note.beat}:${note.duration}`).join(',');
    if (grid(ours) !== grid(theirs)) bucket.onset += 1;
  };
  const corpus = tally();
  for (const [root, scaleId, symbol] of CONTEXTS) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    for (const bars of [2, 4] as const) {
      for (const seed of SEEDS) {
        const input = { seed, bars, scaleNotes, chordNotes };
        const ours = generatePhrase(input);
        const theirs = main.generatePhrase(input);
        assert.equal(ours.ok, true);
        assert.equal(theirs.ok, true);
        if (ours.ok && theirs.ok) fold(corpus, ours.phrase, theirs.phrase);
      }
    }
  }
  assert.equal(corpus.onset, 0);
  assert.ok(corpus.arch > 0);
  assert.ok(
    corpus.archHit / corpus.arch >= 640 / 672,
    `corpus arches ${corpus.archHit}/${corpus.arch}`,
  );
  assert.ok(corpus.circling <= 30, `corpus circling ${corpus.circling}`);
  assert.ok(corpus.loops <= 16, `corpus loops ${corpus.loops}`);
  const progressions = tally();
  for (const root of SWEEP_ROOTS) {
    for (const scaleId of SWEEP_SCALES) {
      const scaleNotes = scaleOf(root, scaleId);
      for (const symbol of sweepSymbols(root, scaleId)) {
        const chordNotes = parseChord(symbol).notes;
        for (const bars of [2, 4] as const) {
          for (let seed = 1; seed <= 12; seed++) {
            const input = { seed, bars, scaleNotes, chordNotes };
            const ours = generatePhrase(input);
            const theirs = main.generatePhrase(input);
            assert.equal(ours.ok, true);
            assert.equal(theirs.ok, true);
            if (ours.ok && theirs.ok)
              fold(progressions, ours.phrase, theirs.phrase);
          }
        }
      }
    }
  }
  assert.equal(progressions.onset, 0);
  assert.equal(progressions.arch, 672);
  assert.ok(
    progressions.archHit >= 640,
    `arches ${progressions.archHit}/${progressions.arch}`,
  );
  assert.ok(progressions.circling <= 380, `circling ${progressions.circling}`);
  assert.ok(progressions.loops <= 92, `loops ${progressions.loops}`);
});

function majorLadder(): {
  midi: number;
  note: Note;
  chordTone: boolean;
}[] {
  const spelled = scaleOf('C', 'major');
  const byPc = new Map(spelled.map((note) => [note.pc, note]));
  const ladder: { midi: number; note: Note; chordTone: boolean }[] = [];
  for (let midi = 60; midi <= 72; midi++) {
    const note = byPc.get(((midi % 12) + 12) % 12);
    if (!note) continue;
    ladder.push({
      midi,
      note,
      chordTone: note.name === 'C' || note.name === 'E' || note.name === 'G',
    });
  }
  return ladder;
}

function grid(
  strong: readonly boolean[],
): { beat: number; duration: number; strong: boolean }[] {
  return strong.map((beatIsStrong, index) => ({
    beat: index,
    duration: index === strong.length - 1 ? 2 : 1,
    strong: beatIsStrong,
  }));
}

void test('a circle break moves a weak beat before the downbeat', () => {
  const ladder = majorLadder();
  // E and F are chord tones here so both the downbeat and a later weak
  // beat can leave the circle legally. Index order would move the downbeat.
  for (const tone of ladder) {
    if (
      tone.note.name === 'E' ||
      tone.note.name === 'F' ||
      tone.note.name === 'G'
    )
      tone.chordTone = true;
  }
  const at = (midi: number) => ladder.findIndex((tone) => tone.midi === midi);
  const indexes = [
    at(64),
    at(65),
    at(62),
    at(64),
    at(65),
    at(62),
    at(64),
    at(65),
  ];
  const events = grid([true, false, false, false, true, false, false, true]);
  const plan = {
    contour: 'rise' as const,
    rhythm: 'quarters' as const,
    register: 'mid' as const,
    cadence: 'root' as const,
  };
  const repaired = breakCircles(indexes, ladder, events, plan);
  assert.equal(repaired[0], indexes[0], 'the downbeat stays put');
  assert.notEqual(repaired[1], indexes[1]);
});

void test('a circle break keeps an arch and its highest note', () => {
  const ladder = majorLadder();
  const at = (midi: number) => ladder.findIndex((tone) => tone.midi === midi);
  const indexes = [
    at(60),
    at(62),
    at(64),
    at(62),
    at(64),
    at(65),
    at(62),
    at(64),
    at(65),
    at(62),
    at(64),
  ];
  const events = grid([
    true,
    false,
    true,
    false,
    true,
    false,
    false,
    true,
    false,
    false,
    true,
  ]);
  const plan = {
    contour: 'arch' as const,
    rhythm: 'quarters' as const,
    register: 'mid' as const,
    cadence: 'root' as const,
  };
  const repaired = breakCircles(indexes, ladder, events, plan);
  const midis = repaired.map((index) => ladder[index].midi);
  const [first, middle, last] = thirdMeans(midis);
  assert.ok(middle > first && middle > last);
  assert.equal(Math.max(...midis), 65);
  assert.ok(phraseCellLength(midis) <= PHRASE_CELL_LIMIT);
});

void test('opening a stuck cell does not add a fifth', () => {
  const ladder = majorLadder();
  const at = (midi: number) => ladder.findIndex((tone) => tone.midi === midi);
  const indexes = [
    at(67),
    at(69),
    at(67),
    at(69),
    at(67),
    at(69),
    at(67),
    at(69),
    at(67),
  ];
  const events = grid([
    true,
    false,
    true,
    false,
    true,
    false,
    true,
    false,
    true,
  ]);
  const plan = {
    contour: 'fall' as const,
    rhythm: 'quarters' as const,
    register: 'mid' as const,
    cadence: 'root' as const,
  };
  const before = indexes.map((index) => ladder[index].midi);
  const repaired = breakLoopsKeepArch(indexes, ladder, events, plan);
  const after = repaired.map((index) => ladder[index].midi);
  const wide = (midis: number[]) => {
    let count = 0;
    for (let index = 1; index < midis.length; index++) {
      if (Math.abs(midis[index] - midis[index - 1]) >= PHRASE_WIDE_LEAP)
        count += 1;
    }
    return count;
  };
  assert.ok(phraseCellLength(after) <= PHRASE_CELL_LIMIT);
  assert.ok(wide(after) <= wide(before));
});

void test('seed 8 does not repeat a four-note figure a third time', () => {
  const { phrase } = phraseFor('C', 'minor-pentatonic', 'G7', 8, 4);
  assert.equal(phrase.plan.rhythm, 'long-short');
  assert.equal(phrase.plan.contour, 'arch');
  const midis = phrase.notes.map((note) => note.midi);
  assert.ok(figureRun(midis) < 12, `figure ${figureRun(midis)}`);
  assert.ok(pcRun(midis) <= PHRASE_VARIETY_RUN);
  assert.deepEqual(phrase.notes.map((note) => note.name).slice(0, 8), [
    'F',
    'Eb',
    'F',
    'Bb',
    'G',
    'Bb',
    'G',
    'Eb',
  ]);
});

void test('a pushed eighth steps down into the chord tone', () => {
  const result = generatePhrase({
    seed: 5,
    bars: 2,
    scaleNotes: scaleOf('C', 'major'),
    chordNotes: parseChord('F').notes,
    locks: { rhythm: 'push' },
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.phrase.plan.rhythm, 'push');
  const midis = result.phrase.notes.map((note) => note.midi);
  assert.ok(midis.join(',').includes('57,55,52,53'));
  for (let index = 1; index < result.phrase.notes.length; index++) {
    const note = result.phrase.notes[index];
    const gap = Math.abs(note.midi - result.phrase.notes[index - 1].midi);
    if (note.duration <= 0.5) assert.ok(gap <= 5);
  }
});

void test('a locked register keeps non-octave motion inside the window', () => {
  const high = generatePhrase({
    seed: 27,
    bars: 2,
    scaleNotes: scaleOf('Eb', 'dorian'),
    chordNotes: parseChord('Bb7').notes,
    locks: { register: 'high' },
  });
  const wide = generatePhrase({
    seed: 16,
    bars: 4,
    scaleNotes: scaleOf('C', 'dorian'),
    chordNotes: parseChord('Cm').notes,
    locks: { register: 'high' },
  });
  for (const result of [high, wide]) {
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    assert.equal(result.phrase.plan.register, 'high');
    const low = REGISTER_LOW.high;
    for (const note of result.phrase.notes) {
      assert.ok(note.midi >= low && note.midi <= low + PHRASE_RANGE);
    }
    const midis = result.phrase.notes.map((note) => note.midi);
    for (let index = 1; index < midis.length; index++) {
      assert.ok(Math.abs(midis[index] - midis[index - 1]) <= 12);
    }
  }
});

void test('an octave copy may leave the window and a non-octave leap may not', () => {
  const { phrase } = phraseFor('D', 'minor-pentatonic', 'A7', 1, 2);
  assert.equal(phrase.plan.register, 'mid');
  const low = REGISTER_LOW.mid;
  const high = low + PHRASE_RANGE;
  const outside = phrase.notes.filter(
    (note) => note.midi < low || note.midi > high,
  );
  assert.deepEqual(
    outside.map((note) => `${note.name}${note.midi}`),
    ['F53'],
  );
  // The cadence guard is what keeps this landing. Without it the last note
  // becomes A69 and the F53 octave copy disappears.
  assert.equal(phrase.notes.at(-1)?.midi, 57);
  assert.equal(phrase.notes.at(-1)?.duration, 2);
  assert.ok(53 + 12 >= low && 53 + 12 <= high);
  const index = phrase.notes.findIndex((note) => note.midi === 53);
  const gap = Math.abs(phrase.notes[index].midi - phrase.notes[index - 1].midi);
  assert.ok(gap !== 0 && gap <= 12);
  assertRegister(phrase);
  const inside = phraseFor('Eb', 'dorian', 'Bb7', 27, 2);
  // No lock here: the point is a non-octave leap still cannot be the way out.
  for (let step = 1; step < inside.phrase.notes.length; step++) {
    const landed = inside.phrase.notes[step];
    const previous = inside.phrase.notes[step - 1].midi;
    const leap = Math.abs(landed.midi - previous);
    if (leap === 12) continue;
    assert.ok(landed.midi >= REGISTER_LOW[inside.phrase.plan.register]);
    assert.ok(
      landed.midi <= REGISTER_LOW[inside.phrase.plan.register] + PHRASE_RANGE,
    );
  }
});

void test('the pitch-class floor and the four-note figure have a reason each', () => {
  let over = 0;
  let twoPitch = 0;
  let pentatonicSeventh = 0;
  let eighthPocket = 0;
  let multiFigures = 0;
  for (const root of SWEEP_ROOTS) {
    for (const scaleId of SWEEP_SCALES) {
      const scaleNotes = scaleOf(root, scaleId);
      for (const symbol of sweepSymbols(root, scaleId)) {
        const chordNotes = parseChord(symbol).notes;
        for (const bars of [2, 4] as const) {
          for (let seed = 1; seed <= 12; seed++) {
            const phrase = generatePhrase({
              seed,
              bars,
              scaleNotes,
              chordNotes,
            });
            assert.equal(phrase.ok, true);
            if (!phrase.ok) continue;
            const notes = phrase.phrase.notes;
            const midis = notes.map((note) => note.midi);
            const run = pcRun(midis);
            const figure = figureRun(midis);
            const names = new Set(midis.map(pitchClass)).size;
            const id = `${root} ${scaleId} ${symbol} seed ${seed} bars ${bars}`;
            if (figure >= 12 && names > 2) {
              multiFigures += 1;
              const weakEighth = notes
                .filter((note) => !note.strong)
                .every((note) => note.duration <= 0.5);
              assert.equal(
                weakEighth,
                true,
                `${id} repeats a figure on a note longer than an eighth`,
              );
            }
            if (run <= PHRASE_VARIETY_RUN) continue;
            over += 1;
            if (names === 2) {
              // The cadence is the lowest chord tone. The only scale step
              // into it is one neighbor, so the line stays on two names.
              twoPitch += 1;
              continue;
            }
            if (scaleId === 'minor-pentatonic' && bars === 2 && run === 7) {
              // A fourth name is already in the line. One pocket is a
              // single note over six, and the next strong beat can only
              // be approached by the chord-tone step.
              pentatonicSeventh += 1;
              continue;
            }
            const weakEighth = notes
              .filter((note) => !note.strong)
              .every((note) => note.duration <= 0.5);
            if (weakEighth) {
              // A step or third that would add a name is wider than a
              // fourth on the next eighth, so the hand cannot take it.
              eighthPocket += 1;
              continue;
            }
            assert.fail(`${id} is over the floor with no stated reason`);
          }
        }
      }
    }
  }
  assert.equal(twoPitch, 92);
  assert.equal(pentatonicSeventh, 15);
  assert.equal(eighthPocket, 26);
  assert.equal(over, 133);
  assert.equal(multiFigures, 6);
});
