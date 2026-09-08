export type Note = { name: string; pc: number; degree: string };
export type Scale = { id: string; name: string; family: string; formula: string[]; description: string; color: string; harmonize?: boolean };
export const ROOTS = ['C', 'C#', 'Db', 'D', 'D#', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'G#', 'Ab', 'A', 'A#', 'Bb', 'B'];
export const mod = (n: number) => ((n % 12) + 12) % 12;
const letters = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const naturals = [0, 2, 4, 5, 7, 9, 11];
export const pretty = (value: string) => value.replace(/#/g, '♯').replace(/b/g, '♭');
export function pitchClass(name: string): number {
  const parsed = /^([A-G])((?:#+|b+)?)$/.exec(name.replace(/♯/g, '#').replace(/♭/g, 'b'));
  if (!parsed) throw new Error(`Unknown note: ${name}`);
  // Internally generated interval spellings can exceed double accidentals.
  // Decode them without respelling; chord-input syntax remains bounded separately.
  const alteration = parsed[2].length * (parsed[2].startsWith('#') ? 1 : -1);
  return mod(naturals[letters.indexOf(parsed[1])] + alteration);
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
  { id: 'harmonic-minor', name: 'Harmonic minor', family: 'Harmonic minor modes', formula: ['1','2','b3','4','5','b6','7'], description: 'Natural minor with a raised 7th: a strong pull home and a distinctive wide step.', color: 'The natural 7th leads up to the root. The gap from flat 6 to 7 spans three frets.' },
  { id: 'locrian-natural6', name: 'Locrian ♮6', family: 'Harmonic minor modes', formula: ['1','b2','b3','4','b5','6','b7'], description: 'Locrian with a natural 6th, the second mode of harmonic minor.', color: 'The diminished fifth stays; the natural 6th adds a different color around half-diminished harmony.' },
  { id: 'ionian-augmented', name: 'Ionian ♯5', family: 'Harmonic minor modes', formula: ['1','2','3','4','#5','6','7'], description: 'A major scale with an augmented fifth, the third mode of harmonic minor.', color: 'The sharp 5th changes the tonic triad from major to augmented.' },
  { id: 'dorian-sharp4', name: 'Dorian ♯4', family: 'Harmonic minor modes', formula: ['1','2','b3','#4','5','6','b7'], description: 'Dorian with a raised 4th, the fourth mode of harmonic minor.', color: 'Compare the sharp 4th against the perfect 5th while keeping the minor 3rd in view.' },
  { id: 'phrygian-dominant', name: 'Phrygian dominant', family: 'Harmonic minor modes', formula: ['1','b2','3','4','5','b6','b7'], description: 'A dominant sound with a flat 2nd and flat 6th, the fifth mode of harmonic minor.', color: 'The major 3rd and flat 7th support dominant harmony; the flat 2nd supplies the flat 9 tension.' },
  { id: 'lydian-sharp2', name: 'Lydian ♯2', family: 'Harmonic minor modes', formula: ['1','#2','3','#4','5','6','7'], description: 'Lydian with a raised 2nd, the sixth mode of harmonic minor.', color: 'The sharp 2nd sits a semitone below the major 3rd, alongside Lydian’s raised 4th.' },
  { id: 'ultralocrian', name: 'Ultralocrian', family: 'Harmonic minor modes', formula: ['1','b2','b3','b4','b5','b6','bb7'], description: 'The seventh mode of harmonic minor, also called super Locrian double-flat 7.', color: 'The double-flat 7th completes a diminished seventh chord. It sounds like a major 6th but keeps its chord spelling.' },
  { id: 'melodic-minor', name: 'Jazz melodic minor', family: 'Melodic minor modes', formula: ['1','2','b3','4','5','6','7'], description: 'A minor 3rd inside a major-like upper half. This jazz form stays the same in both directions.', color: 'Compare the natural 6th and 7th with natural minor. Only the 3rd differs from major.' },
  { id: 'dorian-b2', name: 'Dorian ♭2', family: 'Melodic minor modes', formula: ['1','b2','b3','4','5','6','b7'], description: 'Dorian with a lowered 2nd, the second mode of jazz melodic minor.', color: 'The flat 2nd adds a close tension above the root while the natural 6th keeps the Dorian color.' },
  { id: 'lydian-augmented', name: 'Lydian augmented', family: 'Melodic minor modes', formula: ['1','2','3','#4','#5','6','7'], description: 'A Lydian sound with an augmented fifth, the third mode of jazz melodic minor.', color: 'The sharp 4th and sharp 5th frame the augmented tonic triad.' },
  { id: 'lydian-dominant', name: 'Lydian dominant', family: 'Melodic minor modes', formula: ['1','2','3','#4','5','6','b7'], description: 'Dominant harmony with a raised 4th, the fourth mode of jazz melodic minor.', color: 'The sharp 4th supplies the sharp 11 tension while the natural 5th and flat 7th remain.' },
  { id: 'mixolydian-b6', name: 'Mixolydian ♭6', family: 'Melodic minor modes', formula: ['1','2','3','4','5','b6','b7'], description: 'Mixolydian with a lowered 6th, the fifth mode of jazz melodic minor.', color: 'The flat 6th supplies a flat 13 color while keeping the natural 9th and perfect 5th.' },
  { id: 'locrian-natural2', name: 'Locrian ♮2', family: 'Melodic minor modes', formula: ['1','2','b3','4','b5','b6','b7'], description: 'Locrian with a natural 2nd, the sixth mode of jazz melodic minor.', color: 'The natural 2nd gives a ninth above a half-diminished chord without changing its diminished fifth.' },
  { id: 'altered', name: 'Altered', family: 'Melodic minor modes', formula: ['1','b9','#9','3','#11','b13','b7'], harmonize: false, description: 'Altered dominant tensions, from the seventh mode of jazz melodic minor.', color: 'Degrees use dominant-chord spelling: flat 9, sharp 9, sharp 11 and flat 13. There is no perfect 5th, so this is not exact coverage of a chord that includes one.' },
  { id: 'whole-tone', name: 'Whole tone', family: 'Symmetric scales', formula: ['1','2','3','#4','#5','b7'], description: 'Six notes spaced entirely in whole steps.', color: 'The augmented fifth fits augmented harmony. There is no perfect 5th; compare the sound against the actual chord tones.' },
  { id: 'half-whole-diminished', name: 'Half–whole diminished', family: 'Symmetric scales', formula: ['1','b9','#9','3','#11','5','13','b7'], description: 'Eight notes alternating half steps and whole steps, beginning with a half step.', color: 'Dominant-chord spelling shows both altered ninths, the sharp 11, and natural 13 alongside the major 3rd, perfect 5th and flat 7th.' },
  { id: 'whole-half-diminished', name: 'Whole–half diminished', family: 'Symmetric scales', formula: ['1','2','b3','4','b5','b6','6','7'], description: 'Eight notes alternating whole steps and half steps, beginning with a whole step.', color: 'A diminished-seventh palette. The note labelled 6 sounds like the double-flat 7 of the chord; scale and chord spellings serve different roles.' },
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
