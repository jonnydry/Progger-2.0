/** Fretboard marks for one phrase. Kept separate so the neck can render them without loading the generator. */
export type PhraseFretMark = {
  string: number;
  fret: number;
  finger: number;
  shift: boolean;
  label: string;
  degree: string;
  current: boolean;
};
