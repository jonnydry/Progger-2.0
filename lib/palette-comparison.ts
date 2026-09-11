import { pitchClass, type Note } from './music.ts';
import type { Chord } from './harmony.ts';

type Palette = { notes: readonly Note[] };
type NamedPitch = Pick<Note, 'name' | 'pc'>;

/** Compare pitch coverage only. These groups do not rank consonance or infer a key. */
export function comparePalette(
  palette: Palette,
  chords: readonly Chord[],
  baseline?: Palette,
) {
  const entered = new Map<number, NamedPitch>();
  for (const chord of chords) {
    for (const note of chord.notes) {
      if (!entered.has(note.pc)) entered.set(note.pc, note);
    }
    if (chord.bass) {
      const pc = pitchClass(chord.bass);
      if (!entered.has(pc)) entered.set(pc, { name: chord.bass, pc });
    }
  }
  const notes = [
    ...new Map(palette.notes.map((note) => [note.pc, note])).values(),
  ];
  const pitches = new Set(notes.map((note) => note.pc));
  const baselineNotes = baseline
    ? [...new Map(baseline.notes.map((note) => [note.pc, note])).values()]
    : undefined;
  const baselinePitches = new Set(baselineNotes?.map((note) => note.pc));

  return {
    hasChords: chords.length > 0,
    chordTones: notes.filter((note) => entered.has(note.pc)),
    // Without entered chords there is no harmonic context for this distinction.
    melodicNotes: chords.length
      ? notes.filter((note) => !entered.has(note.pc))
      : [],
    missingChordTones: [...entered.values()].filter(
      (note) => !pitches.has(note.pc),
    ),
    difference: baselineNotes
      ? {
          added: notes.filter((note) => !baselinePitches.has(note.pc)),
          removed: baselineNotes.filter((note) => !pitches.has(note.pc)),
        }
      : undefined,
  };
}
