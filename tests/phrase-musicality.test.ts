import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, patterns, spell, type Note } from '../lib/music.ts';
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

/** Longest run that stays on three pitches or fewer. */
function narrowRun(midis: readonly number[]): number {
  let longest = midis.length > 0 ? 1 : 0;
  for (let start = 0; start < midis.length; start++) {
    const seen = new Set<number>();
    for (let end = start; end < midis.length; end++) {
      seen.add(midis[end]);
      if (seen.size > 3) break;
      longest = Math.max(longest, end - start + 1);
    }
  }
  return longest;
}

/**
 * Inside the register window, or on the shape that already holds the line
 * and the shapes on either side of it. A scale with no 3NPS form stays
 * inside the window.
 */
function assertRegister(phrase: Phrase, scaleNotes: readonly Note[]): void {
  const forms = patterns([...scaleNotes]);
  const low = REGISTER_LOW[phrase.plan.register];
  const midis = phrase.notes.map((note) => note.midi);
  let allowed: Set<number> | null = null;
  if (forms.length) {
    let active = 0;
    let best = -1;
    let bestDist = Infinity;
    const distinct = new Set(midis);
    forms.forEach((form, index) => {
      const have = new Set(form.positions.map((position) => position.midi));
      let hit = 0;
      for (const midi of distinct) if (have.has(midi)) hit += 1;
      const dist = Math.abs((form.min + form.max) / 2 - 7);
      if (hit > best || (hit === best && dist < bestDist)) {
        active = index;
        best = hit;
        bestDist = dist;
      }
    });
    allowed = new Set<number>();
    for (const index of [active - 1, active, active + 1]) {
      if (index < 0 || index >= forms.length) continue;
      for (const position of forms[index].positions) allowed.add(position.midi);
    }
  }
  for (const note of phrase.notes) {
    const inside = note.midi >= low && note.midi <= low + PHRASE_RANGE;
    if (inside) continue;
    assert.ok(
      allowed?.has(note.midi),
      `${note.name}${note.midi} leaves the ${phrase.plan.register} window and the neighboring shapes`,
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
      'G67@9',
      'E64@10',
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
        assertRegister(phrase, scaleNotes);
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
      'Eb51@11.5',
      'F53@12',
      'A57@13.5',
      'G55@14',
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
  // These 44 are the whole phrase: two adjacent pitches, usually on the
  // register floor. The middle third is higher by one extra upper note.
  // The other step into that chord tone flattens the arch, so they stay.
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
  assert.equal(Math.max(...midis), 70);
  assert.ok(phraseCellLength(midis) <= PHRASE_CELL_LIMIT);
  assert.ok(
    narrowRun(midis) <= PHRASE_VARIETY_RUN,
    `seed 7 sits on ${narrowRun(midis)} notes`,
  );
  assert.deepEqual(
    phrase.notes.map((note) => `${note.name}${note.midi}@${note.beat}`),
    [
      'F65@0',
      'Bb70@1',
      'G67@2',
      'F53@3',
      'G55@4',
      'Bb70@5',
      'G67@6',
      'F65@7',
      'G67@8',
      'Bb70@9',
      'G67@10',
      'F53@11',
      'G55@12',
      'Bb70@13',
      'G67@14',
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
  assert.ok(corpus.circling <= 48, `corpus circling ${corpus.circling}`);
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
