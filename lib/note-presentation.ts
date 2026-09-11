import { pretty, type Note } from './music.ts';

type NamedPitch = Pick<Note, 'name' | 'pc'> & Partial<Pick<Note, 'degree'>>;

const sharpNames = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];
const flatNames = [
  'C',
  'Db',
  'D',
  'Eb',
  'E',
  'F',
  'Gb',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
];

/** A fretboard label, never an input to spelling or harmony calculations. */
export function readableNoteName(note: NamedPitch): string {
  if (!/[b#]{2}/.test(note.name)) return note.name;
  return (note.name.includes('b') ? flatNames : sharpNames)[note.pc];
}

export function noteDescription(note: NamedPitch): string {
  const name = readableNoteName(note);
  return name === note.name
    ? pretty(name)
    : `${pretty(name)} (written ${pretty(note.name)})`;
}
