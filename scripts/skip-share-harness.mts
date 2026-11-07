// Frozen skip-share measurement. One command, same 800 phrases as slice 1.
// Skip share = string-distance-2 transitions / all transitions in returned phrases.
// Attempted = atoms that passed blockAllowed. Survived = those that stayed in a
// candidate line. Dropped = the rest, split by the reason the line was rejected.
// Sounding = atoms in the phrase that was actually returned.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const outPath = process.argv[3];
const ph = await import(pathToFileURL(dir + '/lib/phrase.ts').href);
const mu = await import(pathToFileURL(dir + '/lib/music.ts').href);
const ha = await import(pathToFileURL(dir + '/lib/harmony.ts').href);

const CTX = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F', 'major', 'Fmaj7'],
  ['E', 'minor', 'Em'],
  ['D', 'dorian', 'Dm7'],
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'minor-pentatonic', 'Am7'],
] as const;

ph.resetGroupingAtomReport();
ph.resetSkipAtomReport();

let phrases = 0;
let errors = 0;
let notes = 0;
let transitions = 0;
let skipTransitions = 0;
let sameTransitions = 0;
let adjacentTransitions = 0;
let wideTransitions = 0;
let shiftCost = 0;
let shifts = 0;
let fastLeaps = 0;
let fastPinned = 0;
let fastUnpinned = 0;
let maxBarArrivals = 0;
const ms: number[] = [];

for (const bars of [2, 4] as const) {
  for (let ci = 0; ci < CTX.length; ci++) {
    const [root, scaleId, chord] = CTX[ci];
    const scale = mu.SCALES.find((item: { id: string }) => item.id === scaleId);
    const scaleNotes = mu.spell(root, scale.formula);
    const chordNotes = ha.parseChord(chord).notes;
    for (let k = 0; k < 50; k++) {
      const seed = 1000 + ci * 50 + k;
      const started = performance.now();
      const result = ph.generatePhrase({
        seed,
        bars,
        scaleNotes,
        chordNotes,
      });
      ms.push(performance.now() - started);
      if (!result.ok) {
        errors += 1;
        continue;
      }
      phrases += 1;
      const played = result.phrase.notes;
      notes += played.length;
      const perBar = new Map<number, number>();
      for (let index = 1; index < played.length; index++) {
        transitions += 1;
        const distance = Math.abs(played[index].string - played[index - 1].string);
        if (distance === 0) sameTransitions += 1;
        else if (distance === 1) adjacentTransitions += 1;
        else if (distance === 2) skipTransitions += 1;
        else wideTransitions += 1;
        const moved = Math.abs(played[index].position - played[index - 1].position);
        shiftCost += ph.handShiftCost(moved, played[index].duration <= 0.5);
        if (played[index].shift) shifts += 1;
        const gap = Math.abs(played[index].midi - played[index - 1].midi);
        if (played[index].duration <= 0.5 && gap > 5) {
          fastLeaps += 1;
          const pinned = distance === 2 && moved < 4;
          if (pinned) fastPinned += 1;
          else fastUnpinned += 1;
          const bar = Math.floor(played[index].beat / 4);
          const count = (perBar.get(bar) ?? 0) + 1;
          perBar.set(bar, count);
          if (count > maxBarArrivals) maxBarArrivals = count;
        }
      }
    }
  }
}

ms.sort((left, right) => left - right);
const at = (q: number) => ms[Math.min(ms.length - 1, Math.max(0, Math.ceil(q * ms.length) - 1))];
const skips = ph.skipAtomReport();
const groups = ph.groupingAtomReport();
const report = {
  phrases,
  errors,
  notes,
  transitions,
  skipTransitions,
  sameTransitions,
  adjacentTransitions,
  wideTransitions,
  skipShare: transitions ? skipTransitions / transitions : 0,
  shiftCostPerTransition: transitions ? shiftCost / transitions : 0,
  shiftsPerPhrase: phrases ? shifts / phrases : 0,
  fastLeaps,
  fastPinned,
  fastUnpinned,
  maxBarArrivals,
  p50ms: at(0.5),
  p95ms: at(0.95),
  minMs: ms[0] ?? 0,
  maxMs: ms.at(-1) ?? 0,
  work: {
    phrasesAttempted: CTX.length * 50 * 2,
    phrasesOk: phrases,
    transitions,
    atomsAttempted: skips.attempted,
  },
  skips,
  groups,
};
const text = JSON.stringify(report, null, 2);
console.log(text);
if (outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
}
