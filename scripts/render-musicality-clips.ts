/**
 * A/B phrases for the musicality rules.
 * Both sides render from this commit, through schedulePhrase.
 * A is main's phrase.ts, loaded from git into a temp file. That copy is not shipped.
 * B is lib/phrase.ts at HEAD.
 * Run: node --experimental-strip-types scripts/render-musicality-clips.ts <outDir>
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import { schedulePhrase } from '../lib/phrase-audio.ts';
import {
  generatePhrase,
  onsetSeconds,
  swingRatioForAmount,
  type RhythmId,
  type SwingInput,
} from '../lib/phrase.ts';

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

async function loadMainRules(): Promise<{
  generatePhrase: typeof generatePhrase;
}> {
  const source = git(['show', `${BASE_SHA}:lib/phrase.ts`]);
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

const outDir = process.argv[2];
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
  if (beatsB.some((beat) => Math.abs(beat * 2 - Math.round(beat * 2)) > 1e-6)) {
    throw new Error(`${pair.id} leaves the eighth grid: ${beatsB.join(',')}`);
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
