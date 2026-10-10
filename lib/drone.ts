import { pitchClass, pretty, spell, type Note } from './music.ts';

/** Twelve concert pitch classes, spelled the way a guitarist usually writes them. */
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
export type DroneModeId =
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian';
export type DroneOctave = 'low' | 'layered';
export type DroneSoundId = 'bow' | 'cello' | 'reed';
export type DroneRole = 'root' | 'fifth' | 'octave';
export type DroneLayer = 'low' | 'upper';

export type DroneMode = {
  id: DroneModeId;
  name: string;
  formula: readonly string[];
  /** Null for Ionian, the reference mode. */
  colourDegree: string | null;
  colourLabel: string | null;
};

export const DRONE_MODES: readonly DroneMode[] = [
  {
    id: 'ionian',
    name: 'Ionian',
    formula: ['1', '2', '3', '4', '5', '6', '7'],
    colourDegree: null,
    colourLabel: null,
  },
  {
    id: 'dorian',
    name: 'Dorian',
    formula: ['1', '2', 'b3', '4', '5', '6', 'b7'],
    colourDegree: '6',
    colourLabel: 'natural 6',
  },
  {
    id: 'phrygian',
    name: 'Phrygian',
    formula: ['1', 'b2', 'b3', '4', '5', 'b6', 'b7'],
    colourDegree: 'b2',
    colourLabel: 'flat 2',
  },
  {
    id: 'lydian',
    name: 'Lydian',
    formula: ['1', '2', '3', '#4', '5', '6', '7'],
    colourDegree: '#4',
    colourLabel: 'sharp 4',
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    formula: ['1', '2', '3', '4', '5', '6', 'b7'],
    colourDegree: 'b7',
    colourLabel: 'flat 7',
  },
  {
    id: 'aeolian',
    name: 'Aeolian',
    formula: ['1', '2', 'b3', '4', '5', 'b6', 'b7'],
    colourDegree: 'b6',
    colourLabel: 'flat 6',
  },
  {
    id: 'locrian',
    name: 'Locrian',
    formula: ['1', 'b2', 'b3', '4', 'b5', 'b6', 'b7'],
    colourDegree: 'b5',
    colourLabel: 'flat 5',
  },
];

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

/** C2. Octave 2 surrounds the guitar's low E2 (MIDI 40) and A2 (MIDI 45). */
export const LOW_DRONE_C2 = 36;

/**
 * Cents offsets that sum to zero, so a detuned stack stays centered on the
 * written pitch. Bow voices are wider; the reed is a closer pair.
 */
export function symmetricDetuneCents(sound: 'bow' | 'reed'): readonly number[] {
  return sound === 'bow' ? [-6, -2, 2, 6] : [-3.5, 3.5];
}

export function droneMode(id: DroneModeId): DroneMode {
  const mode = DRONE_MODES.find((item) => item.id === id);
  if (!mode) throw new Error(`Unknown drone mode: ${id}`);
  return mode;
}

export function lowRootMidi(root: string): number {
  return LOW_DRONE_C2 + pitchClass(root);
}

export function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function scientificPitch(name: string, midi: number): string {
  return `${pretty(name)}${Math.floor(midi / 12) - 1}`;
}

/** Root plus a perfect fifth, or root plus an octave when the fifth is diminished. */
export function dronePitches(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
): DronePitch[] {
  const upperDegree = modeId === 'locrian' ? '8' : '5';
  const spelled = spell(root, ['1', upperDegree]);
  const base = lowRootMidi(root);
  const intervals = modeId === 'locrian' ? [0, 12] : [0, 7];
  const roles: readonly DroneRole[] =
    modeId === 'locrian' ? ['root', 'octave'] : ['root', 'fifth'];
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

export function colourNote(root: string, modeId: DroneModeId): Note | null {
  const mode = droneMode(modeId);
  if (!mode.colourDegree) return null;
  return spell(root, [mode.colourDegree])[0];
}

/** One octave up and back, two octaves above the low drone so a phone can hear it. */
export function scaleWalk(root: string, modeId: DroneModeId): WalkNote[] {
  const mode = droneMode(modeId);
  const notes = spell(root, [...mode.formula]);
  const rootPc = pitchClass(root);
  const start = lowRootMidi(root) + 24;
  const ascent = notes.map((note) => ({
    note,
    midi: start + ((note.pc - rootPc + 12) % 12),
    colour: mode.colourDegree !== null && note.degree === mode.colourDegree,
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

/** How loud a drone pitch is relative to the low root. */
export function pitchWeight(role: DroneRole, layer: DroneLayer): number {
  return (role === 'root' ? 1 : 0.7) * (layer === 'upper' ? 0.58 : 1);
}

export const CELLO_SAMPLES = [
  { file: 'cello-d2.m4a', midi: 38, href: '/audio/drone/cello-d2.m4a' },
  { file: 'cello-a2.m4a', midi: 45, href: '/audio/drone/cello-a2.m4a' },
  { file: 'cello-e3.m4a', midi: 52, href: '/audio/drone/cello-e3.m4a' },
  { file: 'cello-b3.m4a', midi: 59, href: '/audio/drone/cello-b3.m4a' },
  { file: 'cello-f4.m4a', midi: 65, href: '/audio/drone/cello-f4.m4a' },
] as const;

export type CelloSample = (typeof CELLO_SAMPLES)[number];

export function sampleForMidi(midi: number): {
  file: string;
  href: string;
  sourceMidi: number;
  semitones: number;
  playbackRate: number;
} {
  let best: CelloSample = CELLO_SAMPLES[0];
  let bestDistance = Infinity;
  for (const sample of CELLO_SAMPLES) {
    const distance = Math.abs(midi - sample.midi);
    if (distance < bestDistance) {
      best = sample;
      bestDistance = distance;
    }
  }
  const semitones = midi - best.midi;
  return {
    file: best.file,
    href: best.href,
    sourceMidi: best.midi,
    semitones,
    playbackRate: 2 ** (semitones / 12),
  };
}

/** Drop decoder padding without eating zero crossings in the middle of the note. */
export function trimEdgeSilence(
  samples: Float32Array,
  relative = 0.004,
): Float32Array {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const threshold = peak * relative;
  let start = 0;
  let end = samples.length;
  while (start < end && Math.abs(samples[start]) < threshold) start += 1;
  while (end > start && Math.abs(samples[end - 1]) < threshold) end -= 1;
  if (end <= start) return samples.slice();
  return samples.slice(start, end);
}

/**
 * Equal-power crossfade so the end of the buffer continues into the start.
 * The loop junction is two consecutive source samples, not a spliced click.
 */
export function seamlessLoop(
  samples: Float32Array,
  fadeSamples: number,
): Float32Array {
  if (
    !Number.isInteger(fadeSamples) ||
    fadeSamples < 1 ||
    samples.length <= fadeSamples * 2
  ) {
    throw new Error('A loop fade must be shorter than half the buffer.');
  }
  const outLength = samples.length - fadeSamples;
  const out = samples.slice(0, outLength);
  for (let i = 0; i < fadeSamples; i += 1) {
    const t = i / fadeSamples;
    const head = Math.sin((t * Math.PI) / 2);
    const tail = Math.cos((t * Math.PI) / 2);
    out[i] = samples[i] * head + samples[outLength + i] * tail;
  }
  return out;
}
