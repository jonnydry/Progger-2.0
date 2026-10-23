import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { phraseClosingIndex, phraseLoopBeats } from '../lib/phrase-audio.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import {
  generatePhrase,
  isStrongBeat,
  phrasePeriodBeats,
  phraseRuleReport,
  type Phrase,
} from '../lib/phrase.ts';

const CONTEXTS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['D', 'dorian', 'Dm7'],
  ['E', 'minor', 'Em'],
];

function scaleOf(root: string, id: string): Note[] {
  const scale = SCALES.find((item) => item.id === id);
  assert.ok(scale, id);
  return spell(root, scale.formula);
}

function generate(
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
  assert.equal(result.ok, true, `${symbol} seed ${seed} ${bars}`);
  if (!result.ok) throw new Error(symbol);
  return result.phrase;
}

function barOnsets(phrase: Phrase, bar: number): string {
  return phrase.notes
    .filter(
      (note) =>
        Math.floor(note.beat / 4) === bar && note.beat < phrase.bars * 4,
    )
    .map((note) => note.beat - bar * 4)
    .join(',');
}

function scaleSteps(
  midis: readonly number[],
  pcs: ReadonlySet<number>,
): number[] {
  const steps: number[] = [];
  for (let index = 1; index < midis.length; index++) {
    const from = midis[index - 1];
    const to = midis[index];
    if (from === to) {
      steps.push(0);
      continue;
    }
    const sign = Math.sign(to - from);
    let midi = from;
    let count = 0;
    while (midi !== to && count < 24) {
      midi += sign;
      if (pcs.has(((midi % 12) + 12) % 12)) count += 1;
    }
    steps.push(sign * count);
  }
  return steps;
}

void test('the same seed replays the same line, including a locked plan', () => {
  for (const [root, scaleId, symbol] of CONTEXTS) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 40; seed++) {
        const first = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        const second = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        assert.deepEqual(second, first);
        const locked = generatePhrase({
          seed,
          bars,
          scaleNotes,
          chordNotes,
          locks: {
            contour: 'fall',
            rhythm: 'push',
            register: 'mid',
            cadence: 'fifth',
          },
        });
        assert.equal(locked.ok, true, `${symbol} lock ${seed}`);
        if (!locked.ok) continue;
        assert.equal(locked.phrase.plan.contour, 'fall');
        assert.equal(locked.phrase.plan.rhythm, 'push');
        assert.equal(locked.phrase.plan.register, 'mid');
        const roles = new Set(
          chordNotes
            .filter(
              (note) =>
                note.degree === '5' ||
                note.degree === '#5' ||
                note.degree === 'b5',
            )
            .map((note) => note.pc),
        );
        if (roles.size)
          assert.ok(roles.has(locked.phrase.notes.at(-1)?.pc ?? -1));
      }
    }
  }
});

void test('the closing note sits on the bar after the phrase and the loop wraps there', () => {
  for (const bars of [2, 4] as const) {
    const phrase = generate('C', 'major', 'C', 4, bars);
    const last = phrase.notes.at(-1);
    assert.ok(last);
    assert.equal(last.beat, bars * 4);
    assert.equal(last.duration, 2);
    assert.equal(phraseClosingIndex(phrase.notes), phrase.notes.length - 1);
    assert.equal(phraseLoopBeats(phrase.notes), bars * 4);
    assert.equal(phrasePeriodBeats(bars), bars * 4 + 2);
    assert.ok(phrase.notes.slice(0, -1).every((note) => note.beat < bars * 4));
    for (const note of phrase.notes) {
      assert.equal(note.strong, isStrongBeat(note.beat));
      assert.ok(Math.abs(note.beat * 2 - Math.round(note.beat * 2)) < 1e-6);
      assert.ok(note.duration > 0);
    }
  }
});

void test('lines stay legal and a motif comes back on a varied rhythm', () => {
  let phrases = 0;
  let sameRhythm = 0;
  let quarterWalks = 0;
  let motif = 0;
  let rests = 0;
  let notes = 0;
  let sync = 0;
  let strong = 0;
  let strongChord = 0;
  for (const [root, scaleId, symbol] of CONTEXTS) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    const pcs = new Set(scaleNotes.map((note) => note.pc));
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const phrase = generate(root, scaleId, symbol, seed, bars);
        const report = phraseRuleReport(phrase, scaleNotes, chordNotes);
        assert.equal(report.unisons, 0);
        assert.equal(report.unresolved, 0);
        assert.equal(report.cadenceHit, true);
        assert.ok(report.strong > 0);
        assert.equal(report.strongChord, report.strong);
        phrases += 1;
        strong += report.strong;
        strongChord += report.strongChord;
        const signatures = Array.from({ length: bars }, (_, bar) =>
          barOnsets(phrase, bar),
        );
        if (signatures.every((signature) => signature === signatures[0]))
          sameRhythm += 1;
        const body = phrase.notes.filter((note) => note.beat < bars * 4);
        const quarter =
          body.length > 0 &&
          body.every(
            (note) =>
              Math.abs(note.beat - Math.round(note.beat)) < 1e-6 &&
              Math.abs(note.duration - 1) < 1e-6,
          );
        if (quarter) quarterWalks += 1;
        const groups: number[][] = Array.from({ length: bars }, () => []);
        for (const note of body)
          groups[Math.floor(note.beat / 4)].push(note.midi);
        const deltas = groups.map((group) => scaleSteps(group, pcs));
        const head = deltas[0]?.slice(0, 3) ?? [];
        let returned = false;
        if (head.length >= 2) {
          for (let bar = 1; bar < deltas.length; bar++) {
            const span = Math.min(3, head.length, deltas[bar].length);
            if (span < 2) continue;
            let match = true;
            for (let index = 0; index < span; index++) {
              if (deltas[bar][index] !== head[index]) match = false;
            }
            if (match && (span >= 3 || head.length === 2)) returned = true;
          }
        }
        if (returned) motif += 1;
        const onsets = new Set(phrase.notes.map((note) => note.beat));
        let cursor = 0;
        while (cursor < bars * 4 - 1e-9) {
          if (!onsets.has(cursor)) rests += 1;
          cursor += 0.5;
        }
        for (const note of phrase.notes) {
          notes += 1;
          if (note.strong) continue;
          const beat = note.beat;
          if (Math.abs(beat * 2 - Math.round(beat * 2)) > 1e-6) continue;
          if (Math.abs(beat - Math.round(beat)) < 1e-6) continue;
          const down = Math.ceil(beat);
          if (!onsets.has(down)) sync += 1;
        }
      }
    }
  }
  assert.equal(strongChord, strong);
  assert.ok(
    sameRhythm / phrases < 0.15,
    `same rhythm ${sameRhythm}/${phrases}`,
  );
  assert.ok(
    quarterWalks / phrases < 0.15,
    `quarter walks ${quarterWalks}/${phrases}`,
  );
  assert.ok(motif / phrases > 0.2, `motif ${motif}/${phrases}`);
  assert.ok(rests / phrases > 1, `rests ${rests}/${phrases}`);
  assert.ok(sync / notes > 0.05, `sync ${sync}/${notes}`);
});
