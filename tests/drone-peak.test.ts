import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { DRONE_MODES, DRONE_ROOTS } from '../lib/drone.ts';
import { FULL_SCALE_MARGIN } from '../lib/drone-levels.ts';
import {
  REV_FRET_KEY,
  contextVoicings,
  fretKey,
  headroomCases,
  loudestMeasured,
  type HeadroomReport,
} from './drone-headroom-run.ts';

/** Drone, one walk note, and the loudest chord, summed at volume 1. */
const MIX_CEILING = 0.8913;

/**
 * Each sound's worst rendered mix. The grid is every key and mode, sustain,
 * key change, and sound switch, with a walk window of up to four notes and
 * that context's loudest measured chord, swept ±20 ms. −1.5 dBFS.
 */
const SOUND_LIMIT = 0.8414;

const chromeBin = [
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
].find((path) => existsSync(path));
const firefoxBin = ['/tmp/firefox-157/firefox/firefox'].find((path) =>
  existsSync(path),
);
const playwrightEntry = [
  join(process.cwd(), 'node_modules/playwright/index.mjs'),
  '/tmp/pw/node_modules/playwright/index.mjs',
].find((path) => existsSync(path));

type PeakRow = {
  root: string;
  mode: string;
  octave: string;
  sound: string;
  limited: number;
  via: string;
  gap: number;
  mix: number;
};

type PeakReport = {
  ua?: string;
  error?: string;
  walkPeak: number;
  walkMidi: number;
  walkAt: number;
  chordPeak: number;
  chordAt: number;
  rows: PeakRow[];
  together: Record<string, number>;
  swept: Record<string, number>;
};

function pluckAttackLevel(): number {
  const source = readFileSync(
    new URL('../lib/voicing-audio.ts', import.meta.url),
    'utf8',
  );
  const bus = source.match(
    /bus\.gain\.value = ([0-9]*\.?[0-9]+) \/ pitches\.length/,
  );
  const attack = source.match(
    /envelope\.gain\.linearRampToValueAtTime\(([0-9]*\.?[0-9]+), at \+ 0\.006\)/,
  );
  if (!bus || !attack) throw new Error('Pluck level is not in lib/voicing-audio.ts.');
  return Number(bus[1]) * Number(attack[1]);
}

function bundleProbe(): string {
  const entry = join(tmpdir(), 'drone-peak-entry.ts');
  const outfile = join(tmpdir(), 'drone-peak-probe.js');
  const root = process.cwd();
  writeFileSync(
    entry,
    `export {
  startLiveVoice,
  startWalkPluck,
  prepareCelloBuffer,
  soundLinearCap,
  DRONE_LIMITER,
  REED_TIMING,
  ROOM_SECONDS,
  TAIL_MARGIN,
} from '${root}/lib/drone-audio.ts';
export { dronePitches, scaleWalk } from '${root}/lib/drone.ts';
`,
  );
  execFileSync(
    join(root, 'node_modules/esbuild/bin/esbuild'),
    [entry, '--bundle', '--format=esm', `--outfile=${outfile}`, '--platform=browser'],
    { stdio: 'ignore' },
  );
  return outfile;
}

function page(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<title>peak</title>
<script type="module">
import {
  startLiveVoice,
  startWalkPluck,
  prepareCelloBuffer,
  soundLinearCap,
  DRONE_LIMITER,
  dronePitches,
} from '/probe.js';

const files = [
  'cello-d2.m4a',
  'cello-a2.m4a',
  'cello-e3.m4a',
  'cello-b3.m4a',
  'cello-f4.m4a',
];

function peakOf(rendered) {
  let peak = 0;
  let at = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      const value = Math.abs(data[index]);
      if (value > peak) {
        peak = value;
        at = index / rendered.sampleRate;
      }
    }
  }
  return { peak, at };
}

function startChord(context, midis, when) {
  const bus = context.createGain();
  bus.gain.value = 0.75 / midis.length;
  bus.connect(context.destination);
  midis.forEach((midi, index) => {
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    const filter = context.createBiquadFilter();
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const real = new Float32Array(25);
    const imaginary = new Float32Array(25);
    for (let harmonic = 1; harmonic < imaginary.length; harmonic += 1) {
      if (frequency * harmonic < context.sampleRate / 2) {
        imaginary[harmonic] = Math.sin(harmonic * Math.PI * 0.23) / harmonic ** 1.35;
      }
    }
    oscillator.setPeriodicWave(context.createPeriodicWave(real, imaginary));
    oscillator.frequency.value = frequency;
    const at = when + index * 0.045;
    filter.type = 'lowpass';
    filter.Q.value = 0.45;
    filter.frequency.setValueAtTime(Math.min(5500, frequency * 12), at);
    filter.frequency.exponentialRampToValueAtTime(Math.max(600, frequency * 2), at + 1.3);
    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(0.85, at + 0.006);
    envelope.gain.exponentialRampToValueAtTime(0.12, at + 0.65);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + 2.5);
    envelope.gain.linearRampToValueAtTime(0, at + 2.52);
    oscillator.connect(filter);
    filter.connect(envelope);
    envelope.connect(bus);
    oscillator.start(at);
    oscillator.stop(at + 2.525);
  });
}

function graph(context, sound) {
  const master = context.createGain();
  master.gain.value = soundLinearCap(sound);
  const limiter = context.createDynamicsCompressor();
  limiter.threshold.value = DRONE_LIMITER.threshold;
  limiter.knee.value = DRONE_LIMITER.knee;
  limiter.ratio.value = DRONE_LIMITER.ratio;
  limiter.attack.value = DRONE_LIMITER.attack;
  limiter.release.value = DRONE_LIMITER.release;
  master.connect(limiter);
  limiter.connect(context.destination);
  return { master, limiter };
}

async function renderOverlap(buffers, root, mode, octave, sound, gap, walk) {
  const rate = 48000;
  const seconds = 0.05 + gap + 0.9;
  const context = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const { master, limiter } = graph(context, sound);
  const pitches = dronePitches(root, mode, octave);
  const cello = sound === 'cello' ? buffers : null;
  const start = 0.05;
  const now = start + gap;
  const when = now + 0.02;
  const first = startLiveVoice(context, master, pitches, start, 0.2, sound, cello);
  first.stop(when, 0.16, now);
  startLiveVoice(context, master, pitches, when, 0.2, sound, cello);
  if (walk) startWalkPluck(context, limiter, walk.midi, walk.at, 1);
  if (walk && walk.chord) startChord(context, walk.chord, walk.chordAt);
  return peakOf(await context.startRendering());
}

async function renderVoice(buffers, root, mode, octave, sound, attack, seconds, walk) {
  const rate = 48000;
  const context = new OfflineAudioContext(2, Math.ceil(rate * seconds), rate);
  const { master, limiter } = graph(context, sound);
  const voice = startLiveVoice(
    context,
    master,
    dronePitches(root, mode, octave),
    0.05,
    attack,
    sound,
    sound === 'cello' ? buffers : null,
  );
  if (walk) startWalkPluck(context, limiter, walk.midi, walk.at, 1);
  if (walk && walk.chord) startChord(context, walk.chord, walk.chordAt);
  return peakOf(await context.startRendering());
}

try {
  const decodeCtx = new AudioContext();
  const buffers = new Map();
  for (const file of files) {
    const bytes = await (await fetch('/audio/' + file)).arrayBuffer();
    const decoded = await decodeCtx.decodeAudioData(bytes.slice(0));
    buffers.set(file, prepareCelloBuffer(decodeCtx, decoded));
  }
  let walkPeak = 0;
  let walkMidi = 60;
  let walkAt = 0;
  for (let midi = 40; midi <= 84; midi += 1) {
    const rate = 48000;
    const context = new OfflineAudioContext(2, Math.ceil(rate * 0.12), rate);
    const { limiter } = graph(context, 'reed');
    startWalkPluck(context, limiter, midi, 0.01, 1);
    const value = peakOf(await context.startRendering());
    if (value.peak > walkPeak) {
      walkPeak = value.peak;
      walkMidi = midi;
      walkAt = value.at - 0.01;
    }
  }
  const chordCandidates = [];
  for (let midi = 40; midi <= 84; midi += 2) chordCandidates.push([midi]);
  chordCandidates.push(
    [40, 45, 50, 55, 59, 64],
    [40, 45, 50],
    [52, 55, 59],
    [64, 69, 74],
  );
  let chordPeak = 0;
  let chordMidis = [60];
  let chordAt = 0;
  for (const midis of chordCandidates) {
    const rate = 48000;
    const context = new OfflineAudioContext(2, Math.ceil(rate * 0.12), rate);
    startChord(context, midis, 0.01);
    const value = peakOf(await context.startRendering());
    if (value.peak > chordPeak) {
      chordPeak = value.peak;
      chordMidis = midis;
      chordAt = value.at - 0.01;
    }
  }
  const roots = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const rows = [];
  for (const sound of ['reed', 'bow', 'cello']) {
    for (const root of roots) {
      for (const mode of ['ionian', 'locrian']) {
        for (const octave of ['low', 'layered']) {
          const sustained = await renderVoice(buffers, root, mode, octave, sound, 1.6, 3.6);
          const switched = await renderVoice(buffers, root, mode, octave, sound, 0.2, 1.2);
          const gaps = [0.232, 0.252, 0.254, 0.278, 0.28];
          let crossed = 0;
          let crossAt = 0;
          let crossGap = gaps[0];
          for (const gap of gaps) {
            const value = await renderOverlap(
              buffers,
              root,
              mode,
              octave,
              sound,
              gap,
            );
            if (value.peak > crossed) {
              crossed = value.peak;
              crossAt = value.at;
              crossGap = gap;
            }
          }
          const limited = Math.max(sustained.peak, switched.peak, crossed);
          const via =
            crossed >= sustained.peak && crossed >= switched.peak
              ? 'crossfade'
              : switched.peak >= sustained.peak
                ? 'switch'
                : 'sustain';
          const peakAt =
            via === 'crossfade' ? crossAt : via === 'switch' ? switched.at : sustained.at;
          const attack = via === 'sustain' ? 1.6 : 0.2;
          const mixSeconds = via === 'sustain' ? 3.6 : via === 'switch' ? 1.2 : 0.05 + crossGap + 0.9;
          const aligned = {
            midi: walkMidi,
            at: Math.max(0.001, peakAt - walkAt),
            chord: chordMidis,
            chordAt: Math.max(0.001, peakAt - chordAt),
          };
          const mixed =
            via === 'crossfade'
              ? await renderOverlap(buffers, root, mode, octave, sound, crossGap, aligned)
              : await renderVoice(
                  buffers,
                  root,
                  mode,
                  octave,
                  sound,
                  attack,
                  mixSeconds,
                  aligned,
                );
          rows.push({
            root,
            mode,
            octave,
            sound,
            limited,
            via,
            gap: crossGap,
            peakAt,
            mix: mixed.peak,
          });
          if (rows.length % 12 === 0) console.log('measured ' + rows.length);
        }
      }
    }
  }
  const together = {};
  const swept = {};
  for (const sound of ['reed', 'bow', 'cello']) {
    const ofSound = rows.filter((item) => item.sound === sound);
    const row = ofSound.reduce((best, item) => (item.mix > best.mix ? item : best));
    const withWalk =
      row.via === 'crossfade'
        ? await renderOverlap(buffers, row.root, row.mode, row.octave, sound, row.gap, {
            midi: walkMidi,
            at: Math.max(0.001, row.peakAt - walkAt),
          })
        : await renderVoice(
            buffers,
            row.root,
            row.mode,
            row.octave,
            sound,
            row.via === 'sustain' ? 1.6 : 0.2,
            row.via === 'sustain' ? 3.6 : 1.2,
            {
              midi: walkMidi,
              at: Math.max(0.001, row.peakAt - walkAt),
            },
          );
    together[sound] = withWalk.peak;
    let sweep = row.mix;
    for (let shift = -0.02; shift <= 0.02; shift += 0.004) {
      const aligned = {
        midi: walkMidi,
        at: Math.max(0.001, row.peakAt - walkAt + shift),
        chord: chordMidis,
        chordAt: Math.max(0.001, row.peakAt - chordAt + shift),
      };
      const found =
        row.via === 'crossfade'
          ? await renderOverlap(
              buffers,
              row.root,
              row.mode,
              row.octave,
              sound,
              row.gap,
              aligned,
            )
          : await renderVoice(
              buffers,
              row.root,
              row.mode,
              row.octave,
              sound,
              row.via === 'sustain' ? 1.6 : 0.2,
              row.via === 'sustain' ? 3.6 : 1.2,
              aligned,
            );
      if (found.peak > sweep) sweep = found.peak;
    }
    swept[sound] = sweep;
  }
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({
      ua: navigator.userAgent,
      walkPeak,
      walkMidi,
      walkAt,
      chordPeak,
      chordAt,
      rows,
      together,
      swept,
    }),
  });
  document.title = 'done';
} catch (error) {
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ error: String(error && error.stack ? error.stack : error) }),
  });
  document.title = 'done';
}
</script>`;
}


function serve(bundlePath: string, html = page()): Promise<{
  server: Server;
  url: string;
  result: Promise<string>;
  close: () => void;
}> {
  let settle: (body: string) => void = () => {};
  const result = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const sockets = new Set<Socket>();
  const audioDir = join(process.cwd(), 'public/audio/drone');
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/probe.js')) {
      res.setHeader('content-type', 'text/javascript');
      res.end(readFileSync(bundlePath));
      return;
    }
    if (url.startsWith('/audio/')) {
      const file = url.slice('/audio/'.length).split('?')[0] ?? '';
      res.setHeader('content-type', 'audio/mp4');
      res.end(readFileSync(join(audioDir, file)));
      return;
    }
    if (url.startsWith('/result') && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.end('ok');
        settle(Buffer.concat(chunks).toString());
      });
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(html);
  });
  const close = () => {
    for (const socket of sockets) socket.destroy();
    server.close();
  };
  return new Promise((resolve) => {
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      resolve({
        server,
        url: `http://127.0.0.1:${address.port}/`,
        result,
        close,
      });
    });
  });
}

async function waitForReport(
  result: Promise<string>,
  limit = 340000,
): Promise<PeakReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = await Promise.race([
    result,
    new Promise<string>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Peak render timed out')),
        limit,
      );
    }),
  ]);
  if (timer) clearTimeout(timer);
  return JSON.parse(body) as PeakReport;
}

async function runChrome(
  bundlePath: string,
  html = page(),
  limit = 340000,
): Promise<PeakReport> {
  if (!chromeBin || !playwrightEntry) throw new Error('Chrome harness is unavailable.');
  const { url, result, close } = await serve(bundlePath, html);
  const playwright = (await import(pathToFileURL(playwrightEntry).href)) as {
    chromium: {
      launch: (options: {
        executablePath: string;
        headless: boolean;
        args: string[];
      }) => Promise<{
        version: () => string;
        newPage: () => Promise<{
          goto: (
            target: string,
            options: { waitUntil: string; timeout: number },
          ) => Promise<unknown>;
          on: (
            event: string,
            listener: (value: { text?: () => string }) => void,
          ) => void;
        }>;
        close: () => Promise<void>;
      }>;
    };
  };
  const browser = await playwright.chromium.launch({
    executablePath: chromeBin,
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader'],
  });
  try {
    const tab = await browser.newPage();
    const errors: string[] = [];
    tab.on('pageerror', (error) => errors.push(error.text?.() ?? 'page error'));
    tab.on('console', (message) => console.log(message.text?.() ?? ''));
    await tab.goto(url, { waitUntil: 'load', timeout: 120000 });
    const report = await waitForReport(result, limit);
    console.log(`chrome ${browser.version()}`);
    if (errors.length && !report.error) report.error = errors.join('\n');
    return report;
  } finally {
    await browser.close();
    close();
  }
}

async function runFirefox(
  bundlePath: string,
  html = page(),
  limit = 340000,
): Promise<PeakReport> {
  if (!firefoxBin) throw new Error('Firefox 157 is unavailable.');
  const { url, result, close } = await serve(bundlePath, html);
  const profile = join(tmpdir(), 'fx157-peak-profile');
  execFileSync('rm', ['-rf', profile]);
  execFileSync('mkdir', ['-p', profile]);
  writeFileSync(
    join(profile, 'user.js'),
    [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.aboutwelcome.enabled", false);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);',
      'user_pref("app.update.disabledForTesting", true);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("browser.firstrun.didSeeAboutWelcome", true);',
      'user_pref("media.cubeb.sandbox", false);',
    ].join('\n'),
  );
  console.log(
    execFileSync(firefoxBin, ['--version'], { encoding: 'utf8' }).trim(),
  );
  const child = spawn(
    firefoxBin,
    ['--headless', '--no-remote', '--profile', profile, url],
    { stdio: 'ignore', detached: true },
  );
  try {
    return await waitForReport(result, limit);
  } finally {
    if (child.pid) {
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    child.unref();
    close();
  }
}

function assertHeadroom(report: PeakReport, pluck: number) {
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.rows.length, 12 * 2 * 2 * 3);
  assert.ok(report.chordPeak > 0.5, `chord peak ${report.chordPeak}`);
  assert.ok(report.walkPeak > 0.05, `walk peak ${report.walkPeak}`);
  const worst: Record<string, PeakRow> = {};
  for (const row of report.rows) {
    const sum = row.limited + pluck;
    const walkSum = row.limited + report.walkPeak;
    assert.ok(
      sum <= FULL_SCALE_MARGIN,
      `${row.sound} ${row.root} ${row.mode} ${row.octave} ${row.via} peak ${row.limited} + pluck ${pluck} = ${sum}`,
    );
    assert.ok(
      walkSum <= FULL_SCALE_MARGIN,
      `${row.sound} walk sum ${walkSum}`,
    );
    const best = worst[row.sound];
    if (!best || row.limited > best.limited) worst[row.sound] = row;
  }
  for (const sound of ['reed', 'bow', 'cello']) {
    const row = worst[sound];
    assert.ok(row, sound);
    assert.ok(
      report.together[sound] <= FULL_SCALE_MARGIN,
      `${sound} drone plus walk ${report.together[sound]}`,
    );
    const sum = row.limited + pluck;
    const mixes = report.rows.filter((item) => item.sound === sound);
    const loudestMix = mixes.reduce((best, item) =>
      item.mix > best.mix ? item : best,
    );
    console.log(
      `${sound} ${row.root} ${row.mode} ${row.octave} ${row.via} gap ${row.gap} peak ${row.limited} + pluck ${pluck} = ${sum} walk ${report.walkPeak} (midi ${report.walkMidi} at ${report.walkAt}) together ${report.together[sound]} mix ${loudestMix.mix} on ${loudestMix.root} ${loudestMix.mode} ${loudestMix.octave} ${loudestMix.via} swept ${report.swept[sound]} chord ${report.chordPeak} at ${report.chordAt}`,
    );
  }
  for (const sound of ['reed', 'bow', 'cello']) {
    const mixes = report.rows.filter((item) => item.sound === sound);
    const loudestMix = mixes.reduce((best, item) =>
      item.mix > best.mix ? item : best,
    );
    const swept = report.swept[sound];
    assert.ok(
      typeof swept === 'number' && Number.isFinite(swept) && swept > 0,
      `${sound} swept mix ${swept}`,
    );
    assert.ok(
      loudestMix.mix < MIX_CEILING,
      `${sound} mix ${loudestMix.mix} on ${loudestMix.root} ${loudestMix.mode} ${loudestMix.octave} ${loudestMix.via}`,
    );
    assert.ok(
      swept < MIX_CEILING,
      `${sound} swept mix ${swept}`,
    );
    const worstCase = Math.max(loudestMix.mix, swept);
    assert.ok(
      worstCase <= SOUND_LIMIT,
      `${sound} worst case ${worstCase} vs ${SOUND_LIMIT}`,
    );
  }
}

void test(
  'Chrome keeps every drone sound, the loudest pluck, and a walk note at or under -1 dBFS',
  {
    skip:
      chromeBin && playwrightEntry
        ? false
        : 'Chrome or Playwright is not installed',
    timeout: 360000,
  },
  async () => {
    const pluck = pluckAttackLevel();
    const report = await runChrome(bundleProbe());
    console.log(report.ua);
    assertHeadroom(report, pluck);
  },
);

void test(
  'Firefox 157 keeps every drone sound, the loudest pluck, and a walk note at or under -1 dBFS',
  {
    skip: firefoxBin ? false : 'Firefox 157 is not installed',
    timeout: 360000,
  },
  async () => {
    const pluck = pluckAttackLevel();
    const report = await runFirefox(bundleProbe());
    console.log(report.ua);
    assertHeadroom(report, pluck);
  },
);

function headroomBundle(): string {
  const entry = join(tmpdir(), 'drone-headroom-entry.ts');
  const outfile = join(tmpdir(), 'drone-headroom-probe.js');
  const root = process.cwd();
  writeFileSync(
    entry,
    `export { runHeadroom } from '${root}/tests/drone-headroom-run.ts';\n`,
  );
  execFileSync(
    join(root, 'node_modules/esbuild/bin/esbuild'),
    [entry, '--bundle', '--format=esm', `--outfile=${outfile}`, '--platform=browser'],
    { stdio: 'ignore' },
  );
  return outfile;
}

function headroomPage(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<title>headroom</title>
<script type="module">
import { runHeadroom } from '/probe.js';
try {
  const report = await runHeadroom();
  await fetch('/result', { method: 'POST', body: JSON.stringify(report) });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : '';
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ error: message + '\\n' + (stack || '') }),
  });
}
document.title = 'done';
</script>`;
}

void test('the headroom grid is every key and mode, and it uses the chord player', () => {
  const cases = headroomCases();
  assert.equal(cases.length, DRONE_ROOTS.length * DRONE_MODES.length * 3 * 4);
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      const here = cases.filter((item) => item.root === root && item.mode === mode.id);
      assert.equal(here.length, 12, `${root} ${mode.id}`);
      assert.deepEqual(
        here.map((item) => item.via).sort(),
        [
          'key-change',
          'key-change',
          'key-change',
          'sound-switch',
          'sound-switch',
          'sound-switch',
          'sound-switch',
          'sound-switch',
          'sound-switch',
          'sustain',
          'sustain',
          'sustain',
        ],
      );
    }
  }
  const source = readFileSync(
    new URL('./drone-headroom-run.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /scheduleVoicing\(/);
  assert.equal(source.includes('startChord'), false);
  assert.equal(source.includes('0.75 /'), false);
  assert.match(source, /loudestMeasured\(/);
  assert.match(source, /for \(let step = -5; step <= 5; step \+= 1\)/);
});

void test('each key measures every playable voicing, and the peak picks the chord', () => {
  const eb = contextVoicings('Eb', 'ionian');
  assert.ok(eb.some((choice) => fretKey(choice.frets) === REV_FRET_KEY));
  assert.equal(eb.find((choice) => fretKey(choice.frets) === REV_FRET_KEY)?.midis.join(','), '53');
  assert.ok(eb.some((choice) => choice.midis.length >= 3));
  assert.equal(
    eb.some((choice) => fretKey(choice.frets) === '0,x,x,x,x,x'),
    false,
  );
  assert.equal(new Set(eb.map((choice) => fretKey(choice.frets))).size, eb.length);
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      const choices = contextVoicings(root, mode.id);
      assert.ok(
        choices.some((choice) => choice.midis.length === 1),
        `${root} ${mode.id} single`,
      );
      assert.ok(
        choices.some((choice) => choice.midis.length >= 3),
        `${root} ${mode.id} grip`,
      );
    }
  }
  const dyad = loudestMeasured(
    [
      {
        frets: [null, 8, null, null, null, null],
        midis: [53],
        label: 'A-string fret 8',
      },
      {
        frets: [0, 2, null, null, null, null],
        midis: [40, 47],
        label: 'E5 dyad',
      },
    ],
    [0.2, 0.9],
  );
  assert.equal(dyad.choice.label, 'E5 dyad');
  assert.equal(dyad.peak, 0.9);
  const single = loudestMeasured(
    [
      {
        frets: [0, 2, null, null, null, null],
        midis: [40, 47],
        label: 'E5 dyad',
      },
      {
        frets: [null, 8, null, null, null, null],
        midis: [53],
        label: 'A-string fret 8',
      },
    ],
    [0.4, 0.7],
  );
  assert.equal(fretKey(single.choice.frets), REV_FRET_KEY);
  const tied = loudestMeasured(
    [
      {
        frets: [13, null, null, null, null, null],
        midis: [53],
        label: 'E-string fret 13',
      },
      {
        frets: [null, 8, null, null, null, null],
        midis: [53],
        label: 'A-string fret 8',
      },
    ],
    [0.6378752589225769, 0.6378752589225769],
  );
  assert.equal(fretKey(tied.choice.frets), REV_FRET_KEY);
});

function assertGrid(report: HeadroomReport) {
  assert.equal(report.error, undefined, report.error);
  const rows = report.rows ?? [];
  assert.equal(rows.length, DRONE_ROOTS.length * DRONE_MODES.length * 3 * 4);
  assert.equal(report.caps?.reed, 0.063);
  assert.equal(report.caps?.bow, 0.072);
  assert.equal(report.caps?.cello, 0.0736);
  assert.ok((report.chord?.peak ?? 0) > 0.5, JSON.stringify(report.chord));
  assert.equal(report.rev?.frets, REV_FRET_KEY);
  assert.deepEqual(report.rev?.midis, [53]);
  assert.equal(report.rev?.mixes.length, 2);
  const revPeak = report.rev?.peak ?? 0;
  assert.ok(revPeak > 0.5, `rev chord ${revPeak}`);
  for (const mix of report.rev?.mixes ?? []) {
    const peak = Math.max(mix.linear, mix.confirmed);
    assert.ok(
      peak <= SOUND_LIMIT,
      `rev ${mix.pair} ${peak} vs ${SOUND_LIMIT}`,
    );
    console.log(
      `rev ${mix.pair} shift ${mix.shift} linear ${mix.linear} confirmed ${mix.confirmed} chord ${report.rev?.frets} ${revPeak}`,
    );
  }
  const contexts = report.contexts ?? [];
  assert.equal(contexts.length, DRONE_ROOTS.length * DRONE_MODES.length);
  const eb = contexts.find((item) => item.root === 'Eb' && item.mode === 'ionian');
  if (!eb) throw new Error('Eb ionian chord');
  assert.ok(
    eb.peak + 1e-6 >= revPeak,
    `Eb ionian ${eb.frets} ${eb.peak} below A-string fret 8 ${revPeak}`,
  );
  assert.equal(report.chord?.frets, eb.frets);
  for (const row of rows) {
    const chord = contexts.find((item) => item.root === row.root && item.mode === row.mode);
    assert.equal(row.chordFrets, chord?.frets, `${row.root} ${row.mode}`);
    assert.equal(row.chordPeak, chord?.peak);
    assert.ok(row.chordPeak > 0.2, `${row.root} ${row.mode} ${row.chordPeak}`);
  }
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      const here = rows.filter((row) => row.root === root && row.mode === mode.id);
      assert.equal(here.length, 12, `${root} ${mode.id}`);
    }
  }
  for (const sound of ['reed', 'bow', 'cello']) {
    const ofSound = rows.filter((row) => row.sound === sound);
    assert.equal(ofSound.filter((row) => row.via === 'sustain').length, 12 * 7);
    assert.equal(ofSound.filter((row) => row.via === 'key-change').length, 12 * 7);
    assert.equal(
      ofSound.filter((row) => row.via === 'sound-switch').length,
      12 * 7 * 2,
    );
    let worst = ofSound[0];
    if (!worst) throw new Error(sound);
    for (const row of ofSound) {
      const peak = Math.max(row.peak, row.confirmed);
      assert.ok(
        Number.isFinite(peak) && peak > 0.15,
        `${sound} ${row.root} ${row.mode} ${row.via} ${peak}`,
      );
      assert.ok(
        peak < FULL_SCALE_MARGIN,
        `${sound} ${row.root} ${row.mode} ${row.via} ${peak}`,
      );
      assert.ok(
        peak <= SOUND_LIMIT,
        `${sound} ${row.via} from ${row.from || '-'} ${row.root} ${row.mode} ${row.kind} ${peak} vs ${SOUND_LIMIT}`,
      );
      if (peak > Math.max(worst.peak, worst.confirmed)) worst = row;
    }
    console.log(
      `${sound} worst ${worst.via} from ${worst.from || '-'} ${worst.root} ${worst.mode} ${worst.octave} ${worst.kind} ${worst.later} after ${worst.pred} shift ${worst.shift} linear ${worst.peak} confirmed ${worst.confirmed} chord ${worst.chordLabel} ${worst.chordFrets} ${worst.chordPeak}`,
    );
    assert.ok(
      Math.max(worst.peak, worst.confirmed) > 0.5,
      `${sound} worst ${Math.max(worst.peak, worst.confirmed)}`,
    );
  }
}

void test(
  'Chrome keeps every key and mode, including a sound switch, at or below -1.5 dBFS',
  {
    skip:
      chromeBin && playwrightEntry
        ? false
        : 'Chrome or Playwright is not installed',
    timeout: 1500000,
  },
  async () => {
    const report = (await runChrome(
      headroomBundle(),
      headroomPage(),
      1400000,
    )) as unknown as HeadroomReport;
    console.log(report.ua);
    assertGrid(report);
  },
);

void test(
  'Firefox 157 keeps every key and mode, including a sound switch, at or below -1.5 dBFS',
  {
    skip: firefoxBin ? false : 'Firefox 157 is not installed',
    timeout: 1500000,
  },
  async () => {
    const report = (await runFirefox(
      headroomBundle(),
      headroomPage(),
      1400000,
    )) as unknown as HeadroomReport;
    console.log(report.ua);
    assertGrid(report);
  },
);

