import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import {
  PHRASE_CELL_LIMIT,
  PHRASE_MIN_RANGE,
  PHRASE_RANGE,
  PHRASE_WIDE_LEAP,
  cadencePitchClasses,
  generatePhrase,
  melodicMotion,
  phraseCellLength,
  phraseRuleReport,
  type Phrase,
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

void test('C major seed 1 falls instead of looping G and A', () => {
  const { phrase } = phraseFor('C', 'major', 'C', 1, 2);
  assert.equal(phrase.plan.contour, 'fall');
  assert.equal(phrase.plan.cadence, 'fifth');
  assert.deepEqual(
    phrase.notes.map((note) => `${note.name}${note.midi}@${note.beat}`),
    [
      'C72@0',
      'G67@1',
      'A69@1.5',
      'G67@2',
      'D62@3',
      'E64@4',
      'D62@5',
      'C60@6',
      'B59@7',
      'A57@7.5',
      'G55@8',
    ],
  );
  assert.equal(phrase.notes.at(-1)?.name, 'G');
  assert.equal(phrase.notes.at(-1)?.midi, 55);
});

void test('A dorian seed 7 arches instead of looping E and F#', () => {
  const { phrase } = phraseFor('A', 'dorian', 'Am', 7, 2);
  assert.equal(phrase.plan.contour, 'arch');
  assert.equal(phrase.plan.register, 'high');
  assert.equal(phrase.plan.cadence, 'fifth');
  assert.deepEqual(
    phrase.notes.map((note) => note.name),
    [
      'E',
      'A',
      'G',
      'A',
      'D',
      'C',
      'D',
      'E',
      'D',
      'C',
      'B',
      'A',
      'G',
      'F#',
      'E',
    ],
  );
  assert.equal(phrase.notes[0]?.midi, 64);
  assert.equal(phrase.notes.at(-1)?.midi, 64);
  assert.ok(Math.max(...phrase.notes.map((note) => note.midi)) >= 76);
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
        assert.ok(report.range <= PHRASE_RANGE);
        assert.ok(
          report.range >= PHRASE_MIN_RANGE,
          `${symbol} ${scaleId} seed ${seed} spans ${report.range}`,
        );
        assert.ok(
          phraseCellLength(phrase.notes.map((note) => note.midi)) <=
            PHRASE_CELL_LIMIT,
          `${symbol} ${scaleId} seed ${seed} ${bars}`,
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
