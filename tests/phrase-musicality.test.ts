import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
        assert.equal(report.cadenceHit, true);
        assert.ok(report.strong > 0);
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
  assert.ok(strongChord / strong >= 0.5, `strong chord ${strongChord}/${strong}`);
  assert.ok(strongChord / strong <= 0.88, `strong chord ${strongChord}/${strong}`);
  assert.ok(
    sameRhythm / phrases < 0.15,
    `same rhythm ${sameRhythm}/${phrases}`,
  );
  assert.ok(
    quarterWalks / phrases < 0.15,
    `quarter walks ${quarterWalks}/${phrases}`,
  );
  assert.ok(motif / phrases > 0.7, `motif ${motif}/${phrases}`);
  assert.ok(rests / phrases > 1, `rests ${rests}/${phrases}`);
  assert.ok(sync / notes > 0.05, `sync ${sync}/${notes}`);
});

const SWEEP: readonly (readonly [string, string, string])[] = [
  ...CONTEXTS,
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'harmonic-minor', 'E7'],
];

function alternationRun(midis: readonly number[]): number {
  let best = 1;
  let run = 1;
  for (let index = 1; index < midis.length; index++) {
    if (midis[index] === midis[index - 1]) run = 1;
    else if (index >= 2 && midis[index] === midis[index - 2]) run += 1;
    else run = 2;
    if (run > best) best = run;
  }
  return best;
}

void test('two-pitch wobble stays under three percent', () => {
  let phrases = 0;
  let narrow = 0;
  let alternating = 0;
  let intervals = 0;
  let small = 0;
  let wide = 0;
  let strong = 0;
  let strongChord = 0;
  for (const [root, scaleId, symbol] of SWEEP) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const phrase = generate(root, scaleId, symbol, seed, bars);
        phrases += 1;
        for (const note of phrase.notes) {
          if (note.shift) assert.ok(note.duration > 0.5);
          assert.equal(note.degree === 'chr', false);
        }
        const report = phraseRuleReport(phrase, scaleNotes, chordNotes);
        strong += report.strong;
        strongChord += report.strongChord;
        let tight = false;
        for (let bar = 0; bar < bars; bar++) {
          const group = phrase.notes.filter(
            (note) =>
              Math.floor(note.beat / 4) === bar && note.beat < bars * 4,
          );
          if (
            group.length >= 4 &&
            new Set(group.map((note) => note.midi)).size <= 2
          )
            tight = true;
        }
        if (tight) narrow += 1;
        const midis = phrase.notes.map((note) => note.midi);
        if (alternationRun(midis) >= 5) alternating += 1;
        for (let index = 1; index < midis.length; index++) {
          intervals += 1;
          const gap = Math.abs(midis[index] - midis[index - 1]);
          if (gap <= 2) small += 1;
          if (gap >= 5) wide += 1;
        }
      }
    }
  }
  assert.equal(phrases, 384);
  assert.ok(narrow / phrases <= 0.03, `narrow bars ${narrow}/${phrases}`);
  assert.ok(
    alternating / phrases <= 0.03,
    `alternation ${alternating}/${phrases}`,
  );
  assert.ok(small / intervals >= 0.5, `steps ${small}/${intervals}`);
  assert.ok(small / intervals <= 0.8, `steps ${small}/${intervals}`);
  assert.ok(wide / intervals >= 0.05, `leaps ${wide}/${intervals}`);
  assert.ok(
    strongChord / strong >= 0.5 && strongChord / strong <= 0.88,
    `strong chord ${strongChord}/${strong}`,
  );
});

function pitchCycle(
  midis: readonly number[],
  period: number,
  cycles: number,
  cover: readonly [number, number] | null = null,
): boolean {
  const length = period * cycles;
  for (let start = 0; start + length <= midis.length; start++) {
    if (cover && start >= cover[0] && start + length <= cover[1]) continue;
    let match = true;
    for (let index = period; index < length; index++) {
      if (midis[start + index] !== midis[start + (index % period)]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    if (new Set(midis.slice(start, start + period)).size < 2) continue;
    return true;
  }
  return false;
}

function monotoneRun(midis: readonly number[], pcs: ReadonlySet<number>): number {
  let best = 1;
  let run = 1;
  let dir = 0;
  for (let index = 1; index < midis.length; index++) {
    const delta = scaleSteps(
      [midis[index - 1] ?? 0, midis[index] ?? 0],
      pcs,
    )[0] ?? 0;
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

void test('a sentence returns the opening figure, shifted more often than copied', () => {
  let phrases = 0;
  let returned = 0;
  let shifted = 0;
  let exact = 0;
  let identical = 0;
  let bars = 0;
  let silent = 0;
  let strong = 0;
  let strongChord = 0;
  let wide = 0;
  let period3 = 0;
  let period9 = 0;
  let period2 = 0;
  let period4 = 0;
  let runs2 = 0;
  let runs4 = 0;
  let twoBar = 0;
  let fourBar = 0;
  let alt4 = 0;
  let aba = 0;
  let intervals = 0;
  let topHeavy = 0;
  const times: number[] = [];
  for (const [root, scaleId, symbol] of SWEEP) {
    const scaleNotes = scaleOf(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    const pcs = new Set(scaleNotes.map((note) => note.pc));
    for (const barsCount of [2, 4] as const) {
      for (let seed = 1; seed <= 50; seed++) {
        const started = performance.now();
        const phrase = generate(root, scaleId, symbol, seed, barsCount);
        times.push(performance.now() - started);
        const again = generate(root, scaleId, symbol, seed, barsCount);
        assert.deepEqual(again.notes, phrase.notes);
        phrases += 1;
        if (barsCount === 2) twoBar += 1;
        else fourBar += 1;
        const body = phrase.notes.filter((note) => note.beat < barsCount * 4);
        const groups = Array.from({ length: barsCount }, (_, bar) =>
          body.filter((note) => Math.floor(note.beat / 4) === bar),
        );
        const signatures = groups.map((group) =>
          group.map((note) => Math.round((note.beat % 4) * 2)).join(','),
        );
        if (signatures.every((signature) => signature === signatures[0]))
          identical += 1;
        for (const group of groups) {
          bars += 1;
          const struck = group.some(
            (note) => Math.abs(note.beat - Math.round(note.beat)) < 1e-6,
          );
          if (!struck) silent += 1;
          for (const note of group) {
            assert.ok(note.fret >= 0 && note.fret <= 24);
            if (note.shift) assert.ok(note.duration > 0.5);
          }
        }
        const opening = groups[0] ?? [];
        const answer = groups[1] ?? [];
        let cover: [number, number] | null = null;
        if (opening.length >= 4 && answer.length >= 4) {
          const left = opening
            .slice(0, 4)
            .map((note) => Math.round((note.beat % 4) * 2))
            .join(',');
          const right = answer
            .slice(0, 4)
            .map((note) => Math.round((note.beat % 4) * 2))
            .join(',');
          const leftSteps = scaleSteps(
            opening.slice(0, 4).map((note) => note.midi),
            pcs,
          ).join(',');
          const rightSteps = scaleSteps(
            answer.slice(0, 4).map((note) => note.midi),
            pcs,
          ).join(',');
          if (left === right && leftSteps === rightSteps) {
            returned += 1;
            const samePitch =
              opening
                .slice(0, 4)
                .map((note) => note.midi)
                .join(',') ===
              answer
                .slice(0, 4)
                .map((note) => note.midi)
                .join(',');
            if (samePitch) exact += 1;
            else shifted += 1;
            const from = phrase.notes.indexOf(opening[0] ?? phrase.notes[0]);
            const last = answer[3];
            const to = last ? phrase.notes.indexOf(last) + 1 : from;
            if (from >= 0 && to > from) cover = [from, to];
          }
        }
        const report = phraseRuleReport(phrase, scaleNotes, chordNotes);
        strong += report.strong;
        strongChord += report.strongChord;
        const midis = phrase.notes.map((note) => note.midi);
        for (let index = 1; index < midis.length; index++) {
          const gap = Math.abs((midis[index] ?? 0) - (midis[index - 1] ?? 0));
          assert.ok(gap > 0 && gap <= 12);
          const duration = phrase.notes[index]?.duration ?? 1;
          if (duration <= 0.5) assert.ok(gap <= 5);
          if (gap > 12) wide += 1;
        }
        if (pitchCycle(midis, 3, 2, cover)) period3 += 1;
        if (pitchCycle(midis, 3, 3, cover)) period9 += 1;
        if (pitchCycle(midis, 2, 2)) period2 += 1;
        if (pitchCycle(midis, 4, 2)) period4 += 1;
        if (monotoneRun(midis, pcs) >= 5) {
          if (barsCount === 2) runs2 += 1;
          else runs4 += 1;
        }
        if (alternationRun(midis) >= 4) alt4 += 1;
        const counts = new Map<number, number>();
        for (const midi of midis) counts.set(midi, (counts.get(midi) ?? 0) + 1);
        const ranked = [...counts.values()].sort((left, right) => right - left);
        const top2 =
          ((ranked[0] ?? 0) + (ranked[1] ?? 0)) / Math.max(1, midis.length);
        if (top2 > 0.45) topHeavy += 1;
        for (let index = 2; index < midis.length; index++) {
          intervals += 1;
          if (midis[index] === midis[index - 2]) aba += 1;
        }
        assert.equal(phrase.notes.at(-1)?.beat, barsCount * 4);
        assert.equal(phrase.notes.at(-1)?.duration, 2);
        assert.equal(report.cadenceHit, true);
        assert.equal(report.unisons, 0);
      }
    }
  }
  assert.equal(phrases, 800);
  assert.ok(returned / phrases >= 0.7, `return ${returned}/${phrases}`);
  assert.ok(shifted / returned >= 0.4, `shifted ${shifted}/${returned}`);
  assert.ok(exact / returned <= 0.3, `exact ${exact}/${returned}`);
  assert.equal(identical, 0);
  assert.ok(silent / bars <= 0.05, `no on-beat ${silent}/${bars}`);
  assert.ok(
    strongChord / strong >= 0.64,
    `strong chord ${strongChord}/${strong}`,
  );
  assert.ok(alt4 / phrases <= 0.03, `second return ${alt4}/${phrases}`);
  assert.ok(aba / intervals <= 0.12, `pitch two back ${aba}/${intervals}`);
  assert.ok(topHeavy / phrases <= 0.26, `top two pitches ${topHeavy}/${phrases}`);
  assert.ok(period3 / phrases <= 0.02, `period-3 ${period3}/${phrases}`);
  assert.equal(period9, 0);
  assert.ok(period2 / phrases <= 0.05, `period-2 ${period2}/${phrases}`);
  assert.ok(period4 / phrases <= 0.05, `period-4 ${period4}/${phrases}`);
  assert.ok(runs2 / twoBar <= 0.05, `monotone 2-bar ${runs2}/${twoBar}`);
  assert.ok(runs4 / fourBar <= 0.12, `monotone 4-bar ${runs4}/${fourBar}`);
  assert.equal(wide, 0);
  const ordered = [...times].sort((left, right) => left - right);
  const p95 = ordered[Math.ceil(0.95 * ordered.length) - 1] ?? 0;
  assert.ok(p95 < 20, `p95 ${p95.toFixed(2)} ms`);
});

void test('the critic keeps the higher score and the copied-rhythm penalty', () => {
  const source = readFileSync(new URL('../lib/phrase.ts', import.meta.url), 'utf8');
  assert.match(source, /b\.score - a\.score \|\| a\.lane - b\.lane/);
  assert.match(source, /if \(same\) score -= 80/);
});

void test('a hand shift is refused on an eighth', () => {
  const source = readFileSync(new URL('../lib/phrase.ts', import.meta.url), 'utf8');
  assert.match(
    source,
    /if \(note\.shift\) \{\s*shifts \+= 1;\s*if \(note\.duration <= 0\.5\) return false;/,
  );
});
