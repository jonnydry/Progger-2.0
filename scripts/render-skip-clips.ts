/**
 * Old-vs-new listen pack for string-skip atoms.
 *
 * A is main af93416 (groupings, no skip atoms). B is this checkout.
 * Same seeds, 96 BPM, straight feel, OfflineAudioContext. Nothing here
 * uploads audio. Pass an output folder and the wavs land there.
 *
 *   node --experimental-strip-types scripts/render-skip-clips.ts /tmp/skip-listen
 *
 * Playback is `schedulePhrase` into an offline context at 44100 Hz mono.
 * Feel is straight (swing amount 0). Tempo is PHRASE_TEMPO_DEFAULT, 96.
 */
import { execFileSync } from 'node:child_process';
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
  type FingeredNote,
} from '../lib/phrase.ts';

const BASE = 'af93416';
const TEMPO = 96;
const SWING = 0;
const RATE = 44100;
const TAIL_SEC = 2.7;

/** Seeds that play at least one pinned eighth leap on this head. */
const PAIRS = [
  { seed: 1004, bars: 4 as const, root: 'C', scale: 'major', chord: 'C' },
  { seed: 1055, bars: 4 as const, root: 'A', scale: 'dorian', chord: 'Am' },
  { seed: 1211, bars: 4 as const, root: 'E', scale: 'minor', chord: 'Em' },
  {
    seed: 1315,
    bars: 2 as const,
    root: 'Bb',
    scale: 'mixolydian',
    chord: 'Bb7',
  },
  {
    seed: 1361,
    bars: 2 as const,
    root: 'A',
    scale: 'minor-pentatonic',
    chord: 'Am7',
  },
];

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8' });
}

async function loadBaseline(): Promise<{
  generatePhrase: typeof generatePhrase;
}> {
  const source = git(['show', `${BASE}:lib/phrase.ts`]);
  const music = pathToFileURL(join(process.cwd(), 'lib/music.ts')).href;
  const marks = pathToFileURL(join(process.cwd(), 'lib/phrase-marks.ts')).href;
  const rewritten = source
    .replaceAll("from './music.ts'", `from '${music}'`)
    .replaceAll("from './phrase-marks.ts'", `from '${marks}'`);
  const dir = mkdtempSync(join(tmpdir(), 'skip-listen-a-'));
  const file = join(dir, 'phrase.ts');
  writeFileSync(file, rewritten);
  const loaded = (await import(pathToFileURL(file).href)) as {
    generatePhrase: typeof generatePhrase;
  };
  rmSync(dir, { recursive: true, force: true });
  return loaded;
}

function scaleNotes(root: string, scaleId: string): Note[] {
  const scale = SCALES.find((item) => item.id === scaleId);
  if (!scale) throw new Error(`Missing scale ${scaleId}`);
  return spell(root, scale.formula);
}

function writeWav(path: string, samples: Float32Array): void {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0.89 ? 0.89 / peak : 1;
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index++) {
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
}

async function render(notes: readonly FingeredNote[]): Promise<Float32Array> {
  const last = notes.at(-1)?.beat ?? 8;
  const seconds = onsetSeconds(last, TEMPO, SWING) + TAIL_SEC;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(context, context.destination, notes, TEMPO, SWING, 0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

const outDir = process.argv[2];
if (!outDir) {
  throw new Error(
    'Output folder is required: node --experimental-strip-types scripts/render-skip-clips.ts <outDir>',
  );
}
mkdirSync(outDir, { recursive: true });
const baseline = await loadBaseline();
const lines: string[] = [
  `# Skip listen pack`,
  ``,
  `A = ${BASE} (groupings, no skip atoms). B = ${git(['rev-parse', '--short', 'HEAD']).trim()}.`,
  `96 BPM, straight feel, OfflineAudioContext 44100 Hz mono.`,
  `These files were rendered on this machine. They are not in the repo.`,
  ``,
];
for (const pair of PAIRS) {
  const input = {
    seed: pair.seed,
    bars: pair.bars,
    scaleNotes: scaleNotes(pair.root, pair.scale),
    chordNotes: parseChord(pair.chord).notes,
  };
  const left = baseline.generatePhrase(input);
  const right = generatePhrase(input);
  if (!left.ok || !right.ok) throw new Error(`${pair.seed} did not generate`);
  const stem = `${pair.seed}-${pair.root}-${pair.scale}-${pair.bars}`;
  writeWav(join(outDir, `${stem}-A.wav`), await render(left.phrase.notes));
  writeWav(join(outDir, `${stem}-B.wav`), await render(right.phrase.notes));
  const leaps = right.phrase.notes.filter((note, index) => {
    const prev = right.phrase.notes[index - 1];
    return (
      !!prev &&
      note.duration <= 0.5 &&
      Math.abs(note.midi - prev.midi) > 5 &&
      Math.abs(note.string - prev.string) === 2
    );
  }).length;
  lines.push(
    `- ${stem}: B has ${leaps} pinned eighth leap${leaps === 1 ? '' : 's'}.`,
  );
}
writeFileSync(join(outDir, 'clips.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
