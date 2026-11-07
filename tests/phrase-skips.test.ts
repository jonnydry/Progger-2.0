import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  arrivalOk,
  generatePhrase,
  type SkipArrivalPin,
} from '../lib/phrase.ts';

const pin = (
  patch: Partial<SkipArrivalPin> = {},
): SkipArrivalPin => ({
  from: { string: 0, formIndex: 1, fret: 5, position: 5 },
  to: { string: 2, formIndex: 1, fret: 7, position: 5 },
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
    arrivalOk(8, 0.5, pin({ to: { string: 1, formIndex: 1, fret: 7, position: 5 } })),
    false,
  );
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 3, formIndex: 1, fret: 7, position: 5 } })),
    false,
  );
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 2, formIndex: 3, fret: 7, position: 5 } })),
    false,
  );
  assert.equal(arrivalOk(8, 0.5, pin({ shiftFrets: 1 })), false);
  assert.equal(arrivalOk(8, 0.5, pin({ shiftFrets: 4 })), false);
  assert.equal(arrivalOk(8, 0.5, pin({ arrivalsInBar: 4 })), false);
  assert.equal(arrivalOk(8, 0.5, pin({ arrivalsInBar: 3 })), true);
  // The next form is still one hand. Two forms away is not.
  assert.equal(
    arrivalOk(8, 0.5, pin({ to: { string: 2, formIndex: 2, fret: 7, position: 5 } })),
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
          assert.equal(to.position, from.position);
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
