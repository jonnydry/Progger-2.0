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

export function droneModeForScale(scaleId: string): DroneModeId {
  const known = MODE_SPECS.find((spec) => spec.scaleId === scaleId);
  if (known) return known.id;
  const scale = SCALES.find((item) => item.id === scaleId);
  if (!scale) throw new Error(`Unknown scale: ${scaleId}`);
  // The reed has two voicings. A perfect fifth, or the octave when the scale has none.
  return scale.formula.includes('5') ? 'ionian' : 'locrian';
}

export function reedRequestForScale(
  root: string,
  scaleId: string,
  octave: DroneOctave = 'low',
): {
  root: string;
  modeId: DroneModeId;
  octave: DroneOctave;
  scaleId: string;
} {
  return { root, modeId: droneModeForScale(scaleId), octave, scaleId };
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

/**
 * Root up to the octave and back to the root, once.
 * The octave is the turning note, so it is not played again on the way down.
 */
export function scaleWalk(root: string, id: string): WalkNote[] {
  const mode = MODE_SPECS.find((spec) => spec.id === id || spec.scaleId === id);
  const scale = SCALES.find((item) => item.id === id);
  const formula = scale?.formula ?? (mode ? droneMode(mode.id).formula : null);
  if (!formula) throw new Error(`Unknown scale: ${id}`);
  const colourDegree =
    mode && (!scale || scale.id === mode.scaleId) ? mode.colourDegree : null;
  const notes = spell(root, [...formula]);
  const rootPc = pitchClass(root);
  const start = lowRootMidi(root) + 24;
  const placed = (note: Note, octaveUp = false): WalkNote => ({
    note,
    midi: start + ((note.pc - rootPc + 12) % 12) + (octaveUp ? 12 : 0),
    colour: !octaveUp && colourDegree !== null && note.degree === colourDegree,
  });
  const ascent = notes.map((note) => placed(note));
  const top = placed(notes[0], true);
  const descent = [...notes].reverse().map((note) => placed(note));
  return [...ascent, top, ...descent];
}

export type DroneSoundId = 'reed' | 'bow' | 'cello';

export const DRONE_SOUNDS: readonly {
  id: DroneSoundId;
  label: string;
}[] = [
  { id: 'reed', label: 'Reed' },
  { id: 'bow', label: 'Bow' },
  { id: 'cello', label: 'Cello' },
];

/** Cents that sum to zero, so a detuned stack stays on the written pitch. */
export function symmetricDetuneCents(
  sound: 'bow' | 'reed',
): readonly number[] {
  return sound === 'bow' ? [-6, -2, 2, 6] : [-3.5, 3.5];
}

export const CELLO_SAMPLES = [
  { file: 'cello-d2.m4a', midi: 38, href: '/audio/drone/cello-d2.m4a' },
  { file: 'cello-a2.m4a', midi: 45, href: '/audio/drone/cello-a2.m4a' },
  { file: 'cello-e3.m4a', midi: 52, href: '/audio/drone/cello-e3.m4a' },
  { file: 'cello-b3.m4a', midi: 59, href: '/audio/drone/cello-b3.m4a' },
  { file: 'cello-f4.m4a', midi: 65, href: '/audio/drone/cello-f4.m4a' },
] as const;

/** AAC-LC packet layout of the committed loops, at the file rate. */
const CELLO_AAC_RATE = 44100;
const CELLO_AAC_PRIMING = 1024;
const CELLO_AAC_CONTENT = 94815;
const CELLO_AAC_PACKETS = 96256;

/**
 * Sample range to loop. A decoder that honors the edit list returns the
 * musical 2.15 s. One that leaves the encoder delay and the trailing
 * frame in the buffer is trimmed back to that same range.
 */
export function celloLoopBounds(
  length: number,
  sampleRate: number,
): { start: number; end: number } {
  if (length < 2 || !(sampleRate > 0))
    return { start: 0, end: Math.max(0, length) };
  const scale = sampleRate / CELLO_AAC_RATE;
  const priming = Math.round(CELLO_AAC_PRIMING * scale);
  const content = Math.round(CELLO_AAC_CONTENT * scale);
  const packets = Math.round(CELLO_AAC_PACKETS * scale);
  const choices = [
    { length: packets, start: priming, end: priming + content },
    { length: packets - priming, start: 0, end: content },
    { length: content, start: 0, end: content },
  ];
  let best = choices[2];
  let bestDistance = Math.abs(length - best.length);
  for (const choice of choices) {
    const distance = Math.abs(length - choice.length);
    if (distance < bestDistance) {
      best = choice;
      bestDistance = distance;
    }
  }
  if (bestDistance > 8) return { start: 0, end: length };
  const start = Math.min(best.start, length - 2);
  const end = Math.min(length, Math.max(start + 2, best.end));
  return { start, end };
}

/** Length of the ramp that bends a cello loop onto its slope. */
export const CELLO_SEAM_SECONDS = 0.06;

export function celloSeamFade(sampleRate: number, length: number): number {
  return Math.min(
    Math.round(sampleRate * CELLO_SEAM_SECONDS),
    Math.max(1, length - 1),
  );
}

/**
 * Change in the first difference across the wrap:
 * (x[1] − x[0]) − (x[0] − x[n−1]). Zero when the last sample sits on
 * the line through the first two.
 */
export function celloWrapSlopeChange(samples: ArrayLike<number>): number {
  const last = samples.length - 1;
  if (last < 2) return 0;
  const into = samples[0] - samples[last];
  const onward = samples[1] - samples[0];
  return onward - into;
}

/**
 * Largest absolute second difference within `radius` samples of the wrap.
 * Index 0 is the first sample after the join.
 */
export function celloWrapSecondDifference(
  samples: ArrayLike<number>,
  radius = 8,
): number {
  const length = samples.length;
  if (length < 3) return 0;
  const span = Math.min(Math.max(0, radius), length - 1);
  let max = 0;
  for (let delta = -span; delta <= span; delta += 1) {
    const index = (length + delta) % length;
    const second = Math.abs(
      (samples[(index + 1) % length] ?? 0) -
        2 * (samples[index] ?? 0) +
        (samples[(index - 1 + length) % length] ?? 0),
    );
    if (second > max) max = second;
  }
  return max;
}

/**
 * Largest absolute second difference outside the tail of the join.
 * The wrap window is held to this, so a seam kink has to exceed the loop itself.
 */
export function celloBodySecondDifference(
  samples: ArrayLike<number>,
  radius = 8,
): number {
  const length = samples.length;
  if (length < radius + 3) return 0;
  let max = 0;
  for (let index = 1; index < length - radius; index += 1) {
    const second = Math.abs(
      (samples[index + 1] ?? 0) -
        2 * (samples[index] ?? 0) +
        (samples[index - 1] ?? 0),
    );
    if (second > max) max = second;
  }
  return max;
}

/** Largest absolute second difference in a linear window around `center`. */
export function windowSecondDifference(
  samples: ArrayLike<number>,
  center: number,
  radius = 8,
): number {
  let max = 0;
  const start = Math.max(1, Math.ceil(center) - radius);
  const end = Math.min(samples.length - 2, Math.floor(center) + radius);
  for (let index = start; index <= end; index += 1) {
    const second = Math.abs(
      (samples[index + 1] ?? 0) -
        2 * (samples[index] ?? 0) +
        (samples[index - 1] ?? 0),
    );
    if (second > max) max = second;
  }
  return max;
}

/**
 * Bend the end of a loop onto the line through x[0] and x[1]. A quarter-sine
 * offset lands the last sample on that line and leaves the kink on the
 * sample before it. Following the line across the whole fade walks off the
 * waveform, because the opening slope is steep. The curvature check looks
 * ±8 samples past the join, so those samples sit on the line, and the next
 * 20 smoothstep back to the recording.
 */
export function closeCelloSeam(
  samples: Float32Array,
  fadeSamples: number,
): Float32Array {
  const out = samples.slice();
  if (out.length < 2) return out;
  const fade = Math.min(Math.max(1, fadeSamples), out.length - 1);
  const slope = (out[1] ?? 0) - (out[0] ?? 0);
  const hold = Math.min(8, fade);
  const span = Math.min(20, fade - hold);
  const last = out.length - 1;
  for (let steps = 1; steps <= hold + span; steps += 1) {
    const at = last - steps + 1;
    const line = (out[0] ?? 0) - steps * slope;
    let weight = 1;
    if (steps > hold && span > 0) {
      const progress = (hold + span - steps) / span;
      weight = progress * progress * (3 - 2 * progress);
    }
    const sample = out[at] ?? 0;
    out[at] = sample * (1 - weight) + line * weight;
  }
  return out;
}

export function sampleForMidi(midi: number): {
  file: string;
  href: string;
  sourceMidi: number;
  semitones: number;
  playbackRate: number;
} {
  let best: (typeof CELLO_SAMPLES)[number] = CELLO_SAMPLES[0];
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
