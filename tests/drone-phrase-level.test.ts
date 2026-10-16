import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AudioWorkletNode, OfflineAudioContext } from 'node-web-audio-api';

globalThis.AudioWorkletNode = AudioWorkletNode;

import { OUTPUT_KNEE, createOutputChain } from '../lib/audio-output.ts';
import {
  prepareCelloBuffer,
  soundLinearCap,
  startLiveVoice,
} from '../lib/drone-audio.ts';
import {
  CELLO_SAMPLES,
  dronePitches,
  midiHz,
  type DroneOctave,
  type DroneSoundId,
} from '../lib/drone.ts';
import { SCALES, spell } from '../lib/music.ts';
import { schedulePhrase } from '../lib/phrase-audio.ts';
import {
  defaultChordNotes,
  generatePhrase,
  type FingeredNote,
} from '../lib/phrase.ts';
import { scheduleVoicing } from '../lib/voicing-audio.ts';

const RATE = 48000;
const TEMPO = 96;
const TRUE_PEAK_DBTP = -1;
const TRUE_PEAK_LINEAR = 10 ** (TRUE_PEAK_DBTP / 20);
/**
 * Loudest real chord input in the #14 headroom pass. Every sound summed
 * with this dyad stayed at or below it. The phrase now shares that bus
 * without ducking, so the sum is measured again.
 */
const E5_DYAD_CEILING = 0.7774;
const E5_DYAD = [0, 2, null, null, null, null] as const;

function db(value: number): number {
  return 20 * Math.log10(Math.max(value, 1e-12));
}

/** 4× Catmull-Rom peak. A crest between samples still counts. */
function truePeak(data: Float32Array): number {
  const at = (index: number) =>
    data[Math.max(0, Math.min(data.length - 1, index))] ?? 0;
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) {
    const y0 = at(index - 1);
    const y1 = at(index);
    const y2 = at(index + 1);
    const y3 = at(index + 2);
    peak = Math.max(peak, Math.abs(y1));
    for (const fraction of [0.25, 0.5, 0.75]) {
      const t2 = fraction * fraction;
      const t3 = t2 * fraction;
      const value =
        0.5 *
        (2 * y1 +
          (-y0 + y2) * fraction +
          (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 +
          (-y0 + 3 * y1 - 3 * y2 + y3) * t3);
      peak = Math.max(peak, Math.abs(value));
    }
  }
  return peak;
}

function toneAmplitude(
  data: Float32Array,
  frequency: number,
  from: number,
  until: number,
): number {
  const start = Math.max(0, Math.floor(from * RATE));
  const end = Math.min(data.length, Math.floor(until * RATE));
  let real = 0;
  let imag = 0;
  for (let index = start; index < end; index += 1) {
    const sample = data[index] ?? 0;
    const angle = (2 * Math.PI * frequency * index) / RATE;
    real += sample * Math.cos(angle);
    imag -= sample * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imag)) / Math.max(1, end - start);
}

function partialLevel(
  data: Float32Array,
  frequencies: readonly number[],
  from: number,
  until: number,
): number {
  let power = 0;
  for (const frequency of frequencies) {
    const amplitude = toneAmplitude(data, frequency, from, until);
    power += (amplitude * amplitude) / 2;
  }
  return Math.sqrt(power);
}

function samplePeak(data: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < data.length; index += 1) {
    peak = Math.max(peak, Math.abs(data[index] ?? 0));
  }
  return peak;
}

function phraseNotes(): FingeredNote[] {
  const scale = SCALES.find((item) => item.id === 'dorian');
  if (!scale) throw new Error('A dorian is missing.');
  const scaleNotes = spell('A', scale.formula);
  const result = generatePhrase({
    seed: 4,
    bars: 4,
    scaleNotes,
    chordNotes: defaultChordNotes(scaleNotes),
    locks: { register: 'high', rhythm: 'eighths', contour: 'arch' },
  });
  if (!result.ok) throw new Error(result.reason);
  return result.phrase.notes;
}

const NOTES = phraseNotes();
const LAST_BEAT = NOTES[NOTES.length - 1]?.beat ?? 0;

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) * 0x1000000 +
      ((data[offset + 1] ?? 0) << 16) +
      ((data[offset + 2] ?? 0) << 8) +
      (data[offset + 3] ?? 0)) >>>
    0
  );
}

function writeU32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

function atomType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset + 4] ?? 0,
    data[offset + 5] ?? 0,
    data[offset + 6] ?? 0,
    data[offset + 7] ?? 0,
  );
}

function mp4Atoms(
  data: Uint8Array,
): { type: string; start: number; size: number; header: number }[] {
  const atoms: { type: string; start: number; size: number; header: number }[] =
    [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    const size = readU32(data, offset);
    if (size < 8 || offset + size > data.length) break;
    atoms.push({
      type: atomType(data, offset),
      start: offset,
      size,
      header: 8,
    });
    offset += size;
  }
  return atoms;
}

/** The committed loops store `moov` after `mdat`. Decode needs it first. */
function fastStartM4a(bytes: Uint8Array): ArrayBuffer {
  const atoms = mp4Atoms(bytes);
  const moov = atoms.find((atom) => atom.type === 'moov');
  const mdat = atoms.find((atom) => atom.type === 'mdat');
  if (!moov || !mdat) throw new Error('cello sample is not an MPEG-4 file');
  if (moov.start < mdat.start) {
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
  }
  const moovBytes = bytes.slice(moov.start, moov.start + moov.size);
  const prefix = bytes.slice(0, mdat.start);
  const rest = atoms
    .filter((atom) => atom.start >= mdat.start && atom.type !== 'moov')
    .map((atom) => bytes.slice(atom.start, atom.start + atom.size));
  const delta = prefix.length + moovBytes.length - mdat.start;
  const visit = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = readU32(moovBytes, offset);
      if (size < 8 || offset + size > end) return;
      const type = atomType(moovBytes, offset);
      const boxEnd = offset + size;
      if (
        type === 'trak' ||
        type === 'mdia' ||
        type === 'minf' ||
        type === 'stbl'
      ) {
        visit(offset + 8, boxEnd);
      } else if (type === 'stco') {
        const count = readU32(moovBytes, offset + 12);
        for (let index = 0; index < count; index += 1) {
          const at = offset + 16 + index * 4;
          writeU32(moovBytes, at, readU32(moovBytes, at) + delta);
        }
      }
      offset = boxEnd;
    }
  };
  visit(8, moovBytes.length);
  const total =
    prefix.length +
    moovBytes.length +
    rest.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  out.set(prefix, cursor);
  cursor += prefix.length;
  out.set(moovBytes, cursor);
  cursor += moovBytes.length;
  for (const part of rest) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out.buffer;
}

async function celloBuffers(): Promise<Map<string, AudioBuffer>> {
  const context = new OfflineAudioContext(1, RATE, RATE);
  const buffers = new Map<string, AudioBuffer>();
  for (const sample of CELLO_SAMPLES) {
    const bytes = readFileSync(
      new URL(`../public/audio/drone/${sample.file}`, import.meta.url),
    );
    const decoded = await context.decodeAudioData(fastStartM4a(bytes));
    buffers.set(sample.file, prepareCelloBuffer(context, decoded));
  }
  return buffers;
}

async function renderMix(options: {
  sound: DroneSoundId;
  octave: DroneOctave;
  seconds: number;
  phraseAt: number | null;
  dyadAt: number | null;
  buffers: Map<string, AudioBuffer> | null;
  attack: number;
  notes?: readonly FingeredNote[];
}): Promise<Float32Array> {
  const context = new OfflineAudioContext(
    1,
    Math.ceil(RATE * options.seconds),
    RATE,
  );
  const chain = createOutputChain(context);
  await chain.installDuck();
  chain.setDrone(true, 0, 0);
  const master = context.createGain();
  master.gain.value = 1;
  master.connect(chain.droneInput);
  startLiveVoice(
    context,
    master,
    dronePitches('A', 'dorian', options.octave),
    0.05,
    options.attack,
    options.sound,
    options.sound === 'cello' ? options.buffers : null,
    soundLinearCap(options.sound),
  );
  if (options.phraseAt !== null) {
    schedulePhrase(
      context,
      chain.phraseInput,
      options.notes ?? NOTES,
      TEMPO,
      'straight',
      options.phraseAt,
    );
  }
  if (options.dyadAt !== null) {
    scheduleVoicing(context, E5_DYAD, options.dyadAt, chain.chordInput);
  }
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

void test('the oversampled peak reads a sine that crests between samples', () => {
  const frequency = 8000;
  const amplitude = 0.5;
  const phase = 0.2;
  const data = new Float32Array(RATE);
  for (let index = 0; index < data.length; index += 1) {
    data[index] =
      amplitude * Math.sin((2 * Math.PI * frequency * index) / RATE + phase);
  }
  let samples = 0;
  for (const value of data) samples = Math.max(samples, Math.abs(value));
  const peak = truePeak(data);
  assert.ok(
    samples < amplitude - 1e-4,
    `sample peak ${samples} already reached the sine`,
  );
  assert.ok(
    Math.abs(db(peak) - db(amplitude)) < 0.2,
    `true peak ${db(peak).toFixed(3)} dBTP, sine is ${db(amplitude).toFixed(3)}`,
  );
});

void test('a phrase leaves the default drone level steady and under the ceiling', async () => {
  const pitches = dronePitches('A', 'dorian', 'low').map((pitch) =>
    midiHz(pitch.midi),
  );
  const phraseAt = 1.2;
  const seconds = 4.6;
  const from = 1.85;
  const until = 4.2;
  const alone = await renderMix({
    sound: 'reed',
    octave: 'low',
    seconds,
    phraseAt: null,
    dyadAt: null,
    buffers: null,
    attack: 0.25,
  });
  const mixed = await renderMix({
    sound: 'reed',
    octave: 'low',
    seconds,
    phraseAt,
    dyadAt: null,
    buffers: null,
    attack: 0.25,
  });
  const aloneLevel = partialLevel(alone, pitches, from, until);
  const mixedLevel = partialLevel(mixed, pitches, from, until);
  const dip = db(mixedLevel) - db(aloneLevel);
  const peak = truePeak(mixed);
  console.log(
    JSON.stringify({
      case: 'reed-low-phrase',
      aloneDb: db(aloneLevel),
      phraseDb: db(mixedLevel),
      dipDb: dip,
      samplePeak: samplePeak(mixed),
      truePeakDbtp: db(peak),
    }),
  );
  assert.ok(
    Math.abs(db(aloneLevel) + 26.26) < 0.4,
    `drone alone ${db(aloneLevel).toFixed(2)} dB moved from the mastered reed`,
  );
  assert.ok(
    Math.abs(dip) <= 0.5,
    `drone dipped ${dip.toFixed(2)} dB under the phrase`,
  );
  assert.ok(peak <= TRUE_PEAK_LINEAR, `true peak ${db(peak).toFixed(2)} dBTP`);
  assert.ok(
    samplePeak(mixed) < OUTPUT_KNEE,
    `sample peak ${samplePeak(mixed)} entered the limiter`,
  );
});

void test(
  'each drone stays steady under a full phrase, and the E5 dyad sum does not clip',
  { timeout: 120000 },
  async () => {
    const buffers = await celloBuffers();
    const phraseAt = 2.4;
    const seconds = phraseAt + (LAST_BEAT * 60) / TEMPO + 1.2;
    const from = phraseAt + 0.45;
    const until = Math.min(seconds - 0.25, from + 2.2);
    const rows: {
      sound: DroneSoundId;
      aloneDb: number;
      phraseDb: number;
      dipDb: number;
      phrasePeak: number;
      dyadPeak: number;
      dyadTruePeakDbtp: number;
    }[] = [];
    for (const sound of ['reed', 'bow', 'cello'] as const) {
      const octave: DroneOctave = 'layered';
      const attack = sound === 'bow' ? 1.6 : 0.3;
      const pitches = dronePitches('A', 'dorian', octave).map((pitch) =>
        midiHz(pitch.midi),
      );
      const shared = {
        sound,
        octave,
        seconds,
        buffers,
        attack,
      } as const;
      const alone = await renderMix({
        ...shared,
        phraseAt: null,
        dyadAt: null,
      });
      const phrase = await renderMix({ ...shared, phraseAt, dyadAt: null });
      const dyad = await renderMix({
        ...shared,
        phraseAt,
        dyadAt: phraseAt + 0.85,
      });
      const aloneDb = db(partialLevel(alone, pitches, from, until));
      const phraseDb = db(partialLevel(phrase, pitches, from, until));
      const dip = phraseDb - aloneDb;
      const dyadSamples = samplePeak(dyad);
      const dyadTrue = truePeak(dyad);
      rows.push({
        sound,
        aloneDb,
        phraseDb,
        dipDb: dip,
        phrasePeak: samplePeak(phrase),
        dyadPeak: dyadSamples,
        dyadTruePeakDbtp: db(dyadTrue),
      });
      assert.ok(
        Math.abs(dip) <= 0.5,
        `${sound} drone dipped ${dip.toFixed(2)} dB under the phrase`,
      );
      assert.ok(
        dyadSamples <= E5_DYAD_CEILING,
        `${sound} sample peak ${dyadSamples} passed ${E5_DYAD_CEILING}`,
      );
      assert.ok(dyadSamples < 1, `${sound} sample peak ${dyadSamples} clipped`);
      assert.ok(
        dyadTrue <= TRUE_PEAK_LINEAR,
        `${sound} true peak ${db(dyadTrue).toFixed(2)} dBTP`,
      );
      assert.ok(
        samplePeak(phrase) <= TRUE_PEAK_LINEAR,
        `${sound} phrase peak ${samplePeak(phrase)}`,
      );
    }
    console.log(
      JSON.stringify({
        ceiling: E5_DYAD_CEILING,
        truePeakLimit: TRUE_PEAK_DBTP,
        rows,
      }),
    );
  },
);

void test('a low-register line on the loudest drone stays inside the same bounds', async () => {
  const scale = SCALES.find((item) => item.id === 'dorian');
  if (!scale) throw new Error('A dorian is missing.');
  const scaleNotes = spell('A', scale.formula);
  const result = generatePhrase({
    seed: 11,
    bars: 4,
    scaleNotes,
    chordNotes: defaultChordNotes(scaleNotes),
    locks: { register: 'low', rhythm: 'eighths', contour: 'fall' },
  });
  if (!result.ok) throw new Error(result.reason);
  const pitches = dronePitches('A', 'dorian', 'layered').map((pitch) =>
    midiHz(pitch.midi),
  );
  const shared = {
    sound: 'bow' as const,
    octave: 'layered' as const,
    seconds: 4.8,
    buffers: null,
    attack: 0.3,
    notes: result.phrase.notes,
  };
  const alone = await renderMix({ ...shared, phraseAt: null, dyadAt: null });
  const mixed = await renderMix({ ...shared, phraseAt: 1.2, dyadAt: null });
  const dip =
    db(partialLevel(mixed, pitches, 1.85, 4.3)) -
    db(partialLevel(alone, pitches, 1.85, 4.3));
  const peak = truePeak(mixed);
  console.log(
    JSON.stringify({
      case: 'bow-layered-low-phrase',
      dipDb: dip,
      samplePeak: samplePeak(mixed),
      truePeakDbtp: db(peak),
    }),
  );
  assert.ok(Math.abs(dip) <= 0.5, `low phrase dip ${dip.toFixed(2)} dB`);
  assert.ok(
    samplePeak(mixed) <= E5_DYAD_CEILING,
    `low phrase peak ${samplePeak(mixed)}`,
  );
  assert.ok(
    peak <= TRUE_PEAK_LINEAR,
    `low phrase true peak ${db(peak).toFixed(2)} dBTP`,
  );
});
