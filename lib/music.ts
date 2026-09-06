export type Note = { name: string; pc: number; degree: string };
export type Scale = { id: string; name: string; family: string; formula: string[]; description: string; color: string };
export const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
export const mod = (n: number) => ((n % 12) + 12) % 12;
const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const naturals = [0, 2, 4, 5, 7, 9, 11];
export const pretty = (value: string) => value.replace(/#/g, '♯').replace(/b/g, '♭');
export function pitchClass(name: string): number {
  const parsed = /^([A-G])((?:#{1,2}|b{1,2})?)$/.exec(name.replace(/♯/g, '#').replace(/♭/g, 'b'));
  if (!parsed) throw new Error(`Unknown note: ${name}`);
  return mod(naturals[letters.indexOf(parsed[1])] + parsed[2].split('').reduce((sum, char) => sum + (char === '#' ? 1 : -1), 0));
}
export function spell(root: string, formula: string[]): Note[] {
  const rootPc = pitchClass(root), rootLetter = letters.indexOf(root[0]);
  return formula.map(degree => {
    const match = /^([b#]*)(\d+)$/.exec(degree);
    if (!match || Number(match[2]) < 1 || Number(match[2]) > 13) throw new Error(`Unknown interval: ${degree}`);
    const index = (Number(match[2]) - 1) % 7;
    const alteration = match[1].split('').reduce((sum, char) => sum + (char === '#' ? 1 : -1), 0);
    const pc = mod(rootPc + naturals[index] + alteration), letterIndex = (rootLetter + index) % 7;
    const difference = mod(pc - naturals[letterIndex] + 6) - 6;
    return { name: letters[letterIndex] + (difference < 0 ? 'b'.repeat(-difference) : '#'.repeat(difference)), pc, degree };
  });
}
export const SCALES: Scale[] = [
  { id: 'major', name: 'Major', family: 'Major modes', formula: ['1','2','3','4','5','6','7'], description: 'The familiar major sound. A clear starting point for finding your way around the neck.', color: 'The major 3rd gives this scale its bright foundation.' },
  { id: 'dorian', name: 'Dorian', family: 'Major modes', formula: ['1','2','b3','4','5','6','b7'], description: 'Minor, with a brighter turn. A favorite for spacious grooves and open-ended improvisation.', color: 'The natural 6th is the note that separates Dorian from natural minor.' },
  { id: 'phrygian', name: 'Phrygian', family: 'Major modes', formula: ['1','b2','b3','4','5','b6','b7'], description: 'A close, dark tension between the root and flat 2nd, set against a minor foundation.', color: 'The flat 2nd sits just one fret above the root.' },
  { id: 'lydian', name: 'Lydian', family: 'Major modes', formula: ['1','2','3','#4','5','6','7'], description: 'A major sound with a floating edge. The raised 4th opens up a little extra space.', color: 'The sharp 4th is the characteristic color. Compare it with the 4th in major.' },
  { id: 'mixolydian', name: 'Mixolydian', family: 'Major modes', formula: ['1','2','3','4','5','6','b7'], description: 'Major warmth with a loose, bluesy edge. A useful sound around dominant seventh chords.', color: 'The flat 7th softens the pull back to the root.' },
  { id: 'minor', name: 'Natural minor', family: 'Major modes', formula: ['1','2','b3','4','5','b6','b7'], description: 'The familiar minor palette, also called Aeolian. Spacious, expressive, and full of possibility.', color: 'The flat 3rd, 6th, and 7th distinguish natural minor from major.' },
  { id: 'locrian', name: 'Locrian', family: 'Major modes', formula: ['1','b2','b3','4','b5','b6','b7'], description: 'An unsettled minor sound with a diminished fifth. Explore it around half-diminished chords.', color: 'The flat 5th makes its tonic triad diminished.' },
];
SCALES.push(
  { id: 'major-pentatonic', name: 'Major pentatonic', family: 'Pentatonic & blues', formula: ['1','2','3','5','6'], description: 'Five notes, plenty of room. A compact major palette with space between its steps.', color: 'The major 3rd and 6th carry the warmth. There is no 4th or 7th.' },
  { id: 'minor-pentatonic', name: 'Minor pentatonic', family: 'Pentatonic & blues', formula: ['1','b3','4','5','b7'], description: 'A five-note foundation for riffs, bends, and melodic phrasing.', color: 'The flat 3rd gives the minor character. Try connecting it back to the root.' },
  { id: 'major-blues', name: 'Major blues', family: 'Pentatonic & blues', formula: ['1','2','b3','3','5','6'], description: 'Major pentatonic with a passing flat 3rd for a blues inflection.', color: 'Move from the flat 3rd to the major 3rd to explore the blues color.' },
  { id: 'minor-blues', name: 'Minor blues', family: 'Pentatonic & blues', formula: ['1','b3','4','b5','5','b7'], description: 'Minor pentatonic with a chromatic passing note between the 4th and 5th.', color: 'Treat the flat 5th as a color to move through, and compare it with the stable 5th.' },
  { id: 'harmonic-minor', name: 'Harmonic minor', family: 'Minor families', formula: ['1','2','b3','4','5','b6','7'], description: 'Natural minor with a raised 7th: a strong pull home and a distinctive wide step.', color: 'The natural 7th leads up to the root. The gap from flat 6 to 7 spans three frets.' },
  { id: 'melodic-minor', name: 'Jazz melodic minor', family: 'Minor families', formula: ['1','2','b3','4','5','6','7'], description: 'A minor 3rd inside a major-like upper half. This jazz form stays the same in both directions.', color: 'Compare the natural 6th and 7th with natural minor. Only the 3rd differs from major.' },
);
export const TUNING = [40, 45, 50, 55, 59, 64];
export type Position = { string: number; fret: number; midi: number };
export type Pattern = { start: number; min: number; max: number; positions: Position[] };
export function patterns(notes: Note[]): Pattern[] {
  const nps = notes.length === 7 ? 3 : notes.length === 5 ? 2 : 0;
  if (!nps) return [];
  const pitches = new Set(notes.map(note => note.pc)), results: Pattern[] = [];
  for (let start = 0; start <= 24; start++) {
    if (!pitches.has(mod(40 + start))) continue;
    let nextMidi = 40 + start, valid = true;
    const positions: Position[] = [];
    for (let string = 0; string < 6; string++) {
      for (let count = 0; count < nps; count++) {
        while (!pitches.has(mod(nextMidi))) nextMidi++;
        const fret = nextMidi - TUNING[string];
        if (fret < 0 || fret > 24) valid = false;
        positions.push({ string, fret, midi: nextMidi }); nextMidi++;
      }
    }
    const frets = positions.map(position => position.fret), min = Math.min(...frets), max = Math.max(...frets);
    if (max - min > 6) valid = false;
    for (let string = 0; string < 6; string++) {
      const group = positions.filter(position => position.string === string);
      if (group.at(-1)!.fret - group[0].fret > 5) valid = false;
    }
    if (valid) results.push({ start, min, max, positions });
  }
  return results;
}
