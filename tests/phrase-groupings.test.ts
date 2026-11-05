import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  LISTEN_SEEDS,
  playedGroupingAtoms,
} from '../scripts/grouping-listen-seeds.mts';
import {
  GROUPING_CELLS,
  RHYTHM_DRAW_WEIGHTS,
  generatePhrase,
  groupingBlockAllowed,
  groupingTones,
} from '../lib/phrase.ts';

const CELLS: readonly {
  id: string;
  k: 3 | 4 | 6;
  offsets: readonly number[];
  shift: number;
  heard: readonly number[];
}[] = [
  {
    id: 'g3-skip',
    k: 3,
    offsets: [0, 2, 1],
    shift: 2,
    heard: [1, 3, 2, 3, 5, 4, 5, 7, 6],
  },
  {
    id: 'g3-turn',
    k: 3,
    offsets: [0, 1, -1],
    shift: 1,
    heard: [1, 2, 7, 2, 3, 1, 3, 4, 2],
  },
  {
    id: 'g3-open',
    k: 3,
    offsets: [0, 2, 3],
    shift: 1,
    heard: [1, 3, 4, 2, 4, 5, 3, 5, 6],
  },
  {
    id: 'g4-return',
    k: 4,
    offsets: [0, 1, 2, 0],
    shift: 2,
    heard: [1, 2, 3, 1, 3, 4, 5, 3],
  },
  {
    id: 'g4-thirds',
    k: 4,
    offsets: [0, 2, 1, 3],
    shift: 2,
    heard: [1, 3, 2, 4, 3, 5, 4, 6],
  },
  {
    id: 'g4-roll',
    k: 4,
    offsets: [0, 2, 1, 0],
    shift: 1,
    heard: [1, 3, 2, 1, 2, 4, 3, 2],
  },
  {
    id: 'g4-turn',
    k: 4,
    offsets: [0, 1, 0, -1],
    shift: 1,
    heard: [1, 2, 1, 7, 2, 3, 2, 1],
  },
  {
    id: 'g6-wave',
    k: 6,
    offsets: [0, 1, 2, 3, 2, 1],
    shift: -1,
    heard: [1, 2, 3, 4, 3, 2, 7, 1, 2, 3, 2, 1],
  },
];

void test('the eight grouping cells and their mirrors pass blockAllowed', () => {
  assert.deepEqual(
    GROUPING_CELLS.map((cell) => ({
      id: cell.id,
      k: cell.k,
      offsets: [...cell.offsets],
      shift: cell.shift,
    })),
    CELLS.map(({ id, k, offsets, shift }) => ({
      id,
      k,
      offsets: [...offsets],
      shift,
    })),
  );
  for (const cell of CELLS) {
    const repeats = cell.k === 6 ? [2] : [2, 3];
    for (const times of repeats) {
      const played = times * cell.k;
      const up = groupingTones(cell.offsets, cell.shift, 0, times, false);
      assert.equal(up.length, played, cell.id);
      const heard = up.map((tone) => (tone >= 0 ? tone + 1 : tone + 8));
      const shown = Math.min(heard.length, cell.heard.length);
      assert.deepEqual(
        heard.slice(0, shown),
        cell.heard.slice(0, shown),
        `${cell.id} up ×${times}`,
      );
      const down = groupingTones(cell.offsets, cell.shift, 12, times, true);
      assert.deepEqual(
        down.map((tone) => 12 - tone),
        up,
        `${cell.id} mirror`,
      );
      for (const scale of ['major', 'minor-pentatonic'] as const) {
        assert.equal(
          groupingBlockAllowed(cell.offsets, cell.shift, times, scale),
          true,
          `${cell.id} ×${times} ${scale}`,
        );
        assert.equal(
          groupingBlockAllowed(
            cell.offsets.map((offset) => -offset),
            -cell.shift,
            times,
            scale,
          ),
          true,
          `${cell.id} mirror ×${times} ${scale}`,
        );
      }
    }
  }
});

void test('textbook 1-2-3 and 1-2-3-4 still fail blockAllowed', () => {
  for (const times of [2, 3]) {
    assert.equal(
      groupingBlockAllowed([0, 1, 2], 1, times),
      false,
      `3s ×${times}`,
    );
    assert.equal(
      groupingBlockAllowed([0, -1, -2], -1, times),
      false,
      `3s down ×${times}`,
    );
    assert.equal(
      groupingBlockAllowed([0, 1, 2, 3], 1, times),
      false,
      `4s ×${times}`,
    );
    assert.equal(
      groupingBlockAllowed([0, -1, -2, -3], -1, times),
      false,
      `4s down ×${times}`,
    );
  }
});

void test('listen seeds play a grouping on this head', () => {
  assert.equal(LISTEN_SEEDS.length, 5);
  for (const row of LISTEN_SEEDS) {
    const scale = SCALES.find((item) => item.id === row.scale);
    assert.ok(scale, row.scale);
    const scaleNotes = spell(row.key, scale.formula);
    const result = generatePhrase({
      seed: row.seed,
      bars: row.bars,
      scaleNotes,
      chordNotes: parseChord(row.chord).notes,
    });
    assert.equal(result.ok, true, String(row.seed));
    if (!result.ok) continue;
    const atoms = playedGroupingAtoms(
      result.phrase.notes.map((note) => note.midi),
      result.phrase.notes.map((note) => note.beat),
      new Set(scaleNotes.map((note) => note.pc)),
    );
    assert.ok(atoms >= 1, `${row.seed} atoms ${atoms}`);
  }
});

void test('eighths are five of the eight rhythm draws', () => {
  assert.deepEqual([...RHYTHM_DRAW_WEIGHTS], [1, 5, 1, 1]);
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const scaleNotes = spell('C', scale.formula);
  const chordNotes = parseChord('C').notes;
  let eighths = 0;
  const draws = 800;
  for (let seed = 0; seed < draws; seed++) {
    const result = generatePhrase({
      seed,
      bars: 2,
      scaleNotes,
      chordNotes,
    });
    assert.equal(result.ok, true);
    if (!result.ok) continue;
    if (result.phrase.plan.rhythm === 'eighths') eighths++;
  }
  // Five of eight draws. The band leaves room for the integer weights.
  assert.ok(eighths / draws > 0.5, String(eighths));
  assert.ok(eighths / draws < 0.75, String(eighths));
});

void test('the three extra eighth bars are drawable', () => {
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const scaleNotes = spell('C', scale.formula);
  const chordNotes = parseChord('C').notes;
  const seen = new Set<string>();
  for (let seed = 0; seed < 80; seed++) {
    for (const bars of [2, 4] as const) {
      const result = generatePhrase({
        seed,
        bars,
        scaleNotes,
        chordNotes,
        locks: { rhythm: 'eighths' },
      });
      assert.equal(result.ok, true, `seed ${seed} ${bars}`);
      if (!result.ok) continue;
      for (const cell of result.phrase.plan.cells ?? []) seen.add(cell);
    }
  }
  assert.ok(seen.has('ee ee ee zr'), [...seen].join(' | '));
  assert.ok(seen.has('q ee ee ee'), [...seen].join(' | '));
  assert.ok(seen.has('ee ee ee q'), [...seen].join(' | '));
});
