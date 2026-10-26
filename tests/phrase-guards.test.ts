import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import { generatePhrase, type Phrase } from '../lib/phrase.ts';

const SWEEP: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['D', 'dorian', 'Dm7'],
  ['E', 'minor', 'Em'],
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'harmonic-minor', 'E7'],
];

function scaleOf(root: string, id: string): Note[] {
  const scale = SCALES.find((item) => item.id === id);
  assert.ok(scale, id);
  return spell(root, scale.formula);
}

function phrase(
  root: string,
  scaleId: string,
  symbol: string,
  seed: number,
  bars: 2 | 4,
): Phrase {
  const result = generatePhrase({
    seed,
    bars,
    scaleNotes: scaleOf(root, scaleId),
    chordNotes: parseChord(symbol).notes,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(symbol);
  return result.phrase;
}

function scaleStep(from: number, to: number, pcs: ReadonlySet<number>): number {
  if (from === to) return 0;
  const sign = Math.sign(to - from);
  let midi = from;
  let count = 0;
  while (midi !== to && count < 24) {
    midi += sign;
    if (pcs.has(((midi % 12) + 12) % 12)) count += 1;
  }
  return sign * count;
}

function eighth(beat: number): number {
  const bar = Math.floor(beat / 4);
  return Math.round((beat - bar * 4) * 2);
}

function monotone(midis: readonly number[], pcs: ReadonlySet<number>): number {
  let best = 1;
  let run = 1;
  let dir = 0;
  for (let index = 1; index < midis.length; index++) {
    const delta = scaleStep(midis[index - 1] ?? 0, midis[index] ?? 0, pcs);
    if (Math.abs(delta) === 1 && delta === dir) run += 1;
    else if (Math.abs(delta) === 1) {
      dir = delta;
      run = 2;
    } else {
      dir = 0;
      run = 1;
    }
    if (run > best) best = run;
  }
  return best;
}

/** A 6-note ABCABC that is not the shifted 4-note return sitting on itself. */
function period3Outside(
  notes: Phrase['notes'],
  pcs: ReadonlySet<number>,
): boolean {
  const midis = notes.map((note) => note.midi);
  const grouped = [0, 1].map((bar) =>
    notes
      .map((note, index) => ({ note, index }))
      .filter(
        (item) => Math.floor(item.note.beat / 4) === bar && item.note.beat < 8,
      ),
  );
  let cover: [number, number] | null = null;
  const left = grouped[0] ?? [];
  const right = grouped[1] ?? [];
  if (left.length >= 4 && right.length >= 4) {
    let matched = true;
    for (let index = 0; index < 4; index++) {
      const a = left[index]?.note;
      const b = right[index]?.note;
      if (!a || !b || eighth(a.beat) !== eighth(b.beat)) matched = false;
    }
    for (let index = 1; index < 4 && matched; index++) {
      if (
        scaleStep(left[index - 1]?.note.midi ?? 0, left[index]?.note.midi ?? 0, pcs) !==
        scaleStep(right[index - 1]?.note.midi ?? 0, right[index]?.note.midi ?? 0, pcs)
      )
        matched = false;
    }
    if (matched) cover = [left[0]?.index ?? 0, (right[3]?.index ?? 0) + 1];
  }
  const length = 6;
  for (let start = 0; start + length <= midis.length; start++) {
    if (cover && start >= cover[0] && start + length <= cover[1]) continue;
    let match = true;
    for (let index = 3; index < length; index++) {
      if (midis[start + index] !== midis[start + (index % 3)]) match = false;
    }
    if (match && new Set(midis.slice(start, start + 3)).size >= 2) return true;
  }
  return false;
}

void test('sentence guards stay visible in the notes', () => {
  let phrases = 0;
  let four = 0;
  let leap = 0;
  let sequenced = 0;
  let freeFour = 0;
  let freeSequenced = 0;
  let heldOpen = 0;
  let bars = 0;
  let silent = 0;
  let returned = 0;
  let monotonePhrases = 0;
  let period3 = 0;
  let strong = 0;
  let strongChord = 0;
  let sync = 0;
  let syncNotes = 0;
  let repeatedCells = 0;
  for (const [root, scaleId, symbol] of SWEEP) {
    const scaleNotes = scaleOf(root, scaleId);
    const pcs = new Set(scaleNotes.map((note) => note.pc));
    for (const barsCount of [2, 4] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        const line = phrase(root, scaleId, symbol, seed, barsCount);
        phrases += 1;
        const notes = line.notes;
        const closing = notes.at(-1);
        const before = notes.at(-2);
        if (closing && before && Math.abs(closing.midi - before.midi) >= 3) leap += 1;
        if ((notes[0]?.duration ?? 0) >= 1) heldOpen += 1;
        for (const note of notes) {
          if (note.shift) assert.ok(note.duration > 0.5);
        }
        const body = notes.filter((note) => note.beat < barsCount * 4);
        const groups = Array.from({ length: barsCount }, (_, bar) =>
          body.filter((note) => Math.floor(note.beat / 4) === bar),
        );
        for (const group of groups) {
          bars += 1;
          if (!group.some((note) => Math.abs(note.beat - Math.round(note.beat)) < 1e-6))
            silent += 1;
        }
        const opening = groups[0] ?? [];
        const answer = groups[1] ?? [];
        if (opening.length >= 4 && answer.length >= 4) {
          const rhythm = (group: typeof opening) =>
            group.slice(0, 4).map((note) => eighth(note.beat)).join(',');
          const motion = (group: typeof opening) =>
            group
              .slice(0, 4)
              .slice(1)
              .map((note, index) => scaleStep(group[index]?.midi ?? 0, note.midi, pcs))
              .join(',');
          if (rhythm(opening) === rhythm(answer) && motion(opening) === motion(answer))
            returned += 1;
        }
        if (barsCount === 4) {
          four += 1;
          const free = seed % 8 === 0;
          if (free) freeFour += 1;
          const head = groups[0] ?? [];
          const fragment = groups[2] ?? [];
          if (head.length >= 2 && fragment.length >= 4) {
            const first = eighth(head[0]?.beat ?? 0);
            const second = eighth(head[1]?.beat ?? 0);
            const secondDur = Math.max(1, Math.round((head[1]?.duration ?? 0.5) * 2));
            const span = second + secondDur - first;
            const rhythm =
              eighth(fragment[0]?.beat ?? 0) === first &&
              eighth(fragment[1]?.beat ?? 0) === second &&
              eighth(fragment[2]?.beat ?? 0) === first + span &&
              eighth(fragment[3]?.beat ?? 0) === second + span;
            const idea = scaleStep(head[0]?.midi ?? 0, head[1]?.midi ?? 0, pcs);
            const left = scaleStep(fragment[0]?.midi ?? 0, fragment[1]?.midi ?? 0, pcs);
            const right = scaleStep(fragment[2]?.midi ?? 0, fragment[3]?.midi ?? 0, pcs);
            if (
              rhythm &&
              idea === left &&
              left === right &&
              fragment[0]?.midi !== fragment[2]?.midi
            ) {
              sequenced += 1;
              if (free) freeSequenced += 1;
            }
          }
        }
        if (monotone(notes.map((note) => note.midi), pcs) >= 5) monotonePhrases += 1;
        if (period3Outside(notes, pcs)) period3 += 1;
        for (const note of notes) {
          syncNotes += 1;
          if (note.strong && note.chordTone) strongChord += 1;
          if (note.strong) strong += 1;
          const fraction = note.beat - Math.floor(note.beat + 1e-9);
          if (Math.abs(fraction - 0.5) >= 0.01) continue;
          const following = Math.floor(note.beat) + 1;
          const struck = notes.some((item) => Math.abs(item.beat - following) < 0.01);
          if (!struck) sync += 1;
        }
        const cells = line.plan.cells ?? [];
        for (let index = 1; index < cells.length; index++) {
          if (cells[index] === cells[index - 1]) repeatedCells += 1;
        }
      }
    }
  }
  assert.equal(phrases, 400);
  assert.equal(freeFour, 24);
  assert.ok(leap / phrases <= 0.5, `leap close ${leap}/${phrases}`);
  // Answering seeds still sequence bar 3. This sweep is 167/176, the
  // same count as tip 79f060c. Free seeds are counted apart, below.
  assert.ok(
    (sequenced - freeSequenced) / (four - freeFour) >= 0.6,
    `answering fragment ${sequenced - freeSequenced}/${four - freeFour}`,
  );
  // Free seeds skip the bar-3 fragment chooser. Tip sequenced 23/24 of
  // these lines. One scored walk still lands on the same two intervals:
  // F# major, F#maj7, seed 8.
  assert.ok(
    freeSequenced <= 1,
    `free fragment ${freeSequenced}/${freeFour}`,
  );
  assert.ok(heldOpen / phrases >= 0.7, `held opening ${heldOpen}/${phrases}`);
  assert.ok(silent / bars <= 0.02, `no on-beat ${silent}/${bars}`);
  assert.ok(returned / phrases >= 0.8, `return ${returned}/${phrases}`);
  assert.ok(monotonePhrases / phrases <= 0.02, `monotone ${monotonePhrases}/${phrases}`);
  // The walk refuses a 3-cycle on its own. Two phrases appear when that
  // refusal is off, which still sits under a 0.8% ceiling.
  assert.equal(period3, 0, `period-3 ${period3}/${phrases}`);
  // Held notes are chord tones, so strong beats sit on the chord more
  // often. Before the free bar-3 skip this sweep was 85.46% (1846/2160).
  // After it, 86.33% (1870/2166). The wider band stops at 88%.
  assert.ok(
    strongChord / strong <= 0.88,
    `strong chord ${strongChord}/${strong}`,
  );
  // An off-beat eighth with no following downbeat. Dropping the sync
  // bonus falls from 15.0% to 11.6%, still above the 5% floor.
  assert.ok(sync / syncNotes >= 0.13, `sync ${sync}/${syncNotes}`);
  // Same cell id on two bars in a row. Dropping the -30 penalty goes
  // from 7 to 21.
  assert.ok(repeatedCells <= 12, `repeated cells ${repeatedCells}`);
});

void test('score order and the lane tie-break pick a fixed line', () => {
  const two = phrase('C', 'major', 'C', 6, 2);
  assert.deepEqual(
    two.notes.map((note) => [note.midi, note.beat, note.duration]),
    [
      [67, 0, 1],
      [69, 1.5, 0.5],
      [71, 2.5, 0.5],
      [67, 3, 1],
      [64, 4, 1],
      [65, 5.5, 0.5],
      [67, 6.5, 0.5],
      [64, 7, 0.5],
      [62, 7.5, 0.5],
      [60, 8, 2],
    ],
  );
  const four = phrase('C', 'major', 'C', 15, 4);
  assert.deepEqual(
    four.notes.map((note) => note.midi),
    [64, 62, 65, 64, 62, 59, 67, 65, 69, 67, 71, 67, 65, 71, 69, 65, 64, 69, 67, 65, 62, 65, 64],
  );
});

void test('these cadence tails stay on the weighted pitches', () => {
  // Re-pinned with the held-chord walk. A later pitch change has to update
  // the rows on purpose. Am seed 7 is the ×0.35 leap penalty: without it
  // the approach moves from 67 to 69.
  const lines: readonly (readonly [string, string, string, number, 2 | 4, readonly number[]])[] = [
    ['C', 'major', 'C', 7, 2, [72, 76, 72, 67, 76, 79, 76, 71, 69, 67]],
    ['C', 'major', 'C', 46, 2, [60, 57, 59, 60, 64, 67, 64, 60, 62, 64, 65, 57, 55]],
    ['C', 'major', 'C', 1, 4, [60, 64, 62, 60, 64, 67, 65, 64, 62, 57, 60, 55, 59, 60, 64, 67, 57, 55]],
    ['C', 'major', 'C', 7, 4, [72, 69, 67, 64, 76, 72, 71, 67, 71, 76, 72, 79, 76, 72, 74, 76, 69, 67]],
    // Free 4-bar seed (24 % 8 === 0). Bar 3 is the scored walk, not the
    // two-note fragment. Tip 79f060c was
    // 53,54,51,56,54,53,56,58,61,51,53,49,51,53,56,54,53,56,58,66.
    ['F#', 'major', 'F#maj7', 24, 4, [53, 54, 51, 56, 54, 53, 56, 58, 61, 58, 56, 53, 54, 56, 58, 61, 65, 63, 65, 66]],
    ['C', 'major', 'C', 1, 2, [67, 69, 71, 67, 64, 65, 67, 64, 59, 55]],
    ['F#', 'major', 'F#maj7', 2, 2, [61, 59, 56, 61, 63, 65, 58, 56, 53, 58, 59, 58]],
    ['C', 'major', 'C', 4, 2, [48, 52, 55, 52, 48, 50, 52, 55, 59, 55, 50, 48]],
    ['C', 'major', 'C', 20, 4, [64, 65, 67, 64, 62, 59, 67, 69, 71, 67, 69, 62, 64, 60, 62, 64, 67, 65, 64, 62, 59, 62, 60]],
    ['C', 'major', 'C', 5, 4, [57, 62, 59, 60, 57, 62, 60, 65, 62, 64, 62, 60, 59, 64, 60, 65, 64, 60, 59, 57, 55, 57, 53, 50, 52]],
    ['A', 'dorian', 'Am', 7, 2, [69, 72, 71, 69, 72, 76, 74, 72, 67, 64]],
  ];
  for (const [root, scaleId, symbol, seed, bars, midis] of lines) {
    const line = phrase(root, scaleId, symbol, seed, bars);
    assert.deepEqual(
      line.notes.map((note) => note.midi),
      [...midis],
      `${symbol} seed ${seed} ${bars}`,
    );
  }
});
