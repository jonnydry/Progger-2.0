import { QUALITIES, voicings } from '../lib/harmony.ts';
import {
  DRONE_MAX_LINEAR_GAIN,
  createDroneVoice,
  createMasterBus,
  loopSampleBuffer,
  type DronePatch,
} from '../lib/drone-audio.ts';
import {
  DRONE_ROOTS,
  type DroneModeId,
  type DroneOctave,
  type DroneSoundId,
} from '../lib/drone.ts';
import { ROOTS } from '../lib/music.ts';
import { VoicingPlayer } from '../lib/voicing-audio.ts';

const RATE = 48000;
const FULL_SCALE_MARGIN = 10 ** (-1 / 20);
const PLUCK_AT = 3.7;
const DRONE_SECONDS = 12;

type StoredLoop = { samples: Float32Array; sampleRate: number };

type PluckCandidate = {
  frets: number[];
  label: string;
  peak: number;
  dbfs: number;
};

type DroneCandidate = {
  sound: DroneSoundId;
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
    __clips?: Record<string, string>;
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

function gainCap(): number {
  const raw = new URLSearchParams(location.search).get('gain');
  if (raw === null) return DRONE_MAX_LINEAR_GAIN;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : DRONE_MAX_LINEAR_GAIN;
}

async function renderPluck(frets: readonly number[], when: number, tail: number): Promise<AudioBuffer> {
  const seconds = when + tail;
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
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

function buffersOn(
  context: BaseAudioContext,
  stored: Map<string, StoredLoop> | null,
): Map<string, AudioBuffer> | null {
  if (!stored) return null;
  const buffers = new Map<string, AudioBuffer>();
  for (const [file, loop] of stored) {
    const buffer = context.createBuffer(1, loop.samples.length, loop.sampleRate);
    buffer.getChannelData(0).set(loop.samples);
    buffers.set(file, buffer);
  }
  return buffers;
}

async function renderDrone(
  patch: DronePatch,
  stored: Map<string, StoredLoop> | null,
  seconds: number,
): Promise<{ buffer: AudioBuffer; nodeCount: number }> {
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const bus = createMasterBus(offline, patch.volume);
  bus.master.gain.value = Math.min(1, Math.max(0, patch.volume)) * gainCap();
  bus.limiter.connect(offline.destination);
  const voice = createDroneVoice(
    offline,
    bus.duck,
    patch,
    buffersOn(offline, stored),
    0.02,
    1.6,
  );
  return { buffer: await offline.startRendering(), nodeCount: voice.nodeCount + bus.nodeCount };
}

async function renderSum(
  patch: DronePatch,
  stored: Map<string, StoredLoop> | null,
  frets: readonly number[],
): Promise<AudioBuffer> {
  const seconds = Math.max(PLUCK_AT + 3, DRONE_SECONDS);
  const offline = new OfflineAudioContext(2, Math.ceil(RATE * seconds), RATE);
  const bus = createMasterBus(offline, patch.volume);
  bus.master.gain.value = Math.min(1, Math.max(0, patch.volume)) * gainCap();
  bus.limiter.connect(offline.destination);
  createDroneVoice(offline, bus.duck, patch, buffersOn(offline, stored), 0.02, 1.6);
  let state = 'idle';
  const player = new VoicingPlayer(
    (next) => {
      state = next;
    },
    () => asRunning(offline, PLUCK_AT),
  );
  await player.play(frets);
  if (state !== 'playing') throw new Error(`Summed pluck did not start (${state}).`);
  return offline.startRendering();
}

async function celloLoops(): Promise<Map<string, StoredLoop>> {
  const files = ['cello-d2.m4a', 'cello-a2.m4a', 'cello-e3.m4a', 'cello-b3.m4a', 'cello-f4.m4a'];
  const holder = new OfflineAudioContext(1, RATE, RATE);
  const stored = new Map<string, StoredLoop>();
  for (const file of files) {
    const response = await fetch(`/audio/drone/${file}`);
    if (!response.ok) throw new Error(`Missing ${file} (${response.status}).`);
    const decoded = await holder.decodeAudioData(await response.arrayBuffer());
    const looped = loopSampleBuffer(holder, decoded);
    stored.set(file, {
      samples: looped.getChannelData(0).slice(),
      sampleRate: looped.sampleRate,
    });
  }
  return stored;
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

function patchFor(
  sound: DroneSoundId,
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
): DronePatch {
  return { sound, root, modeId, octave, volume: 1 };
}

async function main() {
  const clips = new URLSearchParams(location.search).get('clips') === '1';
  const quick = new URLSearchParams(location.search).get('quick') === '1';
  status('Decoding cello loops');
  const stored = await celloLoops();
  const shapes = sixStringShapes();
  const pluckShapes = quick ? shapes.slice(0, 8) : shapes;
  let loudestPluck: PluckCandidate | null = null;
  for (let index = 0; index < pluckShapes.length; index += 1) {
    const shape = pluckShapes[index];
    if (index % 25 === 0) status(`Pluck ${index + 1} of ${pluckShapes.length}`);
    const peak = peakOf(await renderPluck(shape.frets, 0, 0.5));
    if (!loudestPluck || peak > loudestPluck.peak) {
      loudestPluck = { frets: shape.frets, label: shape.label, peak, dbfs: dbfs(peak) };
    }
  }
  if (!loudestPluck) throw new Error('No six-string voicing was rendered.');
  const confirmedPeak = peakOf(await renderPluck(loudestPluck.frets, 0, 3));
  loudestPluck = { ...loudestPluck, peak: confirmedPeak, dbfs: dbfs(confirmedPeak) };

  const sounds: DroneSoundId[] = ['bow', 'reed', 'cello'];
  const octaves: DroneOctave[] = ['low', 'layered'];
  const modes: DroneModeId[] = ['dorian', 'locrian'];
  const roots = quick ? ['A'] : [...DRONE_ROOTS];
  const drones: DroneCandidate[] = [];
  let step = 0;
  const total = sounds.length * octaves.length * modes.length * roots.length;
  for (const sound of sounds) {
    for (const octave of octaves) {
      for (const modeId of modes) {
        for (const root of roots) {
          step += 1;
          if (step % 6 === 1) status(`Drone ${step} of ${total}`);
          const patch = patchFor(sound, root, modeId, octave);
          const rendered = await renderDrone(patch, sound === 'cello' ? stored : null, DRONE_SECONDS);
          const peak = peakOf(rendered.buffer);
          drones.push({
            sound,
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
  }
  const loudestDrone = drones.reduce((best, candidate) =>
    candidate.peak > best.peak ? candidate : best,
  );
  const dronePatch = patchFor(
    loudestDrone.sound,
    loudestDrone.root,
    loudestDrone.modeId,
    loudestDrone.octave,
  );
  status(`Summing ${loudestDrone.sound} ${loudestDrone.root} with ${loudestPluck.label}`);
  const sumBuffer = await renderSum(
    dronePatch,
    dronePatch.sound === 'cello' ? stored : null,
    loudestPluck.frets,
  );
  const sumPeak = peakOf(sumBuffer);
  const coherent = loudestDrone.peak + loudestPluck.peak;
  const nodeCounts: Record<string, number> = {};
  for (const candidate of drones) {
    if (candidate.root !== 'A') continue;
    nodeCounts[`${candidate.sound}-${candidate.octave}-${candidate.modeId}`] = candidate.nodeCount;
  }
  const report = {
    sampleRate: RATE,
    gain: gainCap(),
    pluckAtSeconds: PLUCK_AT,
    shapesMeasured: pluckShapes.length,
    pluck: loudestPluck,
    drone: {
      ...loudestDrone,
      note: 'Non-Locrian modes share root+fifth pitches, so Dorian stands in for them.',
    },
    sum: { peak: sumPeak, dbfs: dbfs(sumPeak) },
    coherent: { peak: coherent, dbfs: dbfs(coherent) },
    marginDb: {
      rendered: -1 - dbfs(sumPeak),
      coherent: -1 - dbfs(coherent),
    },
    passes: sumPeak <= FULL_SCALE_MARGIN && coherent <= FULL_SCALE_MARGIN,
    nodeCounts,
    families: drones.reduce<Record<string, DroneCandidate>>((best, candidate) => {
      const key = `${candidate.sound}-${candidate.octave}-${candidate.modeId}`;
      if (!best[key] || candidate.peak > best[key].peak) best[key] = candidate;
      return best;
    }, {}),
    droneTop: [...drones].sort((a, b) => b.peak - a.peak).slice(0, 8),
  };
  if (clips) {
    status('Rendering preview clips');
    const previews: Record<string, string> = {};
    for (const sound of sounds) {
      const rendered = await renderDrone(
        patchFor(sound, 'A', 'dorian', 'layered'),
        sound === 'cello' ? stored : null,
        8,
      );
      previews[sound] = wavBase64(rendered.buffer);
    }
    window.__clips = previews;
  }
  window.__report = report;
  status('done');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Measurement failed.';
  window.__report = { error: message };
  status(message);
});
