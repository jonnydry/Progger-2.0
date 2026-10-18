/**
 * A/B phrases for the musicality rules.
 * Both sides render from this commit, through schedulePhrase.
 * A is main's phrase.ts, loaded from git into a temp file. That copy is not shipped.
 * B is lib/phrase.ts at HEAD.
 * Run: node --experimental-strip-types scripts/render-musicality-clips.ts <outDir>
 * Track 2: node --experimental-strip-types scripts/render-musicality-clips.ts --track2 <outDir>
 * Track 2 compares main at bb7b12d (arm A) with generateShapedPhrase (arm B).
 * Arm C is left out: no live Jev distribution has been recorded.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, TUNING, spell, type Note } from '../lib/music.ts';
import { schedulePhrase } from '../lib/phrase-audio.ts';
import {
  PHRASE_CELL_LIMIT,
  generatePhrase,
  generateShapedPhrase,
  mulberry32,
  onsetSeconds,
  phraseCellLength,
  phraseOnsets,
  swingRatioForAmount,
  type RhythmId,
  type SwingInput,
} from '../lib/phrase.ts';
import {
  barThreeTwists,
  motifRecurs,
  questionHits,
  type PhraseShapePlan,
} from '../lib/phrase-shape.ts';

/** Straight clips. Amount 0 is ratio 1, the same timing as the 'straight' feel. */
const CLIP_STRAIGHT_SWING = 0;
/**
 * Light swing these pairs used when 0.6 was the session default, before #27
 * started new sessions straight. Pinned so the clips keep that timing.
 */
const CLIP_LIGHT_SWING = 0.6;

const RATE = 44100;
const TAIL_SEC = 2.7;
const BARS = 4 as const;
const BASE_SHA = '00a5de376e061a16d6ae8a09076ea2e807cd31b3';
const TRACK2_SHA = 'bb7b12d1c3889b0d79deb099c17e2b68ab5e5e47';
const SOUND =
  'plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)';
const LU_LIMIT = 0.5;
const LU_CENTER = -16;
const PEAK_CEILING_DB = -1;

type Side = 'A' | 'B';

type ClipNote = {
  name: string;
  midi: number;
  beat: number;
  duration: number;
  string: number;
  fret: number;
};

type Generated = {
  notes: ClipNote[];
  plan: {
    contour: string;
    rhythm: RhythmId;
    register: string;
    cadence: string;
  };
};

type Pair = {
  id: string;
  stem: string;
  seed: number;
  root: string;
  scaleId: string;
  scaleLabel: string;
  chord: string;
  tempo: number;
  swing: SwingInput;
  swingLabel: string;
  listen: string;
  /** Seed this pair used before the grid fix, when that line is now identical. */
  swappedFrom: number | null;
};

const PAIRS: readonly Pair[] = [
  {
    id: 'pair1',
    stem: 'pair1_A-dorian_90bpm_straight',
    seed: 16,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 90,
    swing: CLIP_STRAIGHT_SWING,
    swingLabel: 'straight (amount 0, ratio 1)',
    swappedFrom: 7,
    listen:
      'Seed 7 is the same E–F# loop on both sides now, so this pair is seed 16. A steps B down to A, then D to C. B leaps A up to D and settles C–D–C. Same quarter-note beats.',
  },
  {
    id: 'pair2',
    stem: 'pair2_C-major_120bpm_straight',
    seed: 3,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 120,
    swing: CLIP_STRAIGHT_SWING,
    swingLabel: 'straight (amount 0, ratio 1)',
    swappedFrom: 1,
    listen:
      'Seed 1 is the same G–A loop on both sides now, so this pair is seed 3. A ends by wobbling D and C. B walks F–E–D–C down to the root. Same quarter-note beats.',
  },
  {
    id: 'pair3',
    stem: 'pair3_A-dorian_120bpm_straight',
    seed: 1,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 120,
    swing: CLIP_STRAIGHT_SWING,
    swingLabel: 'straight (amount 0, ratio 1)',
    swappedFrom: null,
    listen:
      'Same seed as before. A leaps C up to F# into the fifth. B steps D–E–F#–E on the same quarter-note beats.',
  },
  {
    id: 'pair4',
    stem: 'pair4_A-dorian_90bpm_swing',
    seed: 18,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 90,
    swing: CLIP_LIGHT_SWING,
    swingLabel: '',
    swappedFrom: 8,
    listen:
      'Seed 8 matches main now, so this pair is seed 18. Both lines are long–short, so the 60% swing is in A and in B. A holds B–A into the root. B steps G up to A.',
  },
  {
    id: 'pair5',
    stem: 'pair5_A-dorian_120bpm_swing',
    seed: 28,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 120,
    swing: CLIP_LIGHT_SWING,
    swingLabel: '',
    swappedFrom: 24,
    listen:
      'Seed 24 is pushed eighths and matches main, as does every push seed from 1 to 64 in A Dorian and C major. This pair is seed 28, long–short. A stays on E and F#. B steps down to D, then back through E–F#–E. The 60% swing is in both.',
  },
  {
    id: 'pair6',
    stem: 'pair6_C-major_120bpm_swing',
    seed: 11,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 120,
    swing: CLIP_LIGHT_SWING,
    swingLabel: '',
    swappedFrom: 8,
    listen:
      'Seed 8 matches main now, so this pair is seed 11. Both lines are long–short with the same 60% swing. A walks D–C, then leaps to F. B turns the ending into F–E–F–E.',
  },
];

function git(args: readonly string[]): string {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  }
  return result.stdout;
}

function requireCleanHead(): { head: string; tree: string } {
  const dirty = git([
    'status',
    '--porcelain',
    '--',
    'lib/phrase.ts',
    'lib/phrase-audio.ts',
    'lib/voicing-audio.ts',
    'lib/drone-audio.ts',
    'lib/drone.ts',
    'lib/drone-session.ts',
    'scripts/render-musicality-clips.ts',
  ]).trim();
  if (dirty && process.env.RENDER_ALLOW_DIRTY !== '1') {
    throw new Error(
      `Refusing to render from a dirty tree. Commit first.\n${dirty}`,
    );
  }
  return {
    head: git(['rev-parse', 'HEAD']).trim(),
    tree: git(['rev-parse', 'HEAD^{tree}']).trim(),
  };
}

async function loadRulesAt(sha: string): Promise<{
  generatePhrase: typeof generatePhrase;
}> {
  const source = git(['show', `${sha}:lib/phrase.ts`]);
  const music = pathToFileURL(join(process.cwd(), 'lib/music.ts')).href;
  const marks = pathToFileURL(join(process.cwd(), 'lib/phrase-marks.ts')).href;
  const rewritten = source
    .replaceAll("from './music.ts'", `from '${music}'`)
    .replaceAll("from './phrase-marks.ts'", `from '${marks}'`);
  if (rewritten.includes("from './music.ts'")) {
    throw new Error('Baseline import rewrite missed ./music.ts');
  }
  const dir = mkdtempSync(join(tmpdir(), 'phrase-main-rules-'));
  const file = join(dir, 'phrase.ts');
  writeFileSync(file, rewritten);
  try {
    return (await import(pathToFileURL(file).href)) as {
      generatePhrase: typeof generatePhrase;
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function loadMainRules(): Promise<{
  generatePhrase: typeof generatePhrase;
}> {
  return loadRulesAt(BASE_SHA);
}

function scaleNotes(root: string, scaleId: string): Note[] {
  const scale = SCALES.find((item) => item.id === scaleId);
  if (!scale) throw new Error(`Missing scale ${scaleId}`);
  return spell(root, scale.formula);
}

function asGenerated(result: ReturnType<typeof generatePhrase>): Generated {
  if (!result.ok) throw new Error(result.reason);
  return {
    plan: result.phrase.plan,
    notes: result.phrase.notes.map((note) => ({
      name: note.name,
      midi: note.midi,
      beat: note.beat,
      duration: note.duration,
      string: note.string,
      fret: note.fret,
    })),
  };
}

function spellLine(notes: readonly ClipNote[]): string {
  return notes
    .map((note) => {
      const octave = Math.floor(note.midi / 12) - 1;
      return `${note.name}${octave}@${note.beat}`;
    })
    .join(' ');
}

function samplePeak(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function writeWav(path: string, samples: Float32Array, gain: number): number {
  const peak = samplePeak(samples) * gain;
  if (peak > 0.98) throw new Error(`${path} would peak at ${peak}`);
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
    data.writeInt16LE(Math.round(sample * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
  return peak;
}

function encodeMp3(wav: string, mp3: string): void {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      wav,
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
      mp3,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffmpeg mp3 failed for ${wav}`);
  }
}

function measure(path: string): { lufs: number; peakDbfs: number } {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `ebur128 failed for ${path}`);
  }
  const text = result.stderr;
  const lufs = /Integrated loudness:\s+I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(text);
  const peak = /True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?) dBFS/.exec(text);
  if (!lufs || !peak) {
    throw new Error(`Could not parse ebur128 for ${path}\n${text}`);
  }
  return { lufs: Number(lufs[1]), peakDbfs: Number(peak[1]) };
}

async function render(
  notes: readonly ClipNote[],
  tempo: number,
  swing: SwingInput,
): Promise<Float32Array> {
  const last = notes.at(-1)?.beat ?? BARS * 4;
  const seconds = onsetSeconds(last, tempo, swing) + TAIL_SEC;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(context, context.destination, notes, tempo, swing, 0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

function dbToGain(db: number): number {
  return 10 ** (db / 20);
}

type MeasuredSide = {
  lufs: number;
  peakDbfs: number;
  samplePeak: number;
  seconds: number;
  gain: number;
};

function publish(
  outDir: string,
  stem: string,
  side: Side,
  samples: Float32Array,
  gain: number,
): MeasuredSide {
  const wav = join(outDir, `${stem}_${side}.wav`);
  const mp3 = join(outDir, `${stem}_${side}.mp3`);
  const sample = writeWav(wav, samples, gain);
  encodeMp3(wav, mp3);
  const loudness = measure(wav);
  return {
    ...loudness,
    samplePeak: sample,
    seconds: samples.length / RATE,
    gain,
  };
}

function probeLoudness(
  samples: Float32Array,
  gain: number,
): { lufs: number; peakDbfs: number } {
  const dir = mkdtempSync(join(tmpdir(), 'phrase-loudness-'));
  const wav = join(dir, 'probe.wav');
  try {
    writeWav(wav, samples, gain);
    return measure(wav);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * One gain for both sides. The average integrated loudness aims at -16 LUFS.
 * If that would push either wav true peak over -1 dBTP, the shared gain
 * backs off until the hotter peak sits on the ceiling. The gap cannot shrink.
 */
async function matchPair(
  outDir: string,
  pair: Pair,
  rendered: Record<Side, Float32Array>,
): Promise<Record<Side, MeasuredSide>> {
  const rawPeak = Math.max(samplePeak(rendered.A), samplePeak(rendered.B));
  if (rawPeak <= 0) throw new Error(`${pair.id} is silent`);
  const probeGain = 0.25 / rawPeak;
  const probed = {
    A: probeLoudness(rendered.A, probeGain),
    B: probeLoudness(rendered.B, probeGain),
  };
  const rawGap = probed.A.lufs - probed.B.lufs;
  if (Math.abs(rawGap) > LU_LIMIT) {
    throw new Error(
      `${pair.id} raw loudness gap ${rawGap.toFixed(2)} LU is outside ${LU_LIMIT} LU, and both sides share one gain`,
    );
  }
  const average = (probed.A.lufs + probed.B.lufs) / 2;
  let makeupDb = LU_CENTER - average;
  const hotter = Math.max(probed.A.peakDbfs, probed.B.peakDbfs) + makeupDb;
  if (hotter > PEAK_CEILING_DB) makeupDb -= hotter - PEAK_CEILING_DB;
  let gain = probeGain * dbToGain(makeupDb);
  const sampleCeiling = 10 ** (PEAK_CEILING_DB / 20);
  if (rawPeak * gain > sampleCeiling) gain = sampleCeiling / rawPeak;

  let published: Record<Side, MeasuredSide> | null = null;
  for (let pass = 0; pass < 4; pass += 1) {
    published = {
      A: publish(outDir, pair.stem, 'A', rendered.A, gain),
      B: publish(outDir, pair.stem, 'B', rendered.B, gain),
    };
    const peak = Math.max(published.A.peakDbfs, published.B.peakDbfs);
    if (peak <= PEAK_CEILING_DB) break;
    gain *= dbToGain(PEAK_CEILING_DB - peak - 0.05);
  }
  if (!published) throw new Error(`${pair.id} produced no audio`);
  if (published.A.gain !== published.B.gain) {
    throw new Error(`${pair.id} applied different gains`);
  }
  const gap = published.A.lufs - published.B.lufs;
  if (Math.abs(gap) > LU_LIMIT) {
    throw new Error(
      `${pair.id} loudness gap ${gap.toFixed(2)} LU is outside ${LU_LIMIT} LU`,
    );
  }
  for (const side of ['A', 'B'] as const) {
    if (published[side].peakDbfs > PEAK_CEILING_DB) {
      throw new Error(
        `${pair.id} ${side} true peak ${published[side].peakDbfs.toFixed(2)} dBTP is above ${PEAK_CEILING_DB}`,
      );
    }
  }
  return published;
}

function swingText(pair: Pair): string {
  if (typeof pair.swing !== 'number' || pair.swing === CLIP_STRAIGHT_SWING)
    return pair.swingLabel;
  const ratio = swingRatioForAmount(pair.tempo, pair.swing);
  return `swing amount ${pair.swing} (pinned light swing, the value these clips used before the session default became straight), ratio ${ratio.toFixed(4)} at ${pair.tempo} BPM`;
}

const TRACK2_SEEDS = [1, 3, 7, 11, 16, 24] as const;
const SHUFFLE_SEED = 20261018;

type TrackTrial = {
  id: string;
  seed: number;
  root: string;
  scaleId: string;
  scaleLabel: string;
  chord: string;
  tempo: number;
};

const TRACK2_TRIALS: readonly TrackTrial[] = [
  {
    id: 'listen-01',
    seed: 1,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 90,
  },
  {
    id: 'listen-02',
    seed: 3,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 120,
  },
  {
    id: 'listen-03',
    seed: 7,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 90,
  },
  {
    id: 'listen-04',
    seed: 11,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 120,
  },
  {
    id: 'listen-05',
    seed: 16,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 90,
  },
  {
    id: 'listen-06',
    seed: 24,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 120,
  },
  {
    id: 'listen-07',
    seed: 1,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 90,
  },
  {
    id: 'listen-08',
    seed: 7,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 120,
  },
];

type MetricNote = {
  beat: number;
  duration: number;
  midi: number;
  degree: string;
  strong: boolean;
  chordTone: boolean;
  fret: number;
  string: number;
};

type MetricPhrase = {
  bars: 2 | 4;
  notes: MetricNote[];
  plan: {
    contour: string;
    rhythm: RhythmId;
    register: string;
    cadence: string;
    shape?: PhraseShapePlan;
  };
};

type MetricBucket = {
  phrases: number;
  arches: number;
  archHits: number;
  circling: number;
  loopsOver4: number;
  illegalLines: number;
  strongBeats: number;
  strongBeatChordTones: number;
  onsetChanges: number;
  motifRecurrence: number;
  cadenceHits: number;
  questionHits: number;
  shaped: number;
  twists: number;
  twistPhrases: number;
  contexts: number;
  distinctPlansMean: number;
  distinctPlansMin: number;
};

function emptyBucket(): MetricBucket {
  return {
    phrases: 0,
    arches: 0,
    archHits: 0,
    circling: 0,
    loopsOver4: 0,
    illegalLines: 0,
    strongBeats: 0,
    strongBeatChordTones: 0,
    onsetChanges: 0,
    motifRecurrence: 0,
    cadenceHits: 0,
    questionHits: 0,
    shaped: 0,
    twists: 0,
    twistPhrases: 0,
    contexts: 0,
    distinctPlansMean: 0,
    distinctPlansMin: 0,
  };
}

function thirdMeans(midis: readonly number[]): [number, number, number] {
  const third = Math.max(1, Math.floor(midis.length / 3));
  const mean = (slice: readonly number[]) =>
    slice.reduce((sum, midi) => sum + midi, 0) / slice.length;
  return [
    mean(midis.slice(0, third)),
    mean(midis.slice(third, third * 2)),
    mean(midis.slice(third * 2)),
  ];
}

function phraseCircles(midis: readonly number[]): boolean {
  for (let start = 0; start < midis.length; start++) {
    const seen = new Set<number>([midis[start]]);
    for (let end = start + 1; end < midis.length; end++) {
      if (end - start >= 3 && midis[end] !== midis[end - 3]) break;
      seen.add(midis[end]);
      if (seen.size > 3) break;
      if (Math.max(...seen) - Math.min(...seen) > 4) break;
      if (end - start + 1 > 4 && seen.size === 3) return true;
    }
  }
  return false;
}

function lineIsIllegal(notes: readonly MetricNote[]): boolean {
  return notes.some((note) => {
    if (note.fret < 0 || note.fret > 24) return true;
    const open = TUNING[note.string];
    if (open === undefined) return true;
    if (note.midi !== open + note.fret) return true;
    return note.strong && !note.chordTone;
  });
}

function gridKey(notes: readonly MetricNote[]): string {
  return notes.map((note) => `${note.beat}:${note.duration}`).join(',');
}

function planKey(phrase: MetricPhrase): string {
  const shape = phrase.plan.shape;
  const shapeKey = shape
    ? JSON.stringify({
        motif: shape.motif,
        variations: shape.variations,
        question: shape.question,
      })
    : '';
  return [
    phrase.plan.contour,
    phrase.plan.rhythm,
    phrase.plan.register,
    phrase.plan.cadence,
    shapeKey,
  ].join('|');
}

function takePhrase(result: ReturnType<typeof generatePhrase>): MetricPhrase {
  if (!result.ok) throw new Error(result.reason);
  return {
    bars: result.phrase.bars,
    notes: result.phrase.notes.map((note) => ({
      beat: note.beat,
      duration: note.duration,
      midi: note.midi,
      degree: note.degree,
      strong: note.strong,
      chordTone: note.chordTone,
      fret: note.fret,
      string: note.string,
    })),
    plan: result.phrase.plan,
  };
}

function foldPhrase(
  bucket: MetricBucket,
  phrase: MetricPhrase,
  baseline: MetricPhrase,
): void {
  bucket.phrases += 1;
  const midis = phrase.notes.map((note) => note.midi);
  if (phrase.plan.contour === 'arch') {
    bucket.arches += 1;
    const [first, middle, last] = thirdMeans(midis);
    if (middle > first && middle > last) bucket.archHits += 1;
  }
  if (phraseCircles(midis)) bucket.circling += 1;
  if (phraseCellLength(midis) > PHRASE_CELL_LIMIT) bucket.loopsOver4 += 1;
  if (lineIsIllegal(phrase.notes)) bucket.illegalLines += 1;
  for (const note of phrase.notes) {
    if (!note.strong) continue;
    bucket.strongBeats += 1;
    if (note.chordTone) bucket.strongBeatChordTones += 1;
  }
  if (gridKey(phrase.notes) !== gridKey(baseline.notes))
    bucket.onsetChanges += 1;
  if (motifRecurs(phrase.notes, phrase.plan.rhythm, phrase.bars))
    bucket.motifRecurrence += 1;
  if (phrase.notes.at(-1)?.chordTone) bucket.cadenceHits += 1;
  if (phrase.plan.shape && questionHits(phrase.notes, phrase.plan.shape))
    bucket.questionHits += 1;
  if (phrase.plan.shape) bucket.shaped += 1;
  if (phrase.bars === 4) {
    bucket.twistPhrases += 1;
    if (barThreeTwists(phrase.notes)) bucket.twists += 1;
  }
}

function finishPlans(
  bucket: MetricBucket,
  plans: ReadonlyMap<string, ReadonlySet<string>>,
): MetricBucket {
  const sizes = [...plans.values()].map((set) => set.size);
  bucket.contexts = sizes.length;
  bucket.distinctPlansMean = sizes.length
    ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length
    : 0;
  bucket.distinctPlansMin = sizes.length ? Math.min(...sizes) : 0;
  return bucket;
}

const CORPUS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['A', 'harmonic-minor', 'E7'],
  ['C', 'minor-pentatonic', 'Cm'],
  ['C', 'minor-blues', 'C7'],
  ['Bb', 'mixolydian', 'Bb7'],
];
const SWEEP_ROOTS = ['C', 'D', 'E', 'F', 'G', 'A', 'Bb', 'Eb'] as const;
const SWEEP_SCALES = [
  'major',
  'dorian',
  'mixolydian',
  'minor',
  'minor-blues',
  'minor-pentatonic',
  'harmonic-minor',
] as const;
const FIFTH: Record<string, string> = {
  C: 'G',
  D: 'A',
  E: 'B',
  F: 'C',
  G: 'D',
  A: 'E',
  Bb: 'F',
  Eb: 'Bb',
};
const FOURTH: Record<string, string> = {
  C: 'F',
  D: 'G',
  E: 'A',
  F: 'Bb',
  G: 'C',
  A: 'D',
  Bb: 'Eb',
  Eb: 'Ab',
};

function sweepSymbols(root: string, scaleId: string): string[] {
  if (scaleId === 'major') return [root, FOURTH[root] ?? root];
  if (scaleId === 'mixolydian') return [`${root}7`, FOURTH[root] ?? root];
  if (scaleId === 'minor-blues')
    return [`${root}m7`, `${FIFTH[root] ?? root}7`];
  return [`${root}m`, `${FIFTH[root] ?? root}7`];
}

function measurePair(
  bucketA: MetricBucket,
  bucketB: MetricBucket,
  plansA: Map<string, Set<string>>,
  plansB: Map<string, Set<string>>,
  root: string,
  scaleId: string,
  symbol: string,
  bars: 2 | 4,
  seed: number,
  mainGenerate: typeof generatePhrase,
): void {
  const notes = scaleNotes(root, scaleId);
  const chordNotes = parseChord(symbol).notes;
  const input = { seed, bars, scaleNotes: notes, chordNotes };
  const armA = takePhrase(mainGenerate(input));
  const armB = takePhrase(generateShapedPhrase(input));
  foldPhrase(bucketA, armA, armA);
  foldPhrase(bucketB, armB, armA);
  const context = `${root}|${scaleId}|${symbol}|${bars}`;
  const setA = plansA.get(context) ?? new Set<string>();
  setA.add(planKey(armA));
  plansA.set(context, setA);
  const setB = plansB.get(context) ?? new Set<string>();
  setB.add(planKey(armB));
  plansB.set(context, setB);
}

function measureTrack2(mainGenerate: typeof generatePhrase): {
  corpus: { A: MetricBucket; B: MetricBucket };
  progressions: { A: MetricBucket; B: MetricBucket };
  armC: string;
} {
  const corpusA = emptyBucket();
  const corpusB = emptyBucket();
  const plansA = new Map<string, Set<string>>();
  const plansB = new Map<string, Set<string>>();
  for (const [root, scaleId, symbol] of CORPUS) {
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        measurePair(
          corpusA,
          corpusB,
          plansA,
          plansB,
          root,
          scaleId,
          symbol,
          bars,
          seed,
          mainGenerate,
        );
      }
    }
  }
  finishPlans(corpusA, plansA);
  finishPlans(corpusB, plansB);
  const progA = emptyBucket();
  const progB = emptyBucket();
  const progPlansA = new Map<string, Set<string>>();
  const progPlansB = new Map<string, Set<string>>();
  for (const root of SWEEP_ROOTS) {
    for (const scaleId of SWEEP_SCALES) {
      for (const symbol of sweepSymbols(root, scaleId)) {
        for (const bars of [2, 4] as const) {
          for (let seed = 1; seed <= 12; seed++) {
            measurePair(
              progA,
              progB,
              progPlansA,
              progPlansB,
              root,
              scaleId,
              symbol,
              bars,
              seed,
              mainGenerate,
            );
          }
        }
      }
    }
  }
  finishPlans(progA, progPlansA);
  finishPlans(progB, progPlansB);
  return {
    corpus: { A: corpusA, B: corpusB },
    progressions: { A: progA, B: progB },
    armC: 'not recorded. No live Jev distribution was available, so arm C was not measured.',
  };
}

function shuffleArms(seed: number, arms: readonly string[]): string[] {
  const random = mulberry32(seed);
  const copy = [...arms];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    const next = copy[swap];
    copy[swap] = copy[index] ?? copy[swap];
    copy[index] = next ?? copy[index];
  }
  return copy;
}

async function matchBlind(
  outDir: string,
  trial: TrackTrial,
  slots: readonly { file: string; samples: Float32Array }[],
): Promise<{
  gain: number;
  gap: number;
  sides: { file: string; lufs: number; peakDbfs: number }[];
}> {
  const rawPeak = Math.max(...slots.map((slot) => samplePeak(slot.samples)));
  if (rawPeak <= 0) throw new Error(`${trial.id} is silent`);
  const probeGain = 0.25 / rawPeak;
  const probed = slots.map((slot) => probeLoudness(slot.samples, probeGain));
  const average =
    probed.reduce((sum, side) => sum + side.lufs, 0) / probed.length;
  let makeupDb = LU_CENTER - average;
  const hotter = Math.max(...probed.map((side) => side.peakDbfs)) + makeupDb;
  if (hotter > PEAK_CEILING_DB) makeupDb -= hotter - PEAK_CEILING_DB;
  let gain = probeGain * dbToGain(makeupDb);
  const sampleCeiling = 10 ** (PEAK_CEILING_DB / 20);
  if (rawPeak * gain > sampleCeiling) gain = sampleCeiling / rawPeak;
  let published: { file: string; lufs: number; peakDbfs: number }[] = [];
  for (let pass = 0; pass < 4; pass += 1) {
    published = slots.map((slot) => {
      const wav = join(outDir, `${slot.file}.wav`);
      const mp3 = join(outDir, `${slot.file}.mp3`);
      writeWav(wav, slot.samples, gain);
      encodeMp3(wav, mp3);
      const loudness = measure(wav);
      return {
        file: slot.file,
        lufs: loudness.lufs,
        peakDbfs: loudness.peakDbfs,
      };
    });
    const peak = Math.max(...published.map((side) => side.peakDbfs));
    if (peak <= PEAK_CEILING_DB) break;
    gain *= dbToGain(PEAK_CEILING_DB - peak - 0.05);
  }
  for (const side of published) {
    if (side.peakDbfs > PEAK_CEILING_DB) {
      throw new Error(
        `${trial.id} true peak ${side.peakDbfs.toFixed(2)} dBTP is above ${PEAK_CEILING_DB}`,
      );
    }
  }
  const loud = published.map((side) => side.lufs);
  const gap = Math.max(...loud) - Math.min(...loud);
  return { gain, gap, sides: published };
}

async function renderTrack2(outDir: string): Promise<void> {
  const identity = requireCleanHead();
  mkdirSync(outDir, { recursive: true });
  const mainRules = await loadRulesAt(TRACK2_SHA);
  console.log('measuring corpus and progressions');
  const metrics = measureTrack2(mainRules.generatePhrase);
  writeFileSync(
    join(outDir, 'metrics.json'),
    `${JSON.stringify({ head: identity.head, tree: identity.tree, base: TRACK2_SHA, ...metrics }, null, 2)}\n`,
  );
  console.log(`wrote ${join(outDir, 'metrics.json')}`);
  const answer: {
    shuffleSeed: number;
    armC: string;
    base: string;
    head: string;
    trials: {
      id: string;
      seed: number;
      key: string;
      chord: string;
      tempo: number;
      bars: number;
      feel: string;
      identical: boolean;
      slots: Record<string, 'A' | 'B'>;
      files: string[];
      gain: number;
      loudnessGapLu: number;
      peaks: Record<string, number>;
    }[];
  } = {
    shuffleSeed: SHUFFLE_SEED,
    armC: 'unavailable. No real Jev distributions were recorded, so these are pairs, not triplets.',
    base: TRACK2_SHA,
    head: identity.head,
    trials: [],
  };
  const blind: string[] = [
    '# Blind phrase pairs',
    '',
    'Eight pairs. Slot 1 and slot 2 of each pair are the same seed, key, tempo, and four straight bars. Which slot is which arm is not in this file.',
    'Both slots of a pair share one gain. True peak stays at or under -1 dBTP.',
    `Seeds used: ${TRACK2_SEEDS.join(', ')}. Keys: A Dorian over Am, and C major over C. Tempos: 90 and 120 BPM.`,
    '',
  ];
  for (const [index, trial] of TRACK2_TRIALS.entries()) {
    const notes = scaleNotes(trial.root, trial.scaleId);
    const chordNotes = parseChord(trial.chord).notes;
    const input = {
      seed: trial.seed,
      bars: BARS,
      scaleNotes: notes,
      chordNotes,
    };
    const armA = asGenerated(mainRules.generatePhrase(input));
    const armB = asGenerated(generateShapedPhrase(input));
    const order = shuffleArms(SHUFFLE_SEED + index, ['A', 'B']) as (
      | 'A'
      | 'B'
    )[];
    const byArm = { A: armA, B: armB };
    const rendered = await Promise.all(
      order.map(async (arm, slot) => ({
        arm,
        file: `${trial.id}-slot-${slot + 1}`,
        samples: await render(
          byArm[arm].notes,
          trial.tempo,
          CLIP_STRAIGHT_SWING,
        ),
      })),
    );
    const matched = await matchBlind(
      outDir,
      trial,
      rendered.map((item) => ({ file: item.file, samples: item.samples })),
    );
    const slots: Record<string, 'A' | 'B'> = {};
    const peaks: Record<string, number> = {};
    rendered.forEach((item, slot) => {
      slots[String(slot + 1)] = item.arm;
      peaks[String(slot + 1)] = matched.sides[slot]?.peakDbfs ?? 0;
    });
    answer.trials.push({
      id: trial.id,
      seed: trial.seed,
      key: trial.scaleLabel,
      chord: trial.chord,
      tempo: trial.tempo,
      bars: BARS,
      feel: 'straight',
      identical: spellLine(armA.notes) === spellLine(armB.notes),
      slots,
      files: rendered.map((item) => `${item.file}.mp3`),
      gain: matched.gain,
      loudnessGapLu: matched.gap,
      peaks,
    });
    blind.push(
      `## ${trial.id}`,
      '',
      `${trial.scaleLabel} over ${trial.chord}, seed ${trial.seed}, ${trial.tempo} BPM, straight, ${BARS} bars.`,
      `Files: \`${trial.id}-slot-1.mp3\`, \`${trial.id}-slot-2.mp3\`.`,
      '',
    );
    console.log(
      `${trial.id} gap ${matched.gap.toFixed(2)} LU identical ${spellLine(armA.notes) === spellLine(armB.notes)}`,
    );
  }
  writeFileSync(
    join(outDir, 'answer-key.json'),
    `${JSON.stringify(answer, null, 2)}\n`,
  );
  writeFileSync(join(outDir, 'clips.md'), `${blind.join('\n')}\n`);
  console.log(`wrote blind clips and answer key in ${outDir}`);
}

const track2 = process.argv.includes('--track2');
const outDir = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
if (track2) {
  if (!outDir) {
    throw new Error(
      'Output folder is required: node --experimental-strip-types scripts/render-musicality-clips.ts --track2 <outDir>',
    );
  }
  await renderTrack2(outDir);
  process.exit(0);
}
if (!outDir) {
  throw new Error(
    'Output folder is required: node --experimental-strip-types scripts/render-musicality-clips.ts <outDir>',
  );
}
const identity = requireCleanHead();
mkdirSync(outDir, { recursive: true });
const mainRules = await loadMainRules();

const rows: string[] = [];
for (const pair of PAIRS) {
  const notes = scaleNotes(pair.root, pair.scaleId);
  const chordNotes = parseChord(pair.chord).notes;
  const input = {
    seed: pair.seed,
    bars: BARS,
    scaleNotes: notes,
    chordNotes,
  };
  const before = asGenerated(mainRules.generatePhrase(input));
  const after = asGenerated(generatePhrase(input));
  if (spellLine(before.notes) === spellLine(after.notes)) {
    throw new Error(`${pair.id} A and B are the same line`);
  }
  const beatsA = before.notes.map((note) => note.beat);
  const beatsB = after.notes.map((note) => note.beat);
  const durationsA = before.notes.map((note) => note.duration);
  const durationsB = after.notes.map((note) => note.duration);
  if (
    beatsA.join(',') !== beatsB.join(',') ||
    durationsA.join(',') !== durationsB.join(',')
  ) {
    throw new Error(`${pair.id} A and B onsets or durations differ`);
  }
  const planBeats = phraseOnsets(after.plan.rhythm, BARS);
  if (beatsB.join(',') !== planBeats.join(',')) {
    throw new Error(
      `${pair.id} leaves the ${after.plan.rhythm} grid: ${beatsB.join(',')}`,
    );
  }
  if (JSON.stringify(before.plan) !== JSON.stringify(after.plan)) {
    throw new Error(`${pair.id} plans differ`);
  }
  const rendered = {
    A: await render(before.notes, pair.tempo, pair.swing),
    B: await render(after.notes, pair.tempo, pair.swing),
  };
  for (const side of ['A', 'B'] as const) {
    const seconds = rendered[side].length / RATE;
    if (seconds < 8 || seconds > 16) {
      throw new Error(`${pair.id} ${side} is ${seconds.toFixed(2)}s`);
    }
  }
  const measured = await matchPair(outDir, pair, rendered);
  const gap = Math.abs(measured.A.lufs - measured.B.lufs);
  const swing = swingText(pair);
  const swap =
    pair.swappedFrom === null
      ? 'Seed kept from the previous render.'
      : `Swapped from seed ${pair.swappedFrom}, which now matches main.`;
  const block = [
    `## ${pair.id}`,
    '',
    pair.listen,
    '',
    `- Head: \`${identity.head}\``,
    `- Seed: ${pair.seed}. ${swap}`,
    `- Key/scale: ${pair.scaleLabel}`,
    `- Chords: ${pair.chord} for ${BARS} bars`,
    `- BPM: ${pair.tempo}`,
    `- Swing: ${swing}`,
    `- Sound: ${SOUND}`,
    `- Plan (same seed on A and B): ${before.plan.rhythm}, ${before.plan.contour}, ${before.plan.register}, cadence ${before.plan.cadence}`,
    `- Onsets: identical on A and B, and equal to the ${after.plan.rhythm} plan (${beatsB.join(', ')})`,
    `- Durations: identical on A and B`,
    `- Shared gain ${measured.A.gain.toFixed(4)}`,
    `- A ${measured.A.seconds.toFixed(2)}s, ${measured.A.lufs.toFixed(1)} LUFS, wav true peak ${measured.A.peakDbfs.toFixed(1)} dBTP`,
    `- B ${measured.B.seconds.toFixed(2)}s, ${measured.B.lufs.toFixed(1)} LUFS, wav true peak ${measured.B.peakDbfs.toFixed(1)} dBTP`,
    `- Integrated gap: ${gap.toFixed(2)} LU`,
    `- A notes: ${spellLine(before.notes)}`,
    `- B notes: ${spellLine(after.notes)}`,
    `- Files: \`${pair.stem}_A.mp3\`, \`${pair.stem}_B.mp3\`, plus matching wav`,
    '',
  ];
  rows.push(block.join('\n'));
  console.log(
    `${pair.id} gap ${gap.toFixed(2)} LU  A ${measured.A.lufs.toFixed(1)} LUFS peak ${measured.A.peakDbfs.toFixed(1)} dBFS  B ${measured.B.lufs.toFixed(1)} LUFS peak ${measured.B.peakDbfs.toFixed(1)} dBFS`,
  );
}

const clips = [
  '# Phrase musicality A/B clips',
  '',
  `Rendered from head \`${identity.head}\` (tree \`${identity.tree}\`).`,
  `A uses main's rules at \`${BASE_SHA}\`, loaded by this script with \`git show\` into a temp module. That copy is not in the repo.`,
  'B uses `lib/phrase.ts` at the head above.',
  'Both sides use the same render: `OfflineAudioContext` at 44100 Hz mono, `schedulePhrase` into `scheduleVoicing`. One fixed seed per pair. The generator has no other randomness.',
  'A and B of each pair share one gain. Integrated EBU R128 is measured on the source wav and aims at -16 LUFS. The gap stays within 0.5 LU. True peak is the wav true peak and stays at or under -1 dBTP. Onsets and durations match in every pair.',
  '',
  ...rows,
].join('\n');

writeFileSync(join(outDir, 'clips.md'), clips);
console.log(`wrote ${join(outDir, 'clips.md')} from ${identity.head}`);
