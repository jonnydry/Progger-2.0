/**
 * Main vs shaped phrases, played by PhrasePlayer.
 * Loop on restarts at the next bar line and leaves the cadence out.
 * Loop off plays one pass, including the closing note and its hold.
 * The live panel still calls generatePhrase. This script is the opt-in path.
 *
 * Run: node --experimental-strip-types scripts/render-shape-playback-clips.ts <outDir>
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell, type Note } from '../lib/music.ts';
import {
  PHRASE_END_RELEASE_SEC,
  PHRASE_LOOKAHEAD_SEC,
  PHRASE_START_LEAD_SEC,
  PHRASE_TICK_SEC,
  PhrasePlayer,
  phraseLoopBeats,
  phraseLoopSeconds,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import {
  generatePhrase,
  generateShapedPhrase,
  onsetSeconds,
  phrasePeriodBeats,
  type FingeredNote,
} from '../lib/phrase.ts';

const RATE = 44100;
const TEMPO = 120;
const BARS = 2 as const;
const SWING = 0;

const CONTEXTS: readonly {
  id: string;
  root: string;
  scaleId: string;
  chord: string;
}[] = [
  { id: 'ctx-major', root: 'C', scaleId: 'major', chord: 'C' },
  { id: 'ctx-minor', root: 'A', scaleId: 'minor', chord: 'Am' },
  { id: 'ctx-dorian', root: 'A', scaleId: 'dorian', chord: 'Am' },
];

class RenderClock implements PhraseClock {
  currentTime = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.currentTime;
  }

  after(delaySec: number, fn: () => void): number {
    if (!(delaySec > 1e-4)) {
      throw new Error(`wake did not move at ${this.currentTime}`);
    }
    const id = this.nextId++;
    this.timers.set(id, { at: this.currentTime + delaySec, fn });
    return id;
  }

  cancel(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  async advance(to: number): Promise<void> {
    let steps = 0;
    while (this.currentTime + 1e-9 < to) {
      this.currentTime = Math.min(to, this.currentTime + PHRASE_TICK_SEC);
      for (;;) {
        let due: { id: number; at: number; fn: () => void } | null = null;
        for (const [id, timer] of this.timers) {
          if (
            timer.at <= this.currentTime + 1e-9 &&
            (!due || timer.at < due.at)
          ) {
            due = { id, at: timer.at, fn: timer.fn };
          }
        }
        if (!due) break;
        this.timers.delete(due.id);
        due.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
      if (++steps > 40000) throw new Error('the render clock spun');
    }
  }
}

function scaleNotes(root: string, scaleId: string): Note[] {
  const scale = SCALES.find((item) => item.id === scaleId);
  if (!scale) throw new Error(`Missing scale ${scaleId}`);
  return spell(root, scale.formula);
}

function lineKey(notes: readonly FingeredNote[]): string {
  return notes.map((note) => `${note.midi}@${note.beat}`).join(',');
}

function pickSeed(
  root: string,
  scaleId: string,
  chordSymbol: string,
): {
  seed: number;
  main: FingeredNote[];
  shaped: FingeredNote[];
  shapeKept: boolean;
} {
  const notes = scaleNotes(root, scaleId);
  const chordNotes = parseChord(chordSymbol).notes;
  let fallback: {
    seed: number;
    main: FingeredNote[];
    shaped: FingeredNote[];
    shapeKept: boolean;
  } | null = null;
  for (let seed = 1; seed <= 64; seed++) {
    const main = generatePhrase({
      seed,
      bars: BARS,
      scaleNotes: notes,
      chordNotes,
    });
    const shaped = generateShapedPhrase({
      seed,
      bars: BARS,
      scaleNotes: notes,
      chordNotes,
    });
    if (!main.ok || !shaped.ok) continue;
    const pair = {
      seed,
      main: main.phrase.notes,
      shaped: shaped.phrase.notes,
      shapeKept: Boolean(shaped.phrase.plan.shape),
    };
    if (!fallback) fallback = pair;
    const shapedFirst = pair.shaped[0]?.midi;
    const shapedLast = pair.shaped.at(-1)?.midi;
    const mainFirst = pair.main[0]?.midi;
    const mainLast = pair.main.at(-1)?.midi;
    if (
      pair.shapeKept &&
      lineKey(pair.main) !== lineKey(pair.shaped) &&
      shapedFirst !== undefined &&
      mainFirst !== undefined &&
      shapedFirst !== shapedLast &&
      mainFirst !== mainLast
    ) {
      return pair;
    }
  }
  if (!fallback)
    throw new Error(`No phrase for ${root} ${scaleId} ${chordSymbol}`);
  return fallback;
}

function samplePeak(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function writeWav(path: string, samples: Float32Array): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
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

type Onset = { when: number; frequency: number };

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function spyOnsets(context: OfflineAudioContext): Onset[] {
  const onsets: Onset[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      onsets.push({ when, frequency: oscillator.frequency.value });
      return start(when);
    };
    return oscillator;
  };
  return onsets;
}

async function renderPhrase(
  notes: readonly FingeredNote[],
  loop: boolean,
): Promise<{ samples: Float32Array; onsets: Onset[] }> {
  const loopSec = phraseLoopSeconds(notes, TEMPO);
  const holdSec = onsetSeconds(phrasePeriodBeats(BARS), TEMPO, SWING);
  // A loop has no tail. The next onset after two passes is the third
  // downbeat, so the buffer stops one sample before that attack.
  const seconds = loop
    ? PHRASE_START_LEAD_SEC + loopSec * 2 - 1 / RATE
    : PHRASE_START_LEAD_SEC + holdSec + PHRASE_END_RELEASE_SEC + 0.2;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  context.resume = () => Promise.resolve();
  const onsets = spyOnsets(context);
  const clock = new RenderClock();
  const player = new PhrasePlayer(() => {});
  // Looping looks ahead by a whole period, so running the clock to the
  // end of pass 2 would already queue pass 3. Stop once pass 2's last
  // note is inside that horizon and pass 3 is still outside it.
  let clockStop = seconds;
  if (loop) {
    const lead = PHRASE_START_LEAD_SEC;
    const pass3 = lead + loopSec * 2;
    const latest = notes.reduce(
      (max, note) =>
        note.beat < phraseLoopBeats(notes) ? Math.max(max, note.beat) : max,
      0,
    );
    const latestAt = lead + loopSec + onsetSeconds(latest, TEMPO, SWING);
    const need = latestAt - PHRASE_LOOKAHEAD_SEC - loopSec;
    const tooFar = pass3 - PHRASE_LOOKAHEAD_SEC - loopSec;
    if (!(need + 1e-3 < tooFar)) {
      throw new Error('the loop lookahead reaches a third downbeat too early');
    }
    clockStop = need + (tooFar - need) / 2;
  }
  // The scheduler drops voices whose bookkeeping has ended. Rendering
  // happens after the clock has run, so those disconnects would erase the
  // first pass. Leave the nodes in the graph until startRendering.
  let proto = Object.getPrototypeOf(context.destination) as {
    disconnect?: () => void;
  };
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'disconnect')) {
    proto = Object.getPrototypeOf(proto);
  }
  if (!proto?.disconnect) throw new Error('AudioNode.disconnect is missing');
  const disconnect = proto.disconnect;
  proto.disconnect = function () {
    return this;
  };
  try {
    await player.start({
      notes,
      bars: BARS,
      tempo: TEMPO,
      swing: SWING,
      loop,
      context,
      destination: context.destination,
      clock,
    });
    await clock.advance(clockStop);
  } finally {
    proto.disconnect = disconnect;
  }
  const rendered = await context.startRendering();
  return { samples: rendered.getChannelData(0).slice(), onsets };
}

function onsetAt(
  onsets: readonly Onset[],
  when: number,
  midi: number,
): boolean {
  return onsets.some(
    (item) =>
      Math.abs(item.when - when) < 1e-6 &&
      Math.abs(item.frequency - midiHz(midi)) < 1e-2,
  );
}

function sameSamples(left: Float32Array, right: Float32Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

const outDir = process.argv[2];
if (!outDir) {
  throw new Error(
    'Output folder is required: node --experimental-strip-types scripts/render-shape-playback-clips.ts <outDir>',
  );
}
mkdirSync(outDir, { recursive: true });

const manifest: {
  tempo: number;
  bars: number;
  swing: number;
  clips: {
    file: string;
    context: string;
    loop: boolean;
    arm: 'main' | 'shaped';
    seed: number;
    shapeKept: boolean;
    seconds: number;
    peak: number;
  }[];
} = { tempo: TEMPO, bars: BARS, swing: SWING, clips: [] };

for (const context of CONTEXTS) {
  const picked = pickSeed(context.root, context.scaleId, context.chord);
  if (!picked.shapeKept) {
    throw new Error(`${context.id} kept no shape in seeds 1–64`);
  }
  for (const loop of [true, false]) {
    const mainRendered = await renderPhrase(picked.main, loop);
    const shapedRendered = await renderPhrase(picked.shaped, loop);
    const mainSamples = mainRendered.samples;
    const shapedSamples = shapedRendered.samples;
    const loopName = loop ? 'loop-on' : 'loop-off';
    const sides = [
      ['main', mainSamples],
      ['shaped', shapedSamples],
    ] as const;
    if (sameSamples(mainSamples, shapedSamples)) {
      throw new Error(
        `${context.id} ${loopName} main and shaped are the same audio`,
      );
    }
    for (const [arm, samples] of sides) {
      const peak = samplePeak(samples);
      if (!(peak > 0.01)) {
        throw new Error(`${context.id} ${loopName} ${arm} is silent`);
      }
      let firstAudible = samples.length;
      for (let index = 0; index < samples.length; index += 1) {
        if (Math.abs(samples[index] ?? 0) > 0.01) {
          firstAudible = index;
          break;
        }
      }
      if (firstAudible / RATE > 0.2) {
        throw new Error(
          `${context.id} ${loopName} ${arm} stays silent until ${(firstAudible / RATE).toFixed(3)}s`,
        );
      }
      const source = arm === 'main' ? picked.main : picked.shaped;
      const firstMidi = source[0]?.midi;
      const lastMidi = source.at(-1)?.midi;
      const played =
        arm === 'main' ? mainRendered.onsets : shapedRendered.onsets;
      if (firstMidi === undefined || lastMidi === undefined) {
        throw new Error(`${context.id} has no notes`);
      }
      const loopSec = phraseLoopSeconds(source, TEMPO);
      const pass2 = PHRASE_START_LEAD_SEC + loopSec;
      const pass3 = PHRASE_START_LEAD_SEC + loopSec * 2;
      if (loop) {
        if (!onsetAt(played, PHRASE_START_LEAD_SEC, firstMidi)) {
          throw new Error(`${context.id} ${arm} loop missed beat 1`);
        }
        if (!onsetAt(played, pass2, firstMidi)) {
          throw new Error(
            `${context.id} ${arm} loop did not restart on beat 1`,
          );
        }
        if (onsetAt(played, pass2, lastMidi)) {
          throw new Error(`${context.id} ${arm} loop struck the cadence`);
        }
        if (played.some((item) => item.when >= pass3 - 1e-4)) {
          throw new Error(
            `${context.id} ${arm} loop includes a third downbeat`,
          );
        }
      } else if (
        !onsetAt(played, pass2, lastMidi) ||
        onsetAt(played, pass3, firstMidi) ||
        played.some((item) => item.when > pass2 + 1e-4)
      ) {
        throw new Error(
          `${context.id} ${arm} loop-off missed the closing note or started another pass`,
        );
      }
      const stem = `${context.id}_${loopName}_${arm}`;
      const wav = join(outDir, `${stem}.wav`);
      const mp3 = join(outDir, `${stem}.mp3`);
      writeWav(wav, samples);
      encodeMp3(wav, mp3);
      manifest.clips.push({
        file: `${stem}.mp3`,
        context: context.id,
        loop,
        arm,
        seed: picked.seed,
        shapeKept: picked.shapeKept,
        seconds: samples.length / RATE,
        peak,
      });
      console.log(
        `${stem} seed ${picked.seed} peak ${peak.toFixed(3)} ${samples.length / RATE}s`,
      );
    }
  }
}

writeFileSync(
  join(outDir, 'shape-playback-clips.json'),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`wrote ${manifest.clips.length} clips to ${outDir}`);
