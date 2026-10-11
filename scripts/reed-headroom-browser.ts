import { QUALITIES, voicings } from '../lib/harmony.ts';
import { DRONE_ROOTS, type DroneModeId, type DroneOctave } from '../lib/drone.ts';
import { DRONE_MAX_LINEAR_GAIN, ReedDrone } from '../lib/drone-audio.ts';
import { ROOTS } from '../lib/music.ts';
import { VoicingPlayer } from '../lib/voicing-audio.ts';

const RATE = 48000;
const FULL_SCALE_MARGIN = 10 ** (-1 / 20);
const PLUCK_AT = 3.7;
const DRONE_SECONDS = 12;

type PluckCandidate = {
  frets: (number | null)[];
  label: string;
  strings: number;
  kind: 'catalog' | 'single';
  peak: number;
  dbfs: number;
};
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
    __clipAlone?: string;
    __clipNote?: string;
    __clipChord?: string;
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

const LISTEN_NOTE: (number | null)[] = [null, null, null, null, null, 5];
const LISTEN_CHORD: (number | null)[] = [5, 7, 7, 5, 5, 5];

function fretKey(frets: readonly (number | null)[]): string {
  return frets.map((fret) => (fret === null ? 'x' : String(fret))).join(',');
}

function collectShapes(): {
  frets: (number | null)[];
  label: string;
  strings: number;
  kind: 'catalog' | 'single';
}[] {
  const seen = new Map<
    string,
    { frets: (number | null)[]; label: string; strings: number; kind: 'catalog' | 'single' }
  >();
  for (const root of ROOTS) {
    for (const quality of QUALITIES) {
      for (const voicing of voicings(root, quality)) {
        const strings = voicing.frets.filter((fret) => fret !== null).length;
        if (strings < 1) continue;
        const key = fretKey(voicing.frets);
        if (!seen.has(key)) {
          seen.set(key, {
            frets: [...voicing.frets],
            label: `${root}${quality.symbol} ${voicing.name}`,
            strings,
            kind: 'catalog',
          });
        }
      }
    }
  }
  const singles: {
    frets: (number | null)[];
    label: string;
    strings: number;
    kind: 'single';
  }[] = [];
  for (let string = 0; string < 6; string += 1) {
    for (let fret = 0; fret <= 24; fret += 1) {
      const frets: (number | null)[] = [null, null, null, null, null, null];
      frets[string] = fret;
      singles.push({
        frets,
        label: `string ${string + 1} fret ${fret}`,
        strings: 1,
        kind: 'single',
      });
    }
  }
  return [...seen.values(), ...singles];
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

async function renderPluck(
  frets: readonly (number | null)[],
  when: number,
  tail: number,
): Promise<AudioBuffer> {
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
  frets: readonly (number | null)[],
  seconds = Math.max(PLUCK_AT + 3, DRONE_SECONDS),
): Promise<AudioBuffer> {
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
  const shapes = collectShapes();
  const buckets = new Map<string, { measured: number; best: PluckCandidate | null }>();
  const bucketFor = (shape: (typeof shapes)[number]) =>
    shape.kind === 'single' ? 'single' : `catalog:${shape.strings}`;
  for (let index = 0; index < shapes.length; index += 1) {
    const shape = shapes[index];
    if (index % 400 === 0) status(`Pluck ${index + 1} of ${shapes.length}`);
    const peak = peakOf(await renderPluck(shape.frets, 0, 0.06 + shape.strings * 0.05));
    const key = bucketFor(shape);
    const bucket = buckets.get(key) ?? { measured: 0, best: null };
    bucket.measured += 1;
    if (!bucket.best || peak > bucket.best.peak) {
      bucket.best = {
        frets: shape.frets,
        label: shape.label,
        strings: shape.strings,
        kind: shape.kind,
        peak,
        dbfs: dbfs(peak),
      };
    }
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    if (!bucket.best) continue;
    const peak = peakOf(await renderPluck(bucket.best.frets, 0, 3));
    bucket.best = { ...bucket.best, peak, dbfs: dbfs(peak) };
  }

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
  const bySize = [1, 2, 3, 4, 5, 6].map((strings) => {
    const catalog = buckets.get(`catalog:${strings}`);
    const single = strings === 1 ? buckets.get('single') : undefined;
    const best = [catalog?.best, single?.best].reduce<PluckCandidate | null>(
      (winner, candidate) => {
        if (!candidate) return winner;
        if (!winner || candidate.peak > winner.peak) return candidate;
        return winner;
      },
      null,
    );
    if (!best) throw new Error(`No voicing of size ${strings} was rendered.`);
    const coherentPeak = loudestDrone.peak + best.peak;
    return {
      strings,
      kind: best.kind,
      measured: (catalog?.measured ?? 0) + (single?.measured ?? 0),
      label: best.label,
      frets: best.frets,
      peak: best.peak,
      dbfs: best.dbfs,
      coherent: { peak: coherentPeak, dbfs: dbfs(coherentPeak) },
    };
  });
  const worst = bySize.reduce((loudest, row) =>
    row.coherent.peak > loudest.coherent.peak ? row : loudest,
  );
  status(`Summing reed ${loudestDrone.root} ${loudestDrone.modeId} with ${worst.label}`);
  const sumPeak = peakOf(
    await renderSum(loudestDrone.root, loudestDrone.modeId, loudestDrone.octave, worst.frets),
  );
  const passes = bySize.every((row) => row.coherent.peak <= FULL_SCALE_MARGIN);
  const alone = await renderDrone('A', 'dorian', 'layered', 8);
  const withNote = await renderSum('A', 'dorian', 'layered', LISTEN_NOTE, 8);
  const withChord = await renderSum('A', 'dorian', 'layered', LISTEN_CHORD, 8);
  window.__clipAlone = wavBase64(alone.buffer);
  window.__clipNote = wavBase64(withNote);
  window.__clipChord = wavBase64(withChord);
  window.__report = {
    sampleRate: RATE,
    gain: DRONE_MAX_LINEAR_GAIN,
    fullScaleMargin: FULL_SCALE_MARGIN,
    pluckAtSeconds: PLUCK_AT,
    shapesMeasured: shapes.length,
    droneSeconds: DRONE_SECONDS,
    bySize,
    drone: {
      ...loudestDrone,
      sound: 'reed',
      note: 'Non-Locrian modes share root and fifth, so Dorian stands in for them.',
    },
    sum: {
      strings: worst.strings,
      label: worst.label,
      frets: worst.frets,
      peak: sumPeak,
      dbfs: dbfs(sumPeak),
    },
    passes,
    nodeCounts: {
      low: drones.find((item) => item.root === 'A' && item.modeId === 'dorian' && item.octave === 'low')
        ?.nodeCount,
      layered: drones.find(
        (item) => item.root === 'A' && item.modeId === 'dorian' && item.octave === 'layered',
      )?.nodeCount,
    },
    droneTop: [...drones].sort((a, b) => b.peak - a.peak).slice(0, 6),
    listening: {
      root: 'A',
      modeId: 'dorian',
      octave: 'layered',
      note: { frets: LISTEN_NOTE, label: 'A4, high E fret 5' },
      chord: { frets: LISTEN_CHORD, label: 'Am E-shape' },
    },
  };
  if (!passes) throw new Error('A coherent sum is above -1 dBFS.');
  status('done');
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Measurement failed.';
  window.__report = { error: message };
  status(message);
});
