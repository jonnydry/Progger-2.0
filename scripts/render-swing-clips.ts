/**
 * Short A/B phrases for the swing slider.
 * Same seed at 90 and 160 BPM: legacy on/off swing, 60%, and 100%.
 * Run: node --experimental-strip-types scripts/render-swing-clips.ts [outDir]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import { schedulePhrase } from '../lib/phrase-audio.ts';
import {
  generatePhrase,
  onsetSeconds,
  swingRatioForAmount,
  SWING_AMOUNT_MAX,
  SWING_RATIO_LEGACY,
  type SwingInput,
} from '../lib/phrase.ts';

/** Partial-swing example. The session default is straight, not this amount. */
const SWING_CLIP_MID = 0.6;
const RATE = 44100;
const SEED = 2;
const TAIL_SEC = 2.7;
const PEAK = 0.7;

const scale = SCALES.find((item) => item.id === 'major');
if (!scale) throw new Error('C major is missing.');
const phrase = generatePhrase({
  seed: SEED,
  bars: 2,
  scaleNotes: spell('C', scale.formula),
  chordNotes: parseChord('C').notes,
});
if (!phrase.ok) throw new Error(phrase.reason);
const line = phrase.phrase;

function writeWav(path: string, samples: Float32Array): void {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? PEAK / peak : 1;
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

async function render(tempo: number, swing: SwingInput): Promise<Float32Array> {
  const last = line.notes.at(-1)?.beat ?? 8;
  const seconds = onsetSeconds(last, tempo, swing) + TAIL_SEC;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(context, context.destination, line.notes, tempo, swing, 0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

const outDir = process.argv[2] ?? '/opt/cursor/artifacts/swing-listen';
mkdirSync(outDir, { recursive: true });

const clips: {
  file: string;
  tempo: number;
  swing: SwingInput;
  label: string;
  ratio: number;
}[] = [];

for (const tempo of [90, 160]) {
  const full = swingRatioForAmount(tempo, SWING_AMOUNT_MAX);
  const mid = swingRatioForAmount(tempo, SWING_CLIP_MID);
  const set: {
    file: string;
    swing: SwingInput;
    label: string;
    ratio: number;
  }[] = [
    {
      file: `swing-${tempo}-legacy.wav`,
      swing: 'swing',
      label: 'old swing on (2:1)',
      ratio: SWING_RATIO_LEGACY,
    },
    {
      file: `swing-${tempo}-60.wav`,
      swing: SWING_CLIP_MID,
      label: '60%',
      ratio: mid,
    },
    {
      file: `swing-${tempo}-100.wav`,
      swing: SWING_AMOUNT_MAX,
      label: 'new 100%',
      ratio: full,
    },
  ];
  for (const clip of set) {
    const samples = await render(tempo, clip.swing);
    writeWav(`${outDir}/${clip.file}`, samples);
    clips.push({ ...clip, tempo });
    console.log(`${clip.file} ${samples.length / RATE}s ratio ${clip.ratio}`);
  }
}

writeFileSync(
  `${outDir}/clips.json`,
  JSON.stringify(
    {
      seed: SEED,
      bars: 2,
      scale: 'C major',
      chord: 'C',
      peak: PEAK,
      notes: line.notes.map((note) => ({
        beat: note.beat,
        name: note.name,
      })),
      clips,
    },
    null,
    2,
  ),
);
