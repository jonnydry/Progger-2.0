import { pitchClass, pretty, spell, SCALES, type Note } from './music.ts';

// Guitar catalog spelling mixes sharps and flats: C# and F# sit beside Eb, Ab, and Bb.
export const DRONE_ROOTS = [
  'C',
  'C#',
  'D',
  'Eb',
  'E',
  'F',
  'F#',
  'G',
  'Ab',
  'A',
  'Bb',
  'B',
] as const;

export type DroneRoot = (typeof DRONE_ROOTS)[number];

const MODE_SPECS = [
  {
    id: 'ionian',
    scaleId: 'major',
    name: 'Ionian',
    // Natural 7 is the leading tone Mixolydian flattens. The perfect 4th is shared with the five darker modes, and Lydian already marks the sharp 4.
    colourDegree: '7',
    colourLabel: 'natural 7',
  },
  {
    id: 'dorian',
    scaleId: 'dorian',
    name: 'Dorian',
    colourDegree: '6',
    colourLabel: 'natural 6',
  },
  {
    id: 'phrygian',
    scaleId: 'phrygian',
    name: 'Phrygian',
    colourDegree: 'b2',
    colourLabel: 'flat 2',
  },
  {
    id: 'lydian',
    scaleId: 'lydian',
    name: 'Lydian',
    colourDegree: '#4',
    colourLabel: 'sharp 4',
  },
  {
    id: 'mixolydian',
    scaleId: 'mixolydian',
    name: 'Mixolydian',
    colourDegree: 'b7',
    colourLabel: 'flat 7',
  },
  {
    id: 'aeolian',
    scaleId: 'minor',
    name: 'Aeolian',
    colourDegree: 'b6',
    colourLabel: 'flat 6',
  },
  {
    id: 'locrian',
    scaleId: 'locrian',
    name: 'Locrian',
    colourDegree: 'b5',
    colourLabel: 'flat 5',
  },
] as const;

export type DroneModeId = (typeof MODE_SPECS)[number]['id'];
export type DroneOctave = 'low' | 'layered';
export type DroneRole = 'root' | 'fifth' | 'octave';
export type DroneLayer = 'low' | 'upper';

export type DroneMode = {
  id: DroneModeId;
  name: string;
  formula: readonly string[];
  colourDegree: string;
  colourLabel: string;
};

function requiredScale(id: string) {
  const scale = SCALES.find((item) => item.id === id);
  if (!scale) throw new Error(`Unknown scale: ${id}`);
  return scale;
}

export const DRONE_MODES: readonly DroneMode[] = MODE_SPECS.map((spec) => ({
  id: spec.id,
  name: spec.name,
  formula: requiredScale(spec.scaleId).formula,
  colourDegree: spec.colourDegree,
  colourLabel: spec.colourLabel,
}));

export type DronePitch = {
  midi: number;
  name: string;
  degree: string;
  role: DroneRole;
  layer: DroneLayer;
  label: string;
};

export type WalkNote = {
  note: Note;
  midi: number;
  colour: boolean;
};

export const LOW_DRONE_C2 = 36;

export function droneMode(id: DroneModeId): DroneMode {
  const mode = DRONE_MODES.find((item) => item.id === id);
  if (!mode) throw new Error(`Unknown drone mode: ${id}`);
  return mode;
}

export function lowRootMidi(root: string): number {
  return LOW_DRONE_C2 + pitchClass(root);
}

export function modeIntervals(id: DroneModeId): number[] {
  return spell('C', [...droneMode(id).formula]).map((note) => note.pc);
}

export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function scientificPitch(name: string, midi: number): string {
  const letter = name[0] ?? '';
  const accidentals = name.slice(1);
  const alteration = accidentals.startsWith('#')
    ? accidentals.length
    : accidentals.startsWith('b')
      ? -accidentals.length
      : 0;
  const octave = (midi - pitchClass(letter) - alteration) / 12 - 1;
  return `${pretty(name)}${octave}`;
}

export function dronePitches(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
): DronePitch[] {
  const locrian = modeId === 'locrian';
  const degrees = locrian ? ['1', '8'] : ['1', '5'];
  const intervals = locrian ? [0, 12] : [0, 7];
  const roles: readonly DroneRole[] = locrian
    ? ['root', 'octave']
    : ['root', 'fifth'];
  const spelled = spell(root, degrees);
  const base = lowRootMidi(root);
  const low = intervals.map((interval, index) => {
    const midi = base + interval;
    return {
      midi,
      name: spelled[index].name,
      degree: spelled[index].degree,
      role: roles[index],
      layer: 'low' as const,
      label: scientificPitch(spelled[index].name, midi),
    };
  });
  if (octave === 'low') return low;
  return [
    ...low,
    ...low.map((pitch) => ({
      ...pitch,
      midi: pitch.midi + 12,
      layer: 'upper' as const,
      label: scientificPitch(pitch.name, pitch.midi + 12),
    })),
  ];
}

export function colourNote(root: string, modeId: DroneModeId): Note {
  return spell(root, [droneMode(modeId).colourDegree])[0];
}

export function scaleWalk(root: string, modeId: DroneModeId): WalkNote[] {
  const mode = droneMode(modeId);
  const notes = spell(root, [...mode.formula]);
  const rootPc = pitchClass(root);
  const start = lowRootMidi(root) + 24;
  const ascent = notes.map((note) => ({
    note,
    midi: start + ((note.pc - rootPc + 12) % 12),
    colour: note.degree === mode.colourDegree,
  }));
  const top = { note: notes[0], midi: start + 12, colour: false };
  return [...ascent, top, ...[...ascent].reverse()];
}

export function droneLabel(pitches: readonly DronePitch[]): string {
  const join = (layer: DroneLayer) =>
    pitches
      .filter((pitch) => pitch.layer === layer)
      .map((pitch) => pitch.label)
      .join(' + ');
  const low = join('low');
  const upper = join('upper');
  return upper ? `${low}, with ${upper}` : low;
}
