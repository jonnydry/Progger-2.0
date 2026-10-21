import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  availableCadences,
  generatePhraseWithPlanner,
  isStrongBeat,
  melodicMotion,
  mulberry32,
  phraseCellLength,
  PHRASE_CELL_LIMIT,
  rulePlan,
  type FingeredNote,
} from '../lib/phrase.ts';
import { motifRhythmsFor, questionHits, rollShape } from '../lib/phrase-shape.ts';
import { recordedPhrasePlanner } from './phrase-plan-fixture.ts';

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
    if (!note.strong) continue;
    assert.equal(note.chordTone, true);
    if (index === 0) continue;
    const previous = played[index - 1];
    assert.ok(previous);
    assert.equal(melodicMotion(previous.midi, note.midi, scalePcs), 'step');
    assert.equal(isStrongBeat(note.beat), true);
  }
}

void test('a stripped rules motif is re-rolled on the locked rhythm', async () => {
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const scaleNotes = spell('C', scale.formula);
  const chordNotes = parseChord('C').notes;
  const available = availableCadences(chordNotes, scaleNotes);
  const natural = rulePlan(78, available, undefined, 2);
  assert.equal(natural.shape?.motif.rhythm, 'long-short-short');
  assert.equal(
    motifRhythmsFor('quarters').includes(natural.shape?.motif.rhythm ?? 'even'),
    false,
  );
  const recorded = JSON.parse(
    readFileSync(
      new URL('./fixtures/phrase-plan-jev-recorded.json', import.meta.url),
      'utf8',
    ),
  ) as { contexts: Record<string, unknown> };
  const result = await generatePhraseWithPlanner({
    seed: 78,
    bars: 2,
    scaleNotes,
    chordNotes,
    scaleId: 'major',
    scaleRoot: 'C',
    chordSymbol: 'C',
    locks: { rhythm: 'quarters' },
    planner: recordedPhrasePlanner(recorded.contexts),
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.phrase.source, 'rules');
  assert.equal(result.phrase.plan.rhythm, 'quarters');
  assert.equal(result.phrase.plan.shape?.motif.rhythm, 'even');
  assert.ok(result.phrase.plan.shape);
  if (!result.phrase.plan.shape) return;
  const relocked = rollShape(mulberry32((78 + 0x6c1e) >>> 0), 2, 'quarters');
  const rulesStream = rollShape(mulberry32(78), 2, 'quarters');
  assert.deepEqual(result.phrase.plan.shape, relocked);
  assert.notDeepEqual(result.phrase.plan.shape, rulesStream);
  assert.deepEqual(rulePlan(78, available, undefined, 2).shape, natural.shape);
  assert.equal(questionHits(result.phrase.notes, result.phrase.plan.shape), true);
  guardsHold(
    result.phrase.notes,
    new Set(scaleNotes.map((note) => note.pc)),
  );
});
