import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import {
  cadenceDegrees,
  cadenceLabel,
  cadencePitchClasses,
  cadenceRole,
  defaultChordNotes,
  generatePhrase,
  loopSeamLegal,
  availableCadences,
  type Phrase,
} from '../lib/phrase.ts';
import { phraseLoopBeats } from '../lib/phrase-audio.ts';

function scaleOf(root: string, id: string): Note[] {
  const scale = SCALES.find((item) => item.id === id);
  assert.ok(scale, id);
  return spell(root, scale.formula);
}

function phraseOf(root: string, scaleId: string, symbol: string, seed: number, bars: 2 | 4): Phrase {
  const result = generatePhrase({
    seed,
    bars,
    scaleNotes: scaleOf(root, scaleId),
    chordNotes: parseChord(symbol).notes,
  });
  assert.equal(result.ok, true, `${symbol} ${seed} ${bars}`);
  if (!result.ok) throw new Error(symbol);
  return result.phrase;
}

void test('a cadence degree keeps its accidental instead of reducing to a number', () => {
  // The role names a category; the degree keeps the spelling.
  assert.equal(cadenceRole('1'), 'root');
  assert.equal(cadenceRole('8'), 'root');
  assert.equal(cadenceRole('b3'), 'third');
  assert.equal(cadenceRole('#5'), 'fifth');
  // A ninth is a colour tone, not a third, whatever 9 reduces to.
  assert.equal(cadenceRole('9'), null);
  assert.equal(cadenceRole('b9'), null);
  assert.equal(cadenceRole('11'), null);
  assert.equal(cadenceRole('13'), null);
  assert.equal(cadenceRole('bass'), null);
});

void test('a chord holding two spellings of one category keeps the plain one', () => {
  // Minor blues has both b5 and 5. The cadence is the fifth, never the tritone.
  const blues = spell('C', SCALES.find((s) => s.id === 'minor-blues')!.formula);
  const degrees = cadenceDegrees(blues);
  assert.equal(degrees.fifth, '5');
  assert.equal(degrees.third, 'b3');
  assert.equal(cadenceLabel('fifth', blues), '5th');
  assert.equal(cadenceLabel('third', blues), '♭3');
  const pcs = cadencePitchClasses(blues, 'fifth', new Set(blues.map((n) => n.pc)));
  assert.deepEqual(pcs, [7]);

  // Major blues carries both b3 and 3. The plain third wins.
  const majorBlues = spell('C', SCALES.find((s) => s.id === 'major-blues')!.formula);
  assert.equal(cadenceDegrees(majorBlues).third, '3');
  assert.equal(cadenceLabel('third', majorBlues), '3rd');

  // A category with no plain member keeps its altered spelling.
  const augmented = spell('C', SCALES.find((s) => s.id === 'lydian-augmented')!.formula);
  assert.equal(cadenceLabel('fifth', augmented), '♯5');
  const diminished = spell('C', SCALES.find((s) => s.id === 'ultralocrian')!.formula);
  assert.equal(cadenceLabel('fifth', diminished), '♭5');
});

void test('the default tonic chord is one degree per cadence category', () => {
  const blues = scaleOf('C', 'minor-blues');
  const tonic = defaultChordNotes(blues);
  assert.deepEqual(
    tonic.map((note) => note.degree),
    ['1', 'b3', '5'],
  );
  // It no longer carries the passing flat fifth beside the fifth.
  assert.equal(tonic.some((note) => note.degree === 'b5'), false);
  assert.deepEqual(availableCadences(tonic, blues), ['root', 'third', 'fifth']);
});

void test('every cadence lands on the pitch its label names', () => {
  const contexts = [
    ['C', 'minor-blues', 'C'],
    ['C', 'major-blues', 'C'],
    ['A', 'dorian', 'Am'],
    ['F#', 'major', 'F#maj7'],
    ['C', 'lydian-augmented', 'C'],
    ['C', 'ultralocrian', 'C'],
    ['C', 'whole-tone', 'C'],
  ] as const;
  for (const [root, scaleId, symbol] of contexts) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    const scalePcs = new Set(scaleNotes.map((note) => note.pc));
    const landing = new Set(
      cadencePitchClasses(chordNotes, 'fifth', scalePcs),
    );
    // The label names a chord degree, but the note keeps the scale's own
    // spelling: ultralocrian spells a chord's major third as a flat fourth,
    // which is the point of preserving spelling. So compare pitch classes.
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const phrase = phraseOf(root, scaleId, symbol, seed, bars);
        const last = phrase.notes.at(-1);
        assert.ok(last);
        const expected = new Set(
          cadencePitchClasses(chordNotes, phrase.plan.cadence, scalePcs),
        );
        assert.equal(
          expected.has(last.pc),
          true,
          `${symbol} seed ${seed} landed ${last.name} for ${phrase.plan.cadence}`,
        );
        if (phrase.plan.cadence === 'fifth') {
          assert.equal(landing.has(last.pc), true);
        }
      }
    }
  }
});

void test('the loop wrap obeys the arrival rule the phrase obeys inside', () => {
  // A looping pass skips the closing cadence, so the interval from the last
  // body note to the next pass's first note is a real sounding move. It gets
  // the same size limits as any other move.
  const contexts = [
    ['C', 'major', 'C'],
    ['A', 'dorian', 'Am'],
    ['C', 'minor-blues', 'C7'],
    ['Bb', 'mixolydian', 'Bb7'],
    ['E', 'minor', 'Em'],
  ] as const;
  let illegal = 0;
  let total = 0;
  for (const [root, scaleId, symbol] of contexts) {
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const phrase = phraseOf(root, scaleId, symbol, seed, bars);
        const body = phrase.notes.filter((note) => note.beat < bars * 4);
        const last = body[body.length - 1];
        const first = phrase.notes[0];
        assert.ok(last && first);
        assert.equal(
          loopSeamLegal(last.midi, last.duration, first.midi),
          true,
          `${symbol} seed ${seed} ${bars}: ${last.midi} -> ${first.midi}`,
        );
        total += 1;
        if (!loopSeamLegal(last.midi, last.duration, first.midi)) illegal += 1;
      }
    }
  }
  assert.equal(illegal, 0);
  assert.ok(total > 0);
});

void test('the loop period still lands on the downbeat after the cadence', () => {
  // The wrap fix must not move the loop point: it stays bars * 4, and the
  // closing cadence still starts there and is still skipped.
  for (const bars of [2, 4] as const) {
    const phrase = phraseOf('C', 'major', 'C', 1, bars);
    assert.equal(phraseLoopBeats(phrase.notes), bars * 4);
    assert.equal(phrase.notes.at(-1)?.beat, bars * 4);
  }
});

void test('a pinned contour always produces that shape', () => {
  const contexts = [
    ['C', 'major', 'C'],
    ['A', 'dorian', 'Am'],
    ['F#', 'major', 'F#maj7'],
    ['C', 'minor-blues', 'C7'],
  ] as const;
  const contours = ['arch', 'rise', 'fall', 'wave'] as const;
  for (const [root, scaleId, symbol] of contexts) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    for (const contour of contours) {
      for (const bars of [2, 4] as const) {
        for (let seed = 1; seed <= 10; seed++) {
          const result = generatePhrase({
            seed,
            bars,
            scaleNotes,
            chordNotes,
            locks: { contour },
          });
          assert.equal(result.ok, true, `${symbol} ${contour} ${seed} ${bars}`);
          if (!result.ok) continue;
          // Judge the body, not the closing cadence, which is a structural
          // landing chosen by the cadence lock rather than part of the shape.
          const body = result.phrase.notes.filter((note) => note.beat < bars * 4);
          const third = Math.max(1, Math.floor(body.length / 3));
          const mean = (from: number, to: number) => {
            let sum = 0;
            for (let index = from; index < to; index++) sum += body[index].midi;
            return sum / (to - from);
          };
          const first = mean(0, third);
          const middle = mean(third, third * 2);
          const last = mean(third * 2, body.length);
          const fits =
            contour === 'rise'
              ? last > first
              : contour === 'fall'
                ? first > last
                : contour === 'arch'
                  ? middle > first && middle > last
                  : middle < first && middle < last;
          assert.equal(fits, true, `${symbol} ${contour} seed ${seed} ${bars}`);
        }
      }
    }
  }
});

void test('register moves the hand, not just the pitch', () => {
  const scaleNotes = scaleOf('C', 'major');
  const chordNotes = parseChord('C').notes;
  const meanFret = (register: 'low' | 'mid' | 'high') => {
    let total = 0;
    let count = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const result = generatePhrase({
        seed,
        bars: 2,
        scaleNotes,
        chordNotes,
        locks: { register },
      });
      assert.equal(result.ok, true);
      if (!result.ok) continue;
      for (const note of result.phrase.notes) {
        total += note.fret;
        count += 1;
      }
    }
    return total / count;
  };
  const low = meanFret('low');
  const mid = meanFret('mid');
  const high = meanFret('high');
  // Each register steps the hand up the neck, and Low really is near the nut
  // rather than the old four-fret box around fret 7.
  assert.ok(low < 5, `low mean fret ${low}`);
  assert.ok(low < mid, `low ${low} mid ${mid}`);
  assert.ok(mid < high, `mid ${mid} high ${high}`);
});

void test('the rhythm labels describe the lane they name', () => {
  const source = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  // "quarter notes" promised a beginner exercise the pool never played.
  assert.equal(source.includes("quarters: 'quarter notes'"), false);
  assert.match(source, /quarters: 'quarters with eighths'/);
});
