import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AudioWorkletNode, OfflineAudioContext } from 'node-web-audio-api';

globalThis.AudioWorkletNode = AudioWorkletNode;
import { createDroneStage, droneSaturatorHarmonics } from '../lib/audio-output.ts';
import {
  CELLO_SAMPLES,
  dronePitches,
  type DroneOctave,
  type DroneSoundId,
} from '../lib/drone.ts';
import {
  REED_TIMING,
  prepareCelloBuffer,
  soundLinearCap,
  startLiveVoice,
} from '../lib/drone-audio.ts';
import { integratedLufs } from './loudness-meter.ts';

const RATE = 48000;

/** Integrated LUFS of each drone alone, volume 1, measured on this graph. */
/** Main, before this branch's makeup. The drone must clear each of these by 6 dB. */
const MAIN_LOUDNESS: Record<string, number> = {
  'reed-low': -27.44,
  'reed-layered': -26.37,
  'bow-low': -25.4,
  'bow-layered': -24.84,
  'cello-low': -29.01,
  'cello-layered': -27.4,
};

const LOUDNESS: Record<string, number> = {
  'reed-low': -14.9,
  'reed-layered': -13.87,
  'bow-low': -12.95,
  'bow-layered': -12.41,
  'cello-low': -16.48,
  'cello-layered': -14.89,
};

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

type Mp4Atom = { type: string; start: number; size: number; header: number };

function mp4Atoms(data: Uint8Array): Mp4Atom[] {
  const atoms: Mp4Atom[] = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    const size = readU32(data, offset);
    const header = 8;
    if (size < header || offset + size > data.length) break;
    const type = String.fromCharCode(
      data[offset + 4] ?? 0,
      data[offset + 5] ?? 0,
      data[offset + 6] ?? 0,
      data[offset + 7] ?? 0,
    );
    atoms.push({ type, start: offset, size, header });
    offset += size;
  }
  return atoms;
}

function atomType(data: Uint8Array, offset: number): string {
  return String.fromCharCode(
    data[offset + 4] ?? 0,
    data[offset + 5] ?? 0,
    data[offset + 6] ?? 0,
    data[offset + 7] ?? 0,
  );
}

/** The committed loops store `moov` after `mdat`. Move it forward and patch chunk offsets. */
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
  const delta =
    prefix.length + moovBytes.length + mdat.header - (mdat.start + mdat.header);
  patchChunkOffsets(moovBytes, delta);
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

function patchChunkOffsets(moov: Uint8Array, delta: number): void {
  const visit = (start: number, end: number): void => {
    let offset = start;
    while (offset + 8 <= end) {
      const size = readU32(moov, offset);
      if (size < 8 || offset + size > end) return;
      const type = atomType(moov, offset);
      const boxEnd = offset + size;
      if (
        type === 'trak' ||
        type === 'mdia' ||
        type === 'minf' ||
        type === 'stbl'
      ) {
        visit(offset + 8, boxEnd);
      } else if (type === 'stco') {
        const count = readU32(moov, offset + 12);
        for (let index = 0; index < count; index += 1) {
          const at = offset + 16 + index * 4;
          writeU32(moov, at, readU32(moov, at) + delta);
        }
      }
      offset = boxEnd;
    }
  };
  visit(8, moov.length);
}

function referenceChannels(): Float32Array[] {
  const amplitude = 10 ** (-23 / 20);
  const length = RATE * 3;
  const left = new Float32Array(length);
  const right = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = amplitude * Math.sin((2 * Math.PI * 997 * index) / RATE);
    left[index] = sample;
    right[index] = sample;
  }
  return [left, right];
}

async function celloBuffers(): Promise<Map<string, AudioBuffer>> {
  const context = new OfflineAudioContext(1, 44100, 44100);
  const buffers = new Map<string, AudioBuffer>();
  for (const sample of CELLO_SAMPLES) {
    const bytes = readFileSync(new URL(`../public/audio/drone/${sample.file}`, import.meta.url));
    const decoded = await context.decodeAudioData(fastStartM4a(bytes));
    buffers.set(sample.file, prepareCelloBuffer(context, decoded));
  }
  return buffers;
}

async function renderDrone(
  sound: DroneSoundId,
  octave: DroneOctave,
  volume: number,
  buffers: Map<string, AudioBuffer> | null,
): Promise<{ lufs: number; peak: number }> {
  const seconds = 5.8;
  const context = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const stage = createDroneStage(context, context.destination);
  await stage.installDuck();
  const master = context.createGain();
  master.gain.value = volume;
  master.connect(stage.input);
  startLiveVoice(
    context,
    master,
    dronePitches('A', 'dorian', octave),
    0.05,
    REED_TIMING.playAttack,
    sound,
    sound === 'cello' ? buffers : null,
    soundLinearCap(sound),
  );
  const rendered = await context.startRendering();
  const from = Math.floor(2.2 * RATE);
  const until = Math.floor(5.6 * RATE);
  const channels: Float32Array[] = [];
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel).slice(from, until);
    channels.push(data);
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
  }
  return { lufs: integratedLufs(channels, RATE), peak };
}

void test('the K-weighted meter reads a -23 dBFS stereo sine as -23 LUFS', () => {
  const loudness = integratedLufs(referenceChannels(), RATE);
  console.log(JSON.stringify({ referenceLufs: loudness }));
  assert.ok(
    Math.abs(loudness + 23) < 0.05,
    `reference measured ${loudness.toFixed(3)} LUFS`,
  );
});

void test('each drone sound at the default level stays gently compressed and measurable', async () => {
  const buffers = await celloBuffers();
  const rows: {
    sound: DroneSoundId;
    octave: DroneOctave;
    lufs: number;
    peak: number;
    thd: number;
    thirdDb: number;
  }[] = [];
  for (const sound of ['reed', 'bow', 'cello'] as const) {
    const harmonic = droneSaturatorHarmonics(soundLinearCap(sound));
    assert.ok(harmonic.thd < 0.03, `${sound} THD ${harmonic.thd}`);
    for (const octave of ['low', 'layered'] as const) {
      const rendered = await renderDrone(sound, octave, 1, buffers);
      rows.push({
        sound,
        octave,
        lufs: rendered.lufs,
        peak: rendered.peak,
        thd: harmonic.thd,
        thirdDb: harmonic.thirdDb,
      });
      const key = `${sound}-${octave}`;
      const expected = LOUDNESS[key];
      const baseline = MAIN_LOUDNESS[key];
      assert.ok(expected !== undefined && baseline !== undefined, key);
      assert.ok(
        Math.abs(rendered.lufs - expected) < 0.35,
        `${sound} ${octave} ${rendered.lufs} LUFS, expected ${expected}`,
      );
      assert.ok(
        rendered.lufs >= baseline + 6,
        `${sound} ${octave} ${rendered.lufs} LUFS is under +6 dB versus main ${baseline}`,
      );
      if (sound === 'reed' && octave === 'low') {
        assert.ok(
          Math.abs(rendered.lufs + 14) < 1,
          `default reed ${rendered.lufs} LUFS, target about -14`,
        );
      }
      assert.ok(rendered.peak < 0.8, `${sound} ${octave} peak ${rendered.peak}`);
    }
  }
  const full = await renderDrone('bow', 'layered', 1, buffers);
  const half = await renderDrone('bow', 'layered', 0.5, buffers);
  const sliderDb = full.lufs - half.lufs;
  console.log(
    JSON.stringify(
      {
        rows,
        sliderTopDb: sliderDb,
        kneeHeadroomDb: 20 * Math.log10(0.8 / full.peak),
      },
      null,
      2,
    ),
  );
  assert.ok(sliderDb > 5.5 && sliderDb < 6.5, `slider top adds ${sliderDb} dB`);
});
