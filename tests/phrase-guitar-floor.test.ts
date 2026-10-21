import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, TUNING, spell } from '../lib/music.ts';
import {
  PHRASE_CELL_LIMIT,
  PHRASE_RANGE,
  generatePhrase,
  generatePhraseWithPlanner,
  generateShapedPhrase,
  phraseCellLength,
  type FingeredNote,
  type Phrase,
} from '../lib/phrase.ts';
import { recordedPhrasePlanner } from './phrase-plan-fixture.ts';

/** The eight contexts Rev measured, 2 and 4 bars, seeds 1–24. */
const CORPUS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['A', 'harmonic-minor', 'E7'],
  ['C', 'minor-pentatonic', 'Cm'],
  ['C', 'minor-blues', 'C7'],
  ['Bb', 'mixolydian', 'Bb7'],
];

const REGISTER_LOW = { low: 48, mid: 55, high: 64 } as const;

type Floor = {
  skips: number;
  octaves: number;
  cells: number;
  loops: number;
  shapes: number;
  strong: number;
  strongChord: number;
  illegal: number;
  strongOutside: number;
};

function stringSkips(notes: readonly FingeredNote[]): number {
  let count = 0;
  for (let index = 1; index < notes.length; index++) {
    const previous = notes[index - 1];
    const next = notes[index];
    if (!previous || !next) continue;
    if (Math.abs(next.string - previous.string) >= 3) count += 1;
  }
  return count;
}

function octaveLeaps(notes: readonly FingeredNote[]): number {
  let count = 0;
  for (let index = 1; index < notes.length; index++) {
    const previous = notes[index - 1];
    const next = notes[index];
    if (!previous || !next) continue;
    if (Math.abs(next.midi - previous.midi) >= 12) count += 1;
  }
  return count;
}

function repeatsMidiCell(notes: readonly FingeredNote[]): boolean {
  const midis = notes.map((note) => note.midi);
  for (let start = 0; start + 2 < midis.length; start++) {
    for (let again = start + 3; again + 2 < midis.length; again++) {
      if (
        midis[start] === midis[again] &&
        midis[start + 1] === midis[again + 1] &&
        midis[start + 2] === midis[again + 2]
      ) {
        return true;
      }
    }
  }
  return false;
}

function lineIsIllegal(notes: readonly FingeredNote[]): boolean {
  return notes.some((note) => {
    if (note.fret < 0 || note.fret > 24) return true;
    const open = TUNING[note.string];
    if (open === undefined || note.midi !== open + note.fret) return true;
    return note.strong && !note.chordTone;
  });
}

function strongLeavesRegister(phrase: Phrase): boolean {
  const low = REGISTER_LOW[phrase.plan.register];
  const high = low + PHRASE_RANGE;
  return phrase.notes.some(
    (note) => note.strong && (note.midi < low || note.midi > high),
  );
}

function blank(): Floor {
  return {
    skips: 0,
    octaves: 0,
    cells: 0,
    loops: 0,
    shapes: 0,
    strong: 0,
    strongChord: 0,
    illegal: 0,
    strongOutside: 0,
  };
}

function add(bucket: Floor, phrase: Phrase): void {
  bucket.skips += stringSkips(phrase.notes);
  bucket.octaves += octaveLeaps(phrase.notes);
  if (repeatsMidiCell(phrase.notes)) bucket.cells += 1;
  if (phraseCellLength(phrase.notes.map((note) => note.midi)) > PHRASE_CELL_LIMIT)
    bucket.loops += 1;
  if (phrase.plan.shape) bucket.shapes += 1;
  if (lineIsIllegal(phrase.notes)) bucket.illegal += 1;
  if (strongLeavesRegister(phrase)) bucket.strongOutside += 1;
  for (const note of phrase.notes) {
    if (!note.strong) continue;
    bucket.strong += 1;
    if (note.chordTone) bucket.strongChord += 1;
  }
}

void test('shaped and recorded Jev lines stay inside the rules guitar floor', async () => {
  const recorded = JSON.parse(
    readFileSync(
      new URL('./fixtures/phrase-plan-jev-recorded.json', import.meta.url),
      'utf8',
    ),
  ) as { contexts: Record<string, unknown> };
  const planner = recordedPhrasePlanner(recorded.contexts);
  const rules = blank();
  const shaped = blank();
  const planned = blank();
  for (const [root, scaleId, chord] of CORPUS) {
    const scale = SCALES.find((item) => item.id === scaleId);
    if (!scale) throw new Error(scaleId);
    const scaleNotes = spell(root, scale.formula);
    const chordNotes = parseChord(chord).notes;
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const live = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        const next = generateShapedPhrase({ seed, bars, scaleNotes, chordNotes });
        const jev = await generatePhraseWithPlanner({
          seed,
          bars,
          scaleNotes,
          chordNotes,
          scaleId,
          scaleRoot: root,
          chordSymbol: chord,
          planner,
        });
        assert.equal(live.ok, true);
        assert.equal(next.ok, true);
        assert.equal(jev.ok, true);
        if (!live.ok || !next.ok || !jev.ok) continue;
        add(rules, live.phrase);
        add(shaped, next.phrase);
        add(planned, jev.phrase);
      }
    }
  }
  assert.deepEqual(rules, {
    skips: 10,
    octaves: 0,
    cells: 119,
    loops: 8,
    shapes: 0,
    strong: 2688,
    strongChord: 2688,
    illegal: 0,
    strongOutside: 0,
  });
  for (const bucket of [shaped, planned]) {
    assert.equal(bucket.illegal, 0);
    assert.equal(bucket.strong, 2688);
    assert.equal(bucket.strongChord, 2688);
    assert.equal(bucket.strongOutside, 0);
    assert.ok(bucket.skips <= 10);
    assert.equal(bucket.octaves, 0);
    assert.ok(bucket.cells <= 119);
    assert.ok(bucket.loops <= 8);
  }
  assert.ok(shaped.shapes >= 251);
  assert.ok(planned.shapes >= 270);
});

void test('a shaped C Phrygian line keeps strong beats inside the register', () => {
  const scale = SCALES.find((item) => item.id === 'phrygian');
  if (!scale) throw new Error('phrygian');
  const shaped = generateShapedPhrase({
    seed: 1,
    bars: 2,
    scaleNotes: spell('C', scale.formula),
    chordNotes: parseChord('Cm').notes,
  });
  assert.equal(shaped.ok, true);
  if (!shaped.ok) return;
  assert.equal(shaped.phrase.plan.register, 'mid');
  const low = REGISTER_LOW.mid;
  const high = low + PHRASE_RANGE;
  assert.equal(
    shaped.phrase.notes.some(
      (note) => note.strong && (note.midi < low || note.midi > high),
    ),
    false,
  );
});
