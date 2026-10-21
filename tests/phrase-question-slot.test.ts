import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, TUNING, spell } from '../lib/music.ts';
import {
  PHRASE_CELL_LIMIT,
  generatePhraseWithPlanner,
  isStrongBeat,
  melodicMotion,
  phraseCellLength,
  phraseOnsets,
  questionEventOrder,
  type FingeredNote,
  type RhythmId,
} from '../lib/phrase.ts';
import {
  questionHits,
  questionSlot,
  scaleDegreeNumber,
  type PhraseShapePlan,
} from '../lib/phrase-shape.ts';
import { recordedPhrasePlanner } from './phrase-plan-fixture.ts';

const shape = {
  version: 1 as const,
  motif: { contour: 'step-up-step-down' as const, rhythm: 'even' as const },
  variations: ['altered-ending' as const],
  question: { bar: 1 as const, degree: '4' as const },
};

function notes(
  pairs: readonly (readonly [number, string])[],
): { beat: number; degree: string }[] {
  return pairs.map(([beat, degree]) => ({ beat, degree }));
}

void test('the question prefers the last note, then the latest weak attack', () => {
  assert.equal(
    questionSlot(
      notes([
        [0, '1'],
        [1, '4'],
        [2, '5'],
        [3, '4'],
      ]),
      shape,
    ),
    3,
  );
  assert.equal(
    questionHits(
      notes([
        [0, '1'],
        [1, '4'],
        [2, '5'],
        [3, 'b7'],
        [3.5, 'b5'],
      ]),
      shape,
    ),
    true,
  );
  assert.equal(
    questionSlot(
      notes([
        [0, '1'],
        [1, '4'],
        [2, '5'],
        [3, '4'],
        [3.5, 'b5'],
      ]),
      shape,
    ),
    3,
  );
  assert.equal(
    questionSlot(
      notes([
        [0, '1'],
        [1, '5'],
        [2, '4'],
        [3, 'b7'],
      ]),
      shape,
    ),
    -1,
  );
  assert.equal(questionHits(notes([[1, '4']]), shape), true);
  assert.equal(
    questionHits(notes([[0, '4'], [2, '1'], [3, '5']]), shape),
    false,
  );
  const strongBeats = [0, 2, 4, 6];
  const weakBeats = [0.5, 1, 1.5, 2.5, 3, 3.5, 5, 7.5];
  for (const beat of strongBeats) assert.equal(isStrongBeat(beat), true);
  for (const beat of weakBeats) assert.equal(isStrongBeat(beat), false);
});

function guardsHold(
  played: readonly FingeredNote[],
  scalePcs: ReadonlySet<number>,
): void {
  assert.equal(played.at(-1)?.chordTone, true);
  assert.ok(
    phraseCellLength(played.map((note) => note.midi)) <= PHRASE_CELL_LIMIT,
  );
  for (let index = 0; index < played.length; index++) {
    const note = played[index];
    assert.ok(note);
    assert.ok(note.fret >= 0 && note.fret <= 24);
    assert.equal(TUNING[note.string], note.midi - note.fret);
    if (!note.strong) continue;
    assert.equal(note.chordTone, true);
    if (index === 0) continue;
    const previous = played[index - 1];
    assert.ok(previous);
    assert.equal(melodicMotion(previous.midi, note.midi, scalePcs), 'step');
  }
}

void test('strong beats stay out of the question search', () => {
  const rhythms = ['quarters', 'eighths', 'long-short', 'push'] as const satisfies readonly RhythmId[];
  for (const rhythm of rhythms) {
    for (const bars of [2, 4] as const) {
      const beats = phraseOnsets(rhythm, bars);
      const events = beats.map((beat) => ({
        beat,
        strong: isStrongBeat(beat),
      }));
      for (const bar of [1, 2] as const) {
        const order = questionEventOrder(events, bar);
        const start = (bar - 1) * 4;
        const end = bar * 4;
        const inBar = events
          .map((event, index) => ({ event, index }))
          .filter(
            (item) => item.event.beat >= start && item.event.beat < end,
          );
        const last = inBar[inBar.length - 1];
        assert.ok(last);
        if (!last) continue;
        assert.equal(order[0], last.index);
        for (const index of order.slice(1)) {
          assert.equal(
            events[index]?.strong,
            false,
            `${rhythm} ${bars} bar ${bar} index ${index}`,
          );
        }
        const strongEarlier = inBar
          .slice(0, -1)
          .filter((item) => item.event.strong);
        assert.ok(strongEarlier.length > 0);
        for (const item of strongEarlier) {
          assert.equal(order.includes(item.index), false);
        }
      }
    }
  }
});

void test('minor blues keeps a question on a weak attack', async () => {
  const scale = SCALES.find((item) => item.id === 'minor-blues');
  assert.ok(scale);
  const scaleNotes = spell('C', scale.formula);
  const chordNotes = parseChord('C7').notes;
  const scalePcs = new Set(scaleNotes.map((note) => note.pc));
  const recorded = JSON.parse(
    readFileSync(
      new URL('./fixtures/phrase-plan-jev-recorded.json', import.meta.url),
      'utf8',
    ),
  ) as { contexts: Record<string, unknown> };
  const planner = recordedPhrasePlanner(recorded.contexts);
  const result = await generatePhraseWithPlanner({
    seed: 1,
    bars: 2,
    scaleNotes,
    chordNotes,
    scaleId: 'minor-blues',
    scaleRoot: 'C',
    chordSymbol: 'C7',
    locks: { rhythm: 'eighths' },
    planner,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const planShape: PhraseShapePlan | undefined = result.phrase.plan.shape;
  assert.equal(result.phrase.source, 'planner');
  assert.ok(planShape);
  if (!planShape) return;
  assert.equal(questionHits(result.phrase.notes, planShape), true);
  const slot = questionSlot(result.phrase.notes, planShape);
  const question = result.phrase.notes[slot];
  assert.ok(question);
  if (!question) return;
  assert.equal(scaleDegreeNumber(question.degree), Number(planShape.question.degree));
  assert.equal(isStrongBeat(question.beat), false);
  assert.equal(question.beat, 3);
  assert.equal(question.degree, '4');
  const barStart = (planShape.question.bar - 1) * 4;
  const inBar = result.phrase.notes.filter(
    (note) => note.beat >= barStart && note.beat < barStart + 4,
  );
  const last = inBar[inBar.length - 1];
  assert.notEqual(scaleDegreeNumber(last?.degree ?? ''), Number(planShape.question.degree));
  guardsHold(result.phrase.notes, scalePcs);

  let kept = 0;
  for (const bars of [2, 4] as const) {
    for (let seed = 1; seed <= 24; seed++) {
      const next = await generatePhraseWithPlanner({
        seed,
        bars,
        scaleNotes,
        chordNotes,
        scaleId: 'minor-blues',
        scaleRoot: 'C',
        chordSymbol: 'C7',
        locks: { rhythm: 'eighths' },
        planner,
      });
      assert.equal(next.ok, true);
      if (!next.ok || !next.phrase.plan.shape) continue;
      kept += 1;
      const placed = questionSlot(next.phrase.notes, next.phrase.plan.shape);
      const note = next.phrase.notes[placed];
      assert.ok(note);
      if (!note) continue;
      assert.equal(isStrongBeat(note.beat), false);
      assert.equal(
        scaleDegreeNumber(note.degree),
        Number(next.phrase.plan.shape.question.degree),
      );
      guardsHold(next.phrase.notes, scalePcs);
    }
  }
  assert.ok(kept > 0);
});
