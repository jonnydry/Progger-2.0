import {
  DRONE_LIMITER,
  DRONE_MAX_LINEAR_GAIN,
  REED_TIMING,
  ROOM_SECONDS,
  TAIL_MARGIN,
  prepareCelloBuffer,
  soundLinearCap,
  startLiveVoice,
  startWalkPluck,
} from '../lib/drone-audio.ts';
import {
  DRONE_MODES,
  DRONE_ROOTS,
  type DroneModeId,
  type DroneOctave,
  type DroneSoundId,
  dronePitches,
  scaleWalk,
} from '../lib/drone.ts';
import { QUALITIES, voicings } from '../lib/harmony.ts';
import { SCALES, TUNING } from '../lib/music.ts';
import { scheduleVoicing, voicingMidi } from '../lib/voicing-audio.ts';

const RATE = 48000;
const DRONE_AT = 4;
const LEAD = 0.02;
const RADIUS = Math.round(0.025 * RATE);

export type HeadroomCase = {
  root: string;
  mode: string;
  octave: DroneOctave;
  sound: DroneSoundId;
  via: 'sustain' | 'key-change' | 'sound-switch';
  from: string;
};

export type HeadroomRow = {
  sound: string;
  from: string;
  root: string;
  mode: string;
  octave: string;
  via: string;
  peak: number;
  confirmed: number;
  kind: string;
  shift: number;
  index: number;
  later: string;
  pred: string;
  droneAt: number;
  chordLabel: string;
  chordFrets: string;
  chordPeak: number;
};

export type ContextChord = {
  root: string;
  mode: string;
  label: string;
  frets: string;
  midis: number[];
  peak: number;
  count: number;
};

export type RevMix = {
  pair: string;
  pred: string;
  later: string;
  shift: number;
  linear: number;
  confirmed: number;
};

export type HeadroomReport = {
  ua?: string;
  error?: string;
  chord?: {
    label: string;
    frets: string;
    midis: number[];
    peak: number;
    at: number;
  };
  contexts?: ContextChord[];
  rev?: {
    frets: string;
    midis: number[];
    peak: number;
    at: number;
    mixes: RevMix[];
  };
  rows?: HeadroomRow[];
  caps?: { reed: number; bow: number; cello: number };
};

type Channels = Float32Array[];
type Clip = { channels: Channels; peakAt: number };

type ChordChoice = {
  frets: (number | null)[];
  midis: number[];
  label: string;
};

export function headroomCases(): HeadroomCase[] {
  const sounds: DroneSoundId[] = ['reed', 'bow', 'cello'];
  const cases: HeadroomCase[] = [];
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      for (const sound of sounds) {
        cases.push({
          root,
          mode: mode.id,
          octave: 'layered',
          sound,
          via: 'sustain',
          from: '',
        });
        cases.push({
          root,
          mode: mode.id,
          octave: 'layered',
          sound,
          via: 'key-change',
          from: sound,
        });
        for (const from of sounds) {
          if (from === sound) continue;
          cases.push({
            root,
            mode: mode.id,
            octave: 'layered',
            sound,
            via: 'sound-switch',
            from,
          });
        }
      }
    }
  }
  return cases;
}

function switchMoment(): { now: number; when: number } {
  const now = DRONE_AT + REED_TIMING.playAttack + 0.2;
  return { now, when: now + 0.02 };
}

function droneSpan(via: HeadroomCase['via']): { start: number; end: number } {
  if (via === 'sustain') return { start: DRONE_AT, end: DRONE_AT + 3.6 };
  const { now } = switchMoment();
  return {
    start: now,
    end: now + REED_TIMING.switchFade + ROOM_SECONDS + TAIL_MARGIN,
  };
}

function renderSeconds(via: HeadroomCase['via']): number {
  return droneSpan(via).end + 0.45;
}

function samples(seconds: number): number {
  return Math.ceil(RATE * seconds);
}

function copyChannels(rendered: AudioBuffer): Channels {
  const channels: Channels = [];
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = new Float32Array(rendered.length);
    rendered.copyFromChannel(data, channel);
    channels.push(data);
  }
  return channels;
}

function peakOf(
  channels: Channels,
  from = 0,
  until = Infinity,
): { peak: number; at: number } {
  let peak = 0;
  let at = from;
  const start = Math.max(0, Math.floor(from * RATE));
  const end = Math.min(channels[0]?.length ?? 0, Math.ceil(until * RATE));
  for (const data of channels) {
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(data[index] ?? 0);
      if (value > peak) {
        peak = value;
        at = index / RATE;
      }
    }
  }
  return { peak, at };
}

function limiter(context: BaseAudioContext): DynamicsCompressorNode {
  const node = context.createDynamicsCompressor();
  node.threshold.value = DRONE_LIMITER.threshold;
  node.knee.value = DRONE_LIMITER.knee;
  node.ratio.value = DRONE_LIMITER.ratio;
  node.attack.value = DRONE_LIMITER.attack;
  node.release.value = DRONE_LIMITER.release;
  return node;
}

function graph(context: BaseAudioContext): {
  master: GainNode;
  limiter: DynamicsCompressorNode;
} {
  const master = context.createGain();
  master.gain.value = 1;
  const compressed = limiter(context);
  master.connect(compressed);
  compressed.connect(context.destination);
  return { master, limiter: compressed };
}

function scheduleDrone(
  context: BaseAudioContext,
  master: AudioNode,
  buffers: ReadonlyMap<string, AudioBuffer>,
  spec: HeadroomCase,
): void {
  const pitches = dronePitches(spec.root, spec.mode as DroneModeId, spec.octave);
  const cello = (sound: string) => (sound === 'cello' ? buffers : null);
  if (spec.via === 'sustain') {
    startLiveVoice(
      context,
      master,
      pitches,
      DRONE_AT,
      REED_TIMING.playAttack,
      spec.sound,
      cello(spec.sound),
      soundLinearCap(spec.sound),
    );
    return;
  }
  const from = spec.via === 'key-change' ? spec.sound : spec.from;
  const { now, when } = switchMoment();
  const held = startLiveVoice(
    context,
    master,
    pitches,
    DRONE_AT,
    REED_TIMING.playAttack,
    from as DroneSoundId,
    cello(from),
    soundLinearCap(from as DroneSoundId),
  );
  held.stop(when, REED_TIMING.switchFade, now);
  startLiveVoice(
    context,
    master,
    pitches,
    when,
    REED_TIMING.switchAttack,
    spec.sound,
    cello(spec.sound),
    soundLinearCap(spec.sound),
  );
}

async function renderOffline(
  seconds: number,
  schedule: (context: OfflineAudioContext) => void,
): Promise<Channels> {
  const context = new OfflineAudioContext(2, samples(seconds), RATE);
  schedule(context);
  return copyChannels(await context.startRendering());
}

const MODE_SCALE_ID: Record<string, string> = {
  ionian: 'major',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'minor',
  locrian: 'locrian',
};

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

/** A-string fret 8, the single F3 Rev rendered for E♭ Ionian. */
export const REV_FRET_KEY = 'x,8,x,x,x,x';

export function fretKey(frets: readonly (number | null)[]): string {
  return frets.map((fret) => (fret === null ? 'x' : String(fret))).join(',');
}

function scaleForMode(modeId: string) {
  const scale = SCALES.find((item) => item.id === MODE_SCALE_ID[modeId]);
  if (!scale) throw new Error(`No scale for ${modeId}.`);
  return scale;
}

const voicingCache = new Map<string, ReturnType<typeof voicings>>();

function cachedVoicings(root: string, qualityId: string) {
  const key = `${root}|${qualityId}`;
  const hit = voicingCache.get(key);
  if (hit) return hit;
  const quality = QUALITIES.find((item) => item.id === qualityId);
  if (!quality) throw new Error(`Unknown quality ${qualityId}.`);
  const found = voicings(root, quality);
  voicingCache.set(key, found);
  return found;
}

let playableCache: ChordChoice[] | undefined;

/**
 * Every shape the chord player can sound. Catalog grips and compact
 * voicings cover two to six notes. A fretboard tap and a one-note voicing
 * are the same call: one sounding string, frets 0–24. The loudest is chosen
 * by a rendered peak, never by dividing 0.75 by the note count.
 */
export function playableVoicings(): ChordChoice[] {
  if (playableCache) return playableCache;
  const seen = new Set<string>();
  const choices: ChordChoice[] = [];
  const add = (frets: readonly (number | null)[], label: string) => {
    const key = fretKey(frets);
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({ frets: [...frets], midis: voicingMidi(frets), label });
  };
  for (const root of DRONE_ROOTS) {
    for (const quality of QUALITIES) {
      for (const voicing of cachedVoicings(root, quality.id)) {
        const sounding = voicing.frets.filter((fret) => fret !== null).length;
        if (sounding < 2 || sounding > 6) continue;
        add(voicing.frets, `${root}${quality.symbol} ${voicing.name}`);
      }
    }
  }
  for (let string = 0; string < TUNING.length; string += 1) {
    for (let fret = 0; fret <= 24; fret += 1) {
      const frets: (number | null)[] = [null, null, null, null, null, null];
      frets[string] = fret;
      const name = STRING_NAMES[string] ?? String(string);
      add(frets, `${name}-string fret ${fret}`);
    }
  }
  playableCache = choices;
  return choices;
}

/** The same playable set for every key and mode. Any of these paths can sound. */
export function contextVoicings(root: string, modeId: string): ChordChoice[] {
  scaleForMode(modeId);
  if (!(DRONE_ROOTS as readonly string[]).includes(root)) {
    throw new Error(`No drone root ${root}.`);
  }
  return playableVoicings();
}

/** Highest measured peak. An equal peak keeps A-string fret 8 when it tied. */
export function loudestMeasured(
  choices: readonly ChordChoice[],
  peaks: readonly number[],
): { choice: ChordChoice; peak: number } {
  if (!choices.length || choices.length !== peaks.length) {
    throw new Error('Each voicing needs one measured peak.');
  }
  let best = Number.NEGATIVE_INFINITY;
  for (const peak of peaks) {
    if (peak === undefined || !Number.isFinite(peak)) {
      throw new Error('A voicing peak was not measured.');
    }
    if (peak > best) best = peak;
  }
  const tied = choices.filter((_, index) => peaks[index] === best);
  const rev = tied.find((choice) => fretKey(choice.frets) === REV_FRET_KEY);
  const choice = rev ?? tied[0];
  if (!choice) throw new Error('No voicing was measured.');
  return { choice, peak: best };
}

async function renderChord(frets: readonly (number | null)[], seconds: number): Promise<Clip> {
  const channels = await renderOffline(seconds, (context) => {
    scheduleVoicing(context, frets, LEAD, context.destination);
  });
  const found = peakOf(channels);
  return { channels, peakAt: found.at - LEAD };
}

function walkPeakSample(offset: number): number {
  return Math.round((LEAD + offset) * RATE);
}

type Extra = { channels: Channels; origin: number; center: number };

function placeScheduled(clip: Clip, start: number): Extra {
  const origin = Math.round(start * RATE) - Math.round(LEAD * RATE);
  return {
    channels: clip.channels,
    origin,
    center: origin + walkPeakSample(clip.peakAt),
  };
}

function neighborhoodPeak(base: Channels, extras: Extra[]): number {
  let peak = 0;
  const length = base[0]?.length ?? 0;
  for (const extra of extras) {
    const from = Math.max(0, extra.center - RADIUS);
    const to = Math.min(length, extra.center + RADIUS);
    for (let channel = 0; channel < base.length; channel += 1) {
      const data = base[channel];
      if (!data) continue;
      for (let index = from; index < to; index += 1) {
        let value = data[index] ?? 0;
        for (const item of extras) {
          const at = index - item.origin;
          const lane = item.channels[channel] ?? item.channels[0];
          if (lane && at >= 0 && at < lane.length) value += lane[at] ?? 0;
        }
        const abs = value < 0 ? -value : value;
        if (abs > peak) peak = abs;
      }
    }
  }
  return peak;
}

type WalkNote = { midi: number; name: string; at: number };

function placedNotes(
  notes: { midi: number; note: { name: string } }[],
  index: number,
  count: number,
  droneAt: number,
  offsets: Map<number, number>,
  shift: number,
): WalkNote[] {
  const chain: WalkNote[] = [];
  for (let back = 0; back < count; back += 1) {
    const note = notes[index - back];
    if (!note) return [];
    const at = droneAt - (offsets.get(note.midi) ?? 0) + shift - back * 0.8;
    if (at < 0.001) return [];
    chain.push({ midi: note.midi, name: note.note.name, at });
  }
  return chain;
}

function kindName(count: number): string {
  if (count === 1) return 'single';
  if (count === 2) return 'pair';
  if (count === 3) return 'triple';
  return 'quad';
}

function searchMix(
  drone: Channels,
  droneAt: number,
  notes: { midi: number; note: { name: string } }[],
  walks: Map<number, Clip>,
  chord: Clip,
): { peak: number; index: number; count: number; shift: number } {
  const offsets = new Map<number, number>();
  for (const note of notes) offsets.set(note.midi, walks.get(note.midi)?.peakAt ?? 0);
  const mixAt = (
    index: number,
    count: number,
    shift: number,
  ): number => {
    const chain = placedNotes(notes, index, count, droneAt, offsets, shift);
    if (!chain.length) return -1;
    const extras = chain.map((note) => {
      const clip = walks.get(note.midi);
      if (!clip) throw new Error(`Missing walk ${note.midi}`);
      return placeScheduled(clip, note.at);
    });
    extras.push(placeScheduled(chord, droneAt - chord.peakAt + shift));
    return neighborhoodPeak(drone, extras);
  };
  let best = { peak: -1, index: 1, count: 1, shift: 0 };
  for (let index = 0; index < notes.length; index += 1) {
    for (const count of [1, 2, 3, 4]) {
      const peak = mixAt(index, count, 0);
      if (peak > best.peak) best = { peak, index, count, shift: 0 };
    }
  }
  for (let step = -5; step <= 5; step += 1) {
    const shift = step * 0.004;
    for (const count of [1, 2, 3, 4]) {
      const peak = mixAt(best.index, count, shift);
      if (peak > best.peak) best = { peak, index: best.index, count, shift };
    }
  }
  return best;
}

async function renderCombined(
  buffers: ReadonlyMap<string, AudioBuffer>,
  spec: HeadroomCase,
  notes: WalkNote[],
  chord: ChordChoice,
  chordAt: number,
): Promise<number> {
  const seconds =
    Math.max(
      renderSeconds(spec.via),
      ...notes.map((note) => note.at + 2.8),
      chordAt + 3.2,
    ) + 0.15;
  const channels = await renderOffline(seconds, (context) => {
    const { master, limiter: compressed } = graph(context);
    scheduleDrone(context, master, buffers, spec);
    for (const note of notes) {
      startWalkPluck(context, compressed, note.midi, note.at, 1);
    }
    scheduleVoicing(context, chord.frets, chordAt, context.destination);
  });
  return peakOf(channels).peak;
}

async function pool(
  count: number,
  worker: (index: number) => Promise<void>,
): Promise<void> {
  let next = 0;
  async function run(): Promise<void> {
    while (next < count) {
      const index = next;
      next += 1;
      await worker(index);
    }
  }
  const width = Math.min(4, count);
  await Promise.all(Array.from({ length: width }, () => run()));
}

type ReadyChord = {
  choice: ChordChoice;
  clip: Clip;
  peak: number;
  count: number;
};

function contextId(root: string, mode: string): string {
  return `${root}|${mode}`;
}

async function measureContextChords(log: (message: string) => void): Promise<{
  ready: Map<string, ReadyChord>;
  rev: { choice: ChordChoice; clip: Clip; peak: number };
}> {
  const lists = new Map<string, ChordChoice[]>();
  const unique = new Map<string, ChordChoice>();
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      const choices = contextVoicings(root, mode.id);
      if (!choices.length) throw new Error(`${root} ${mode.id} has no voicing.`);
      lists.set(contextId(root, mode.id), choices);
      for (const choice of choices) {
        const key = fretKey(choice.frets);
        if (!unique.has(key)) unique.set(key, choice);
      }
    }
  }
  const eb = lists.get(contextId('Eb', 'ionian'));
  if (!eb?.some((choice) => fretKey(choice.frets) === REV_FRET_KEY)) {
    throw new Error('Eb ionian does not include A-string fret 8.');
  }
  const shapes = [...unique.values()];
  log(`voicings ${shapes.length}`);
  const shortPeaks = Array.from({ length: shapes.length }, () => Number.NaN);
  await pool(shapes.length, async (index) => {
    const choice = shapes[index];
    if (!choice) return;
    const clip = await renderChord(choice.frets, 0.6);
    shortPeaks[index] = peakOf(clip.channels).peak;
    if (index % 1000 === 0) log(`measured ${index}`);
  });
  const peakByKey = new Map<string, number>();
  shapes.forEach((shape, index) => {
    const peak = shortPeaks[index];
    if (peak === undefined) throw new Error(`Missing peak for ${shape.label}.`);
    peakByKey.set(fretKey(shape.frets), peak);
  });
  const selected = new Map<
    string,
    { choice: ChordChoice; peak: number; count: number }
  >();
  const winnerKeys = new Set<string>([REV_FRET_KEY]);
  for (const [key, choices] of lists) {
    const measured = loudestMeasured(
      choices,
      choices.map((choice) => {
        const peak = peakByKey.get(fretKey(choice.frets));
        if (peak === undefined) throw new Error(`Missing peak for ${choice.label}.`);
        return peak;
      }),
    );
    selected.set(key, { choice: measured.choice, peak: measured.peak, count: choices.length });
    winnerKeys.add(fretKey(measured.choice.frets));
  }
  const revChoice = unique.get(REV_FRET_KEY);
  if (!revChoice) throw new Error('A-string fret 8 was not rendered.');
  const clips = new Map<string, Clip>();
  for (const key of winnerKeys) {
    const shape = unique.get(key);
    if (!shape) throw new Error(`Missing shape ${key}.`);
    const clip = await renderChord(shape.frets, 3.2);
    const peak = peakOf(clip.channels).peak;
    if (!(clip.peakAt >= 0) || !(peak > 0.2)) {
      throw new Error(`${shape.label} rendered at ${peak}.`);
    }
    clips.set(key, clip);
  }
  const ready = new Map<string, ReadyChord>();
  for (const [key, item] of selected) {
    const id = fretKey(item.choice.frets);
    const clip = clips.get(id);
    if (!clip) throw new Error(`Missing clip ${id}.`);
    const full = peakOf(clip.channels).peak;
    const choices = lists.get(key);
    if (!choices) throw new Error(`Missing choices for ${key}.`);
    for (const choice of choices) {
      const short = peakByKey.get(fretKey(choice.frets));
      if (
        short !== undefined &&
        short > full + 0.002 &&
        fretKey(choice.frets) !== fretKey(item.choice.frets)
      ) {
        throw new Error(
          `${key} kept ${item.choice.label} at ${full}, below ${choice.label} at ${short}.`,
        );
      }
    }
    ready.set(key, {
      choice: item.choice,
      clip,
      peak: full,
      count: item.count,
    });
  }
  const revClip = clips.get(REV_FRET_KEY);
  if (!revClip) throw new Error('A-string fret 8 clip is missing.');
  return {
    ready,
    rev: { choice: revChoice, clip: revClip, peak: peakOf(revClip.channels).peak },
  };
}

async function renderRevMixes(
  buffers: ReadonlyMap<string, AudioBuffer>,
  drone: Channels,
  droneAt: number,
  walks: Map<number, Clip>,
  rev: { choice: ChordChoice; clip: Clip },
): Promise<RevMix[]> {
  const notes = scaleWalk('Eb', 'ionian');
  const pairs: { index: number; pred: string; later: string; name: string }[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    const later = notes[index];
    const pred = notes[index - 1];
    if (!later || !pred || later.midi !== 67 || later.note.name !== 'G') continue;
    pairs.push({
      index,
      pred: `${pred.note.name}${pred.midi}`,
      later: `${later.note.name}${later.midi}`,
      name: `${pred.note.name}${pred.midi} then G${later.midi}`,
    });
  }
  if (pairs.length !== 2) throw new Error(`Expected two G4 steps, found ${pairs.length}.`);
  const spec = headroomCases().find(
    (item) =>
      item.root === 'Eb' &&
      item.mode === 'ionian' &&
      item.sound === 'cello' &&
      item.via === 'sustain',
  );
  if (!spec) throw new Error('Eb ionian cello sustain is missing.');
  const offsets = new Map([...walks].map(([midi, clip]) => [midi, clip.peakAt]));
  const mixes: RevMix[] = [];
  for (const pair of pairs) {
    let best = { peak: -1, shift: 0 };
    for (let step = -5; step <= 5; step += 1) {
      const shift = step * 0.004;
      const chain = placedNotes(notes, pair.index, 2, droneAt, offsets, shift);
      if (chain.length !== 2) continue;
      const extras = chain.map((note) => {
        const clip = walks.get(note.midi);
        if (!clip) throw new Error(`Missing walk ${note.midi}.`);
        return placeScheduled(clip, note.at);
      });
      extras.push(placeScheduled(rev.clip, droneAt - rev.clip.peakAt + shift));
      const peak = neighborhoodPeak(drone, extras);
      if (peak > best.peak) best = { peak, shift };
    }
    const chain = placedNotes(notes, pair.index, 2, droneAt, offsets, best.shift);
    const confirmed = await renderCombined(
      buffers,
      spec,
      chain,
      rev.choice,
      droneAt - rev.clip.peakAt + best.shift,
    );
    if (Math.abs(confirmed - best.peak) > 0.01) {
      throw new Error(
        `Rev ${pair.name} linear ${best.peak} combined ${confirmed}.`,
      );
    }
    mixes.push({
      pair: pair.name,
      pred: pair.pred,
      later: pair.later,
      shift: best.shift,
      linear: best.peak,
      confirmed,
    });
  }
  return mixes;
}

export async function runHeadroom(): Promise<HeadroomReport> {
  const started = performance.now();
  const log = (message: string) => {
    console.log(message);
  };
  const files = [
    'cello-d2.m4a',
    'cello-a2.m4a',
    'cello-e3.m4a',
    'cello-b3.m4a',
    'cello-f4.m4a',
  ];
  const decodeContext = new AudioContext();
  const buffers = new Map<string, AudioBuffer>();
  try {
    for (const file of files) {
      const bytes = await (await fetch(`/audio/${file}`)).arrayBuffer();
      const decoded = await decodeContext.decodeAudioData(bytes.slice(0));
      buffers.set(file, prepareCelloBuffer(decodeContext, decoded));
    }
    const measured = await measureContextChords(log);
    const ebKey = contextId('Eb', 'ionian');
    const ebChord = measured.ready.get(ebKey);
    if (!ebChord) throw new Error('Eb ionian has no measured chord.');
    log(
      `chord ${ebChord.choice.label} frets ${fretKey(ebChord.choice.frets)} peak ${ebChord.peak} at ${ebChord.clip.peakAt} of ${ebChord.count}`,
    );
    const midis = new Set<number>();
    for (const root of DRONE_ROOTS) {
      for (const mode of DRONE_MODES) {
        for (const note of scaleWalk(root, mode.id)) midis.add(note.midi);
      }
    }
    const walks = new Map<number, Clip>();
    for (const midi of midis) {
      const channels = await renderOffline(2.8, (context) => {
        const { limiter: compressed } = graph(context);
        startWalkPluck(context, compressed, midi, LEAD, 1);
      });
      const found = peakOf(channels);
      if (!(found.peak > 0.01)) throw new Error(`Walk ${midi} was silent.`);
      walks.set(midi, { channels, peakAt: found.at - LEAD });
    }
    const check = headroomCases().find(
      (item) =>
        item.root === 'Eb' &&
        item.mode === 'ionian' &&
        item.sound === 'cello' &&
        item.via === 'sustain',
    );
    if (!check) throw new Error('Eb ionian cello sustain is missing.');
    const checkNotes = scaleWalk(check.root, check.mode);
    const checkDrone = await renderOffline(renderSeconds(check.via), (context) => {
      const { master } = graph(context);
      scheduleDrone(context, master, buffers, check);
    });
    const checkSpan = droneSpan(check.via);
    const checkPeak = peakOf(checkDrone, checkSpan.start, checkSpan.end);
    const checkSearch = searchMix(
      checkDrone,
      checkPeak.at,
      checkNotes,
      walks,
      ebChord.clip,
    );
    const checkPlaced = placedNotes(
      checkNotes,
      checkSearch.index,
      checkSearch.count,
      checkPeak.at,
      new Map(
        [...walks].map(([midi, clip]) => [midi, clip.peakAt]),
      ),
      checkSearch.shift,
    );
    const checkCombined = await renderCombined(
      buffers,
      check,
      checkPlaced,
      ebChord.choice,
      checkPeak.at - ebChord.clip.peakAt + checkSearch.shift,
    );
    const revMixes = await renderRevMixes(
      buffers,
      checkDrone,
      checkPeak.at,
      walks,
      measured.rev,
    );
    for (const mix of revMixes) {
      log(
        `rev ${mix.pair} shift ${mix.shift} linear ${mix.linear} confirmed ${mix.confirmed}`,
      );
    }
    const gap = Math.abs(checkCombined - checkSearch.peak);
    log(
      `linearity cello Eb ionian ${kindName(checkSearch.count)} linear ${checkSearch.peak} combined ${checkCombined} gap ${gap}`,
    );
    if (gap > 0.01) {
      throw new Error(
        `Linear mix missed the rendered chord by ${gap} (linear ${checkSearch.peak}, combined ${checkCombined}).`,
      );
    }
    const cases = headroomCases();
    const rows: HeadroomRow[] = [];
    for (let index = 0; index < cases.length; index += 1) {
      const spec = cases[index];
      if (!spec) continue;
      const notes = scaleWalk(spec.root, spec.mode);
      const span = droneSpan(spec.via);
      const drone = await renderOffline(renderSeconds(spec.via), (context) => {
        const { master } = graph(context);
        scheduleDrone(context, master, buffers, spec);
      });
      const dronePeak = peakOf(drone, span.start, span.end);
      if (!(dronePeak.peak > 0.01)) {
        throw new Error(
          `${spec.sound} ${spec.root} ${spec.mode} ${spec.via} drone was silent.`,
        );
      }
      const ready = measured.ready.get(contextId(spec.root, spec.mode));
      if (!ready) throw new Error(`No chord for ${spec.root} ${spec.mode}.`);
      const found = searchMix(drone, dronePeak.at, notes, walks, ready.clip);
      const later = notes[found.index];
      const pred = notes[found.index - 1];
      rows.push({
        sound: spec.sound,
        from: spec.from,
        root: spec.root,
        mode: spec.mode,
        octave: spec.octave,
        via: spec.via,
        peak: found.peak,
        confirmed: found.peak,
        kind: kindName(found.count),
        shift: found.shift,
        index: found.index,
        later: later ? `${later.note.name}${later.midi}` : '',
        pred: pred ? `${pred.note.name}${pred.midi}` : '',
        droneAt: dronePeak.at,
        chordLabel: ready.choice.label,
        chordFrets: fretKey(ready.choice.frets),
        chordPeak: ready.peak,
      });
      if ((index + 1) % 24 === 0) {
        const elapsed = ((performance.now() - started) / 1000).toFixed(0);
        log(`measured ${index + 1}/${cases.length} ${elapsed}s`);
      }
    }
    for (const sound of ['reed', 'bow', 'cello']) {
      const ranked = rows
        .filter((row) => row.sound === sound)
        .sort((a, b) => b.peak - a.peak)
        .slice(0, 3);
      for (const row of ranked) {
        const spec = cases.find(
          (item) =>
            item.sound === row.sound &&
            item.root === row.root &&
            item.mode === row.mode &&
            item.via === row.via &&
            item.from === row.from,
        );
        if (!spec) continue;
        const notes = scaleWalk(spec.root, spec.mode);
        const offsets = new Map(
          [...walks].map(([midi, clip]) => [midi, clip.peakAt]),
        );
        const count =
          row.kind === 'single'
            ? 1
            : row.kind === 'pair'
              ? 2
              : row.kind === 'triple'
                ? 3
                : 4;
        const chain = placedNotes(
          notes,
          row.index,
          count,
          row.droneAt,
          offsets,
          row.shift,
        );
        const ready = measured.ready.get(contextId(spec.root, spec.mode));
        if (!ready) throw new Error(`No chord for ${spec.root} ${spec.mode}.`);
        const confirmed = await renderCombined(
          buffers,
          spec,
          chain,
          ready.choice,
          row.droneAt - ready.clip.peakAt + row.shift,
        );
        row.confirmed = confirmed;
        if (Math.abs(confirmed - row.peak) > 0.01) {
          throw new Error(
            `${sound} ${row.root} ${row.mode} ${row.via} linear ${row.peak} combined ${confirmed}`,
          );
        }
      }
    }
    const contexts: ContextChord[] = [];
    for (const root of DRONE_ROOTS) {
      for (const mode of DRONE_MODES) {
        const ready = measured.ready.get(contextId(root, mode.id));
        if (!ready) throw new Error(`No chord for ${root} ${mode.id}.`);
        contexts.push({
          root,
          mode: mode.id,
          label: ready.choice.label,
          frets: fretKey(ready.choice.frets),
          midis: ready.choice.midis,
          peak: ready.peak,
          count: ready.count,
        });
      }
    }
    return {
      ua: navigator.userAgent,
      chord: {
        label: ebChord.choice.label,
        frets: fretKey(ebChord.choice.frets),
        midis: ebChord.choice.midis,
        peak: ebChord.peak,
        at: ebChord.clip.peakAt,
      },
      contexts,
      rev: {
        frets: fretKey(measured.rev.choice.frets),
        midis: measured.rev.choice.midis,
        peak: measured.rev.peak,
        at: measured.rev.clip.peakAt,
        mixes: revMixes,
      },
      rows,
      caps: {
        reed: DRONE_MAX_LINEAR_GAIN,
        bow: soundLinearCap('bow'),
        cello: soundLinearCap('cello'),
      },
    };
  } finally {
    void decodeContext.close();
  }
}
