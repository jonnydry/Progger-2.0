import { QUALITIES, voicings } from '../lib/harmony.ts';
import { DRONE_ROOTS, type DroneModeId, type DroneOctave } from '../lib/drone.ts';
import { ReedDrone } from '../lib/drone-audio.ts';
import { ROOTS } from '../lib/music.ts';
import { VoicingPlayer } from '../lib/voicing-audio.ts';

const RATE = 48000;
const FULL_SCALE_MARGIN = 10 ** (-1 / 20);
const PLUCK_AT = 3.7;
const DRONE_SECONDS = 12;

type PluckCandidate = { frets: number[]; label: string; peak: number; dbfs: number };
type DroneCandidate = {
  root: string;
  modeId: DroneModeId;
  octave: DroneOctave;
  peak: number;
  dbfs: number;
  nodeCount: number;
};

declare global {
  interface Window {
    __report?: unknown;
    __clip?: string;
  }
}

function dbfs(peak: number): number {
  return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
}

function peakOf(buffer: AudioBuffer): number {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const sample = Math.abs(data[index]);
      if (sample > peak) peak = sample;
    }
  }
  return peak;
}

function status(text: string) {
  const node = document.getElementById('status');
  if (node) node.textContent = text;
  console.log(text);
}

function asRunning(offline: OfflineAudioContext, now: number): AudioContext {
  let onstatechange: (() => void) | null = null;
  return new Proxy(offline, {
    get(target, property) {
      if (property === 'state') return 'running';
      if (property === 'currentTime') return now;
      if (property === 'onstatechange') return onstatechange;
      if (property === 'resume' || property === 'close') return () => Promise.resolve();
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      if (property === 'onstatechange') {
        onstatechange = typeof value === 'function' ? value : null;
        return true;
      }
      return Reflect.set(target, property, value, target);
    },
  }) as unknown as AudioContext;
}

function sixStringShapes(): { frets: number[]; label: string }[] {
  const seen = new Map<string, string>();
  for (const root of ROOTS) {
    for (const quality of QUALITIES) {
      for (const voicing of voicings(root, quality)) {
        if (voicing.frets.some((fret) => fret === null)) continue;
        const frets = voicing.frets.filter((fret): fret is number => fret !== null);
        const key = frets.join(',');
        if (!seen.has(key)) seen.set(key, `${root}${quality.symbol} ${voicing.name}`);
      }
    }
  }
  return [...seen.entries()].map(([key, label]) => ({
    frets: key.split(',').map((fret) => Number(fret)),
    label,
  }));
}

async function untilPlaying(read: () => string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const state = read();
    if (state === 'playing') return;
    if (state === 'error') throw new Error('Audio did not start.');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`Audio stayed ${read()}.`);
}

async function renderPluck(frets: readonly number[], when: number, tail: number): Promise<AudioBuffer> {
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * (when + tail)), RATE);
  let state = 'idle';
  const player = new VoicingPlayer(
    (next) => {
      state = next;
    },
    () => asRunning(offline, when),
  );
  await player.play(frets);
  if (state !== 'playing') throw new Error(`Pluck did not start (${frets.join(',')}, ${state}).`);
  return offline.startRendering();
}

async function renderDrone(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
  seconds: number,
): Promise<{ buffer: AudioBuffer; nodeCount: number }> {
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  let state = 'idle';
  const engine = new ReedDrone(
    (next) => {
      state = next;
    },
    {
      createContext: () => asRunning(offline, 0),
      document: null,
      windowTarget: null,
    },
  );
  engine.setVolume(1);
  engine.play({ root, modeId, octave });
  await untilPlaying(() => state);
  const nodeCount = engine.nodeCount();
  return { buffer: await offline.startRendering(), nodeCount };
}

async function renderSum(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
  frets: readonly number[],
): Promise<AudioBuffer> {
  const seconds = Math.max(PLUCK_AT + 3, DRONE_SECONDS);
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  let droneState = 'idle';
  const engine = new ReedDrone(
    (next) => {
      droneState = next;
    },
    {
      createContext: () => asRunning(offline, 0),
      document: null,
      windowTarget: null,
    },
  );
  engine.setVolume(1);
  engine.play({ root, modeId, octave });
  await untilPlaying(() => droneState);
  let pluckState = 'idle';
  const player = new VoicingPlayer(
    (next) => {
      pluckState = next;
    },
    () => asRunning(offline, PLUCK_AT),
  );
  await player.play(frets);
  if (pluckState !== 'playing') throw new Error(`Summed pluck did not start (${pluckState}).`);
  return offline.startRendering();
}

function wavBase64(buffer: AudioBuffer): string {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const dataBytes = length * channels * 2;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const write = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, dataBytes, true);
  const channelData = Array.from({ length: channels }, (_, channel) => buffer.getChannelData(channel));
  let offset = 44;
  for (let index = 0; index < length; index += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, channelData[channel][index]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  const bytes = new Uint8Array(out);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function main() {
  const shapes = sixStringShapes();
  let loudestPluck: PluckCandidate | null = null;
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes[index];
    if (index % 40 === 0) status(`Pluck ${index + 1} of ${shapes.length}`);
    const peak = peakOf(await renderPluck(shape.frets, 0, 0.5));
    if (!loudestPluck || peak > loudestPluck.peak) {
      loudestPluck = { frets: shape.frets, label: shape.label, peak, dbfs: dbfs(peak) };
    }
  }
  if (!loudestPluck) throw new Error('No six-string voicing was rendered.');
  const confirmedPeak = peakOf(await renderPluck(loudestPluck.frets, 0, 3));
  loudestPluck = { ...loudestPluck, peak: confirmedPeak, dbfs: dbfs(confirmedPeak) };

  const octaves: DroneOctave[] = ['low', 'layered'];
  const modes: DroneModeId[] = ['dorian', 'locrian'];
  const drones: DroneCandidate[] = [];
  let step = 0;
  const total = octaves.length * modes.length * DRONE_ROOTS.length;
  for (const octave of octaves) {
    for (const modeId of modes) {
      for (const root of DRONE_ROOTS) {
        step += 1;
        if (step % 6 === 1) status(`Drone ${step} of ${total}`);
        const rendered = await renderDrone(root, modeId, octave, DRONE_SECONDS);
        const peak = peakOf(rendered.buffer);
        drones.push({
          root,
          modeId,
          octave,
          peak,
          dbfs: dbfs(peak),
          nodeCount: rendered.nodeCount,
        });
      }
    }
  }
  const loudestDrone = drones.reduce((best, candidate) =>
    candidate.peak > best.peak ? candidate : best,
  );
  status(`Summing reed ${loudestDrone.root} ${loudestDrone.modeId} with ${loudestPluck.label}`);
  const sumPeak = peakOf(
    await renderSum(loudestDrone.root, loudestDrone.modeId, loudestDrone.octave, loudestPluck.frets),
  );
  const coherent = loudestDrone.peak + loudestPluck.peak;
  const clip = await renderDrone('A', 'dorian', 'layered', 8);
  window.__clip = wavBase64(clip.buffer);
  window.__report = {
    sampleRate: RATE,
    gain: 0.3,
    pluckAtSeconds: PLUCK_AT,
    shapesMeasured: shapes.length,
    droneSeconds: DRONE_SECONDS,
    pluck: loudestPluck,
    drone: {
      ...loudestDrone,
      sound: 'reed',
      note: 'Non-Locrian modes share root and fifth, so Dorian stands in for them.',
    },
    sum: { peak: sumPeak, dbfs: dbfs(sumPeak) },
    coherent: { peak: coherent, dbfs: dbfs(coherent) },
    passes: sumPeak <= FULL_SCALE_MARGIN && coherent <= FULL_SCALE_MARGIN,
    nodeCounts: {
      low: drones.find((item) => item.root === 'A' && item.modeId === 'dorian' && item.octave === 'low')
        ?.nodeCount,
      layered: drones.find(
        (item) => item.root === 'A' && item.modeId === 'dorian' && item.octave === 'layered',
      )?.nodeCount,
    },
    droneTop: [...drones].sort((a, b) => b.peak - a.peak).slice(0, 6),
  };
  status('done');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Measurement failed.';
  window.__report = { error: message };
  status(message);
});
