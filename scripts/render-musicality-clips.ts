/**
 * A/B phrases for the musicality rules.
 * Both sides render from this commit, through schedulePhrase.
 * A is main's phrase.ts, loaded from git into a temp file. That copy is not shipped.
 * B is lib/phrase.ts at HEAD.
 * Run: node --experimental-strip-types scripts/render-musicality-clips.ts [outDir]
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
  SWING_AMOUNT_DEFAULT,
  type SwingInput,
} from '../lib/phrase.ts';

const RATE = 44100;
const TAIL_SEC = 2.7;
const BARS = 4 as const;
const BASE_SHA = '00a5de376e061a16d6ae8a09076ea2e807cd31b3';
const SOUND =
  'plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)';
const LU_LIMIT = 0.5;
const LU_TARGET = 0.25;

type Side = 'A' | 'B';

type ClipNote = {
  name: string;
  midi: number;
  beat: number;
  string: number;
  fret: number;
};

type Generated = {
  notes: ClipNote[];
  plan: {
    contour: string;
    rhythm: string;
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
};

const PAIRS: readonly Pair[] = [
  {
    id: 'pair1',
    stem: 'pair1_A-dorian_90bpm_straight',
    seed: 7,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 90,
    swing: 'straight',
    swingLabel: 'straight (amount 0, ratio 1)',
    listen:
      'A sits on E and F# for the whole phrase. B arches up through the octave and comes back down to E.',
  },
  {
    id: 'pair2',
    stem: 'pair2_C-major_120bpm_straight',
    seed: 1,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 120,
    swing: 'straight',
    swingLabel: 'straight (amount 0, ratio 1)',
    listen:
      'A repeats G and A. B starts on C5 and falls, mostly by step, to the fifth G.',
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
    swing: 'straight',
    swingLabel: 'straight (amount 0, ratio 1)',
    listen:
      'A pokes out and steps back (C–G–A, then E–B–C, then C–F#–E). B falls away from that C5 and steps most of the way home to E.',
  },
  {
    id: 'pair4',
    stem: 'pair4_A-dorian_90bpm_swing',
    seed: 8,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 90,
    swing: SWING_AMOUNT_DEFAULT,
    swingLabel: '',
    listen:
      'Both lines have offbeat eighths, so the 60% swing is in A and in B. A leaps a fifth up (E to B) and a fifth down into the cadence (A to D). B steps between those chord tones and walks down to E.',
  },
  {
    id: 'pair5',
    stem: 'pair5_A-dorian_120bpm_swing',
    seed: 24,
    root: 'A',
    scaleId: 'dorian',
    scaleLabel: 'A Dorian',
    chord: 'Am',
    tempo: 120,
    swing: SWING_AMOUNT_DEFAULT,
    swingLabel: '',
    listen:
      'Pushed eighths, swung the same way on both sides. A drops a fifth from E to A, then wobbles A–B–A. B walks E–D–C–B–A into the root.',
  },
  {
    id: 'pair6',
    stem: 'pair6_C-major_120bpm_swing',
    seed: 8,
    root: 'C',
    scaleId: 'major',
    scaleLabel: 'C major',
    chord: 'C',
    tempo: 120,
    swing: SWING_AMOUNT_DEFAULT,
    swingLabel: '',
    listen:
      'Long–short rhythm, 60% swing on both. A leaps a fifth (G up to D, C down to F). B keeps the fourth G up to C and walks the ending B–A–G.',
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
  const loudness = measure(mp3);
  return {
    ...loudness,
    samplePeak: sample,
    seconds: samples.length / RATE,
    gain,
  };
}

async function matchPair(
  outDir: string,
  pair: Pair,
  rendered: Record<Side, Float32Array>,
): Promise<Record<Side, MeasuredSide>> {
  let gainA = 1;
  let gainB = 1;
  let published: Record<Side, MeasuredSide> | null = null;
  for (let pass = 0; pass < 8; pass += 1) {
    const hottest = Math.max(
      samplePeak(rendered.A) * gainA,
      samplePeak(rendered.B) * gainB,
    );
    if (hottest > 0.98) {
      const scale = 0.98 / hottest;
      gainA *= scale;
      gainB *= scale;
    }
    published = {
      A: publish(outDir, pair.stem, 'A', rendered.A, gainA),
      B: publish(outDir, pair.stem, 'B', rendered.B, gainB),
    };
    const diff = published.A.lufs - published.B.lufs;
    if (Math.abs(diff) <= LU_TARGET) return published;
    if (diff > 0) gainA *= dbToGain(-diff);
    else gainB *= dbToGain(diff);
  }
  if (!published) throw new Error(`${pair.id} produced no audio`);
  const diff = published.A.lufs - published.B.lufs;
  if (Math.abs(diff) > LU_LIMIT) {
    throw new Error(
      `${pair.id} loudness gap ${diff.toFixed(2)} LU is outside ${LU_LIMIT} LU`,
    );
  }
  return published;
}

function swingText(pair: Pair): string {
  if (pair.swing === 'straight') return pair.swingLabel;
  const ratio = swingRatioForAmount(pair.tempo, SWING_AMOUNT_DEFAULT);
  return `swing amount ${SWING_AMOUNT_DEFAULT} (app default), ratio ${ratio.toFixed(4)} at ${pair.tempo} BPM`;
}

const outDir = process.argv[2] ?? '/opt/cursor/artifacts';
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
  const block = [
    `## ${pair.id}`,
    '',
    pair.listen,
    '',
    `- Head: \`${identity.head}\``,
    `- Seed: ${pair.seed}`,
    `- Key/scale: ${pair.scaleLabel}`,
    `- Chords: ${pair.chord} for ${BARS} bars`,
    `- BPM: ${pair.tempo}`,
    `- Swing: ${swing}`,
    `- Sound: ${SOUND}`,
    `- Plan (same seed on A and B): ${before.plan.rhythm}, ${before.plan.contour}, ${before.plan.register}, cadence ${before.plan.cadence}`,
    `- A gain ${measured.A.gain.toFixed(4)}, ${measured.A.seconds.toFixed(2)}s, ${measured.A.lufs.toFixed(1)} LUFS, true peak ${measured.A.peakDbfs.toFixed(1)} dBFS, sample peak ${measured.A.samplePeak.toFixed(3)}`,
    `- B gain ${measured.B.gain.toFixed(4)}, ${measured.B.seconds.toFixed(2)}s, ${measured.B.lufs.toFixed(1)} LUFS, true peak ${measured.B.peakDbfs.toFixed(1)} dBFS, sample peak ${measured.B.samplePeak.toFixed(3)}`,
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
  'Loudness is integrated EBU R128 on the mp3. A and B of each pair are within 0.5 LU. Peak is the mp3 true peak, plus the wav sample peak.',
  '',
  ...rows,
].join('\n');

writeFileSync(join(outDir, 'clips.md'), clips);
console.log(`wrote ${join(outDir, 'clips.md')} from ${identity.head}`);
