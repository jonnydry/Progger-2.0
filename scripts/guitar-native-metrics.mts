// Frozen measurement for the guitar-native skip prototype.
// Recomputes string class, hand-shift cost, and shift flags from returned notes.
import { writeFileSync } from 'node:fs';
import {
  drainSkipWitnesses,
  generatePhrase,
  resetSkipAtomReport,
  skipAtomReport,
} from '../lib/phrase.ts';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, patterns, spell } from '../lib/music.ts';

const bases = (process.argv[2] ?? '1000,5000,9000')
  .split(',')
  .map((item) => Number(item));
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

function costOf(frets: number, fast: boolean): number {
  const moved = Math.abs(frets);
  if (moved === 0) return 0;
  return 20 + moved + (fast ? 200 : 0);
}

const rows = [];
for (const base of bases) {
  resetSkipAtomReport();
  let phrases = 0;
  let errors = 0;
  let transitions = 0;
  let same = 0;
  let adjacent = 0;
  let skip = 0;
  let wide = 0;
  let shiftCost = 0;
  let shifts = 0;
  let exception = 0;
  let smallSkip = 0;
  let unpinned = 0;
  let maxBar = 0;
  const gaps: Record<string, number> = {};
  const violations: string[] = [];
  const byContext: Record<string, { skip: number; transitions: number; exception: number }> = {};
  for (const bars of [2, 4] as const) {
    for (let ci = 0; ci < CTX.length; ci++) {
      const [root, scaleId, chord] = CTX[ci];
      const label = `${root} ${scaleId} ${chord}`;
      const scale = SCALES.find((item) => item.id === scaleId);
      if (!scale) throw new Error(scaleId);
      const scaleNotes = spell(root, scale.formula);
      const chordNotes = parseChord(chord).notes;
      const forms = patterns(scaleNotes);
      byContext[label] ??= { skip: 0, transitions: 0, exception: 0 };
      for (let k = 0; k < 50; k++) {
        const seed = base + ci * 50 + k;
        const result = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        const seen = drainSkipWitnesses();
        if (!result.ok) {
          errors += 1;
          continue;
        }
        phrases += 1;
        const notes = result.phrase.notes;
        const perBar = new Map<number, number>();
        const claimed = new Set(seen.witnesses.map((item) => `${item.bar}:${item.gap}:${item.fromString}:${item.toString}`));
        for (const violation of seen.violations) {
          if (violations.length < 8) violations.push(`${seed}/${bars} ${violation}`);
        }
        for (let index = 1; index < notes.length; index++) {
          const before = notes[index - 1];
          const note = notes[index];
          if (!before || !note) continue;
          transitions += 1;
          const distance = Math.abs(note.string - before.string);
          if (distance === 0) same += 1;
          else if (distance === 1) adjacent += 1;
          else if (distance === 2) {
            skip += 1;
            byContext[label].skip += 1;
          } else wide += 1;
          byContext[label].transitions += 1;
          const moved = Math.abs(note.position - before.position);
          const fast = note.duration <= 0.5;
          shiftCost += costOf(moved, fast);
          if (moved >= 4) shifts += 1;
          const gap = Math.abs(note.midi - before.midi);
          if (distance === 2 && gap >= 1 && gap <= 5) smallSkip += 1;
            if (fast && gap >= 6) {
            exception += 1;
            byContext[label].exception += 1;
            gaps[String(gap)] = (gaps[String(gap)] ?? 0) + 1;
            const bar = Math.floor(note.beat / 4);
            const count = (perBar.get(bar) ?? 0) + 1;
            perBar.set(bar, count);
            if (count > maxBar) maxBar = count;
            const pinned =
              distance === 2 &&
              moved === 0 &&
              gap <= 12 &&
              forms.some((form) =>
                form.positions.some(
                  (spot) => spot.string === before.string && spot.fret === before.fret,
                ),
              );
            if (!pinned || count > 4) {
              unpinned += 1;
              if (violations.length < 8) {
                violations.push(
                  `${seed}/${bars} i=${index} gap=${gap} dist=${distance} moved=${moved} barCount=${count}`,
                );
              }
            }
            const key = `${bar}:${gap}:${before.string}:${note.string}`;
            if (!claimed.has(key) && violations.length < 8) {
              violations.push(`${seed}/${bars} exception without witness ${key}`);
            }
          }
        }
      }
    }
  }
  // Second pass is avoided. byContext is filled below from the same loop if we accumulate there.
  const atoms = skipAtomReport();
  rows.push({
    base,
    phrases,
    errors,
    transitions,
    same,
    adjacent,
    skip,
    wide,
    skipShare: transitions ? skip / transitions : 0,
    smallSkip,
    exception,
    shiftCostPerTransition: transitions ? shiftCost / transitions : 0,
    shifts,
    unpinned,
    maxBar,
    gaps,
    violations,
    byContext,
    atoms,
  });
  console.log(
    [
      base,
      `share ${((rows.at(-1)?.skipShare ?? 0) * 100).toFixed(2)}`,
      `skip ${skip}/${transitions}`,
      `exception ${exception}`,
      `small ${smallSkip}`,
      `cost ${(rows.at(-1)?.shiftCostPerTransition ?? 0).toFixed(4)}`,
      `shifts ${shifts}`,
      `unpinned ${unpinned}`,
      `maxBar ${maxBar}`,
      `err ${errors}`,
      `kept ${atoms.kept}`,
      `drop ${atoms.dropped}`,
      `inside ${atoms.playedInsideSkips}/${atoms.playedInside}`,
    ].join(' '),
  );
}

const out = process.argv[3];
if (out) writeFileSync(out, JSON.stringify({ bases, rows }, null, 2));
