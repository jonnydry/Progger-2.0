import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  arrivalOk,
  generatePhrase,
  lastSkipWitness,
  type FingeredNote,
  type SkipArrivalPin,
} from '../lib/phrase.ts';

const pin = (
  patch: Partial<SkipArrivalPin> = {},
): SkipArrivalPin => ({
  from: { string: 0, formIndex: 1 },
  to: { string: 2, formIndex: 1 },
  shiftFrets: 0,
  arrivalsInBar: 0,
  ...patch,
});

void test('unpinned eighths still reject a 6–12 semitone leap', () => {
  for (const gap of [6, 7, 9, 11, 12]) {
    assert.equal(arrivalOk(gap, 0.5), false, `gap ${gap}`);
    assert.equal(arrivalOk(gap, 0.5, null), false, `null pin ${gap}`);
  }
  assert.equal(arrivalOk(5, 0.5), true);
  assert.equal(arrivalOk(7, 1), true);
  assert.equal(arrivalOk(0, 1), false);
  assert.equal(arrivalOk(13, 1), false);
});

void test('a pinned 2-string skip may arrive by 6–12 semitones on an eighth', () => {
  for (const gap of [6, 8, 12]) {
    assert.equal(arrivalOk(gap, 0.5, pin()), true, `pinned ${gap}`);
  }
  assert.equal(arrivalOk(5, 0.5, pin()), true);
  assert.equal(arrivalOk(13, 0.5, pin()), false);
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 1, formIndex: 1 } })),
    false,
  );
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 3, formIndex: 1 } })),
    false,
  );
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 2, formIndex: 3 } })),
    false,
  );
  assert.equal(arrivalOk(8, 0.5, pin({ shiftFrets: 4 })), false);
  assert.equal(arrivalOk(8, 0.5, pin({ arrivalsInBar: 4 })), false);
  assert.equal(arrivalOk(8, 0.5, pin({ arrivalsInBar: 3 })), true);
  // The next form is still one hand. Two forms away is not.
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 2, formIndex: 2 } })),
    true,
  );
});

void test('played eighth leaps are pinned skips and stay under four a bar', () => {
  const contexts = [
    ['C', 'major', 'C'],
    ['A', 'dorian', 'Am'],
    ['E', 'minor', 'Em'],
    ['A', 'minor-pentatonic', 'Am7'],
  ] as const;
  let leaps = 0;
  for (const [root, scaleId, symbol] of contexts) {
    const scale = SCALES.find((item) => item.id === scaleId);
    assert.ok(scale);
    const scaleNotes = spell(root, scale.formula);
    const chordNotes = parseChord(symbol).notes;
    for (const bars of [2, 4] as const) {
      for (let seed = 1000; seed < 1020; seed++) {
        const result = generatePhrase({
          seed,
          bars,
          scaleNotes,
          chordNotes,
        });
        assert.equal(result.ok, true);
        if (!result.ok) continue;
        const notes = result.phrase.notes;
        const perBar = new Map<number, number>();
        for (let index = 1; index < notes.length; index++) {
          const from = notes[index - 1];
          const to = notes[index];
          if (!from || !to || to.duration > 0.5) continue;
          const gap = Math.abs(to.midi - from.midi);
          if (gap <= 5) continue;
          leaps += 1;
          assert.ok(gap <= 12);
          assert.equal(Math.abs(to.string - from.string), 2);
          assert.ok(Math.abs(to.position - from.position) < 4);
          const bar = Math.floor(to.beat / 4);
          const count = (perBar.get(bar) ?? 0) + 1;
          perBar.set(bar, count);
          assert.ok(count <= 4);
        }
      }
    }
  }
  assert.ok(leaps > 0, 'expected at least one pinned eighth leap');
});

const METRICS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F', 'major', 'Fmaj7'],
  ['E', 'minor', 'Em'],
  ['D', 'dorian', 'Dm7'],
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'minor-pentatonic', 'Am7'],
];

/** Semitones up to the next scale tone, or 0 when the scale has no higher tone. */
function nextScaleStep(midi: number, pcs: ReadonlySet<number>): number {
  for (let step = 1; step <= 4; step++) {
    if (pcs.has(((midi + step) % 12 + 12) % 12)) return step;
  }
  return 0;
}

/**
 * The old octave cell: the octave, then the next scale tone back on the
 * low string. Falling contours played that cell backwards, so the return
 * is the first note and the octave is the second interval. A chord-tone
 * arp can share the shape. The 800-phrase metrics base below has no such
 * arp, and it did have these returns before the cell stopped on arrival.
 */
function oldOctaveReturn(
  cell: readonly FingeredNote[],
  pcs: ReadonlySet<number>,
): boolean {
  if (cell.length !== 3) return false;
  const [first, middle, last] = cell;
  if (!first || !middle || !last) return false;
  const rising =
    middle.midi - first.midi === 12 &&
    last.string === first.string &&
    Math.abs(middle.string - first.string) === 2 &&
    last.midi - first.midi === nextScaleStep(first.midi, pcs);
  const falling =
    middle.midi - last.midi === 12 &&
    first.string === last.string &&
    Math.abs(middle.string - last.string) === 2 &&
    first.midi - last.midi === nextScaleStep(last.midi, pcs);
  return rising || falling;
}

/** One played skip atom. Notes are contiguous, and `end` is the last index. */
function skipAtoms(
  notes: readonly FingeredNote[],
): { notes: FingeredNote[]; end: number }[] {
  const witness = lastSkipWitness();
  const groups = new Map<number, number[]>();
  witness?.spots.forEach((spot, index) => {
    if (!spot) return;
    const list = groups.get(spot.atom) ?? [];
    list.push(index);
    groups.set(spot.atom, list);
  });
  return [...groups.values()].map((indexes) => {
    const ordered = [...indexes].sort((a, b) => a - b);
    const end = ordered.at(-1) ?? 0;
    const played: FingeredNote[] = [];
    for (const index of ordered) {
      const note = notes[index];
      if (note) played.push(note);
    }
    return { notes: played, end };
  });
}

void test('an octave stops on its arrival and the line stays near it', () => {
  // A property, not a seed pin. The old version pinned seed 1160, then 993,
  // and each stopped drawing an octave as the rhythm draw changed; what the
  // rule promises is the shape, so this walks a grid of contexts and seeds
  // and checks every rising octave it finds.
  let octaves = 0;
  const CONTEXTS = [
    ['F', 'major', 'Fmaj7'],
    ['C', 'major', 'C'],
    ['G', 'major', 'G7'],
    ['A', 'dorian', 'Am'],
  ] as const;
  for (const [root, scaleId, symbol] of CONTEXTS) {
    const scale = SCALES.find((item) => item.id === scaleId);
    assert.ok(scale, scaleId);
    const scaleNotes = spell(root, scale.formula);
    const pcs = new Set(scaleNotes.map((note) => note.pc));
    const chordNotes = parseChord(symbol).notes;
    for (const bars of [2, 4] as const) {
      for (let seed = 1000; seed < 1060; seed++) {
        const result = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        if (!result.ok) continue;
        const notes = result.phrase.notes;
        const atoms = skipAtoms(notes);
        assert.equal(
          atoms.some((cell) => oldOctaveReturn(cell.notes, pcs)),
          false,
          `${symbol} seed ${seed} ${bars} still returns from the octave`,
        );
        for (const octave of atoms) {
          const [low, high] = octave.notes;
          if (octave.notes.length !== 2 || !low || !high) continue;
          if (high.midi - low.midi !== 12) continue;
          octaves += 1;
          // Two strings apart, and the line moves by a step off the top.
          assert.equal(Math.abs(high.string - low.string), 2);
          const follow = notes.slice(octave.end + 1, octave.end + 4);
          if (follow[0]) {
            assert.ok(Math.abs(follow[0].midi - high.midi) <= 5);
          }
        }
      }
    }
  }
  assert.ok(octaves > 0, 'the grid never played an octave to check');
});

void test('octave cells are two notes and the next eighth stays by the arrival', () => {
  let octaves = 0;
  let upward = 0;
  let falling = 0;
  let stepped = 0;
  let sixths = 0;
  let pedals = 0;
  for (const bars of [2, 4] as const) {
    METRICS.forEach(([root, scaleId, symbol], index) => {
      const scale = SCALES.find((item) => item.id === scaleId);
      assert.ok(scale, scaleId);
      const scaleNotes = spell(root, scale.formula);
      const pcs = new Set(scaleNotes.map((note) => note.pc));
      const chordNotes = parseChord(symbol).notes;
      for (let offset = 0; offset < 50; offset++) {
        const seed = 1000 + index * 50 + offset;
        const result = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        assert.equal(result.ok, true, `${symbol} ${seed} ${bars}`);
        if (!result.ok) continue;
        const notes = result.phrase.notes;
        for (const cell of skipAtoms(notes)) {
          assert.equal(
            oldOctaveReturn(cell.notes, pcs),
            false,
            `${symbol} ${seed} ${bars} still returns from the octave`,
          );
          const gap = Math.abs(
            (cell.notes[1]?.midi ?? 0) - (cell.notes[0]?.midi ?? 0),
          );
          if (cell.notes.length === 2 && gap === 12) {
            octaves += 1;
            assert.equal(
              Math.abs(cell.notes[1].string - cell.notes[0].string),
              2,
              `${seed} ${bars}`,
            );
            const rising = cell.notes[1].midi - cell.notes[0].midi === 12;
            if (rising) upward += 1;
            else falling += 1;
            const next = notes[cell.end + 1];
            if (!next || next.duration > 0.5) continue;
            const step = next.midi - cell.notes[1].midi;
            assert.ok(
              Math.abs(step) <= 5,
              `${symbol} ${seed} ${bars} eighth leaves the octave by ${step}`,
            );
            if (rising && Math.abs(step) <= 2) stepped += 1;
            continue;
          }
          if (cell.notes.length === 2) {
            assert.ok(gap === 8 || gap === 9, `lone skip ${gap}`);
            sixths += 1;
          }
          if (cell.notes.length === 4) {
            const low = cell.notes[0];
            const high = cell.notes[1];
            const third = cell.notes[2];
            const fourth = cell.notes[3];
            if (
              (low.midi === third.midi && low.string === third.string) ||
              (high.midi === fourth.midi && high.string === fourth.string)
            )
              pedals += 1;
          }
        }
      }
    });
  }
  assert.ok(octaves > 0 && upward > 0, 'no upward octave');
  assert.ok(falling > 0, 'no falling octave');
  assert.ok(stepped > 0, 'no upward octave continued by step');
  assert.ok(sixths > 0, 'no lone sixth');
  assert.ok(pedals > 0, 'no pedal');
});
