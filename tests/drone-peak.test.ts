import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { FULL_SCALE_MARGIN } from '../lib/drone-levels.ts';

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
};

type PeakReport = {
  ua?: string;
  error?: string;
  walkPeak: number;
  walkMidi: number;
  rows: PeakRow[];
  together: Record<string, number>;
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
} from '${root}/lib/drone-audio.ts';
export { dronePitches } from '${root}/lib/drone.ts';
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
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index]));
    }
  }
  return peak;
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
  if (walk) startWalkPluck(context, limiter, walk.midi, when + 0.2, 1);
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
  const peak = peakOf(await context.startRendering());
  return { peak, voice };
}

try {
  const decodeCtx = new AudioContext();
  const buffers = new Map();
  for (const file of files) {
    const bytes = await (await fetch('/audio/' + file)).arrayBuffer();
    const decoded = await decodeCtx.decodeAudioData(bytes.slice(0));
    buffers.set(file, prepareCelloBuffer(decodeCtx, decoded));
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
            if (value > crossed) {
              crossed = value;
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
          rows.push({ root, mode, octave, sound, limited, via, gap: crossGap });
          if (rows.length % 12 === 0) console.log('measured ' + rows.length);
        }
      }
    }
  }
  let walkPeak = 0;
  let walkMidi = 60;
  for (let midi = 60; midi <= 83; midi += 1) {
    const rate = 48000;
    const context = new OfflineAudioContext(2, Math.ceil(rate * 0.08), rate);
    const { limiter } = graph(context, 'reed');
    startWalkPluck(context, limiter, midi, 0.01, 1);
    const value = peakOf(await context.startRendering());
    if (value > walkPeak) {
      walkPeak = value;
      walkMidi = midi;
    }
  }
  const together = {};
  for (const sound of ['reed', 'bow', 'cello']) {
    const row = rows
      .filter((item) => item.sound === sound)
      .reduce((best, item) => (item.limited > best.limited ? item : best));
    const withWalk =
      row.via === 'crossfade'
        ? await renderOverlap(
            buffers,
            row.root,
            row.mode,
            row.octave,
            sound,
            row.gap,
            { midi: walkMidi },
          )
        : (
            await renderVoice(
              buffers,
              row.root,
              row.mode,
              row.octave,
              sound,
              row.via === 'sustain' ? 1.6 : 0.2,
              (row.via === 'sustain' ? 1.6 : 0.2) + 1.4,
              {
                midi: walkMidi,
                at: 0.05 + (row.via === 'sustain' ? 1.6 : 0.2),
              },
            )
          ).peak;
    together[sound] = withWalk;
  }
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({
      ua: navigator.userAgent,
      walkPeak,
      walkMidi,
      rows,
      together,
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

function serve(bundlePath: string): Promise<{
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
    res.end(page());
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

async function waitForReport(result: Promise<string>): Promise<PeakReport> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = await Promise.race([
    result,
    new Promise<string>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Peak render timed out')),
        240000,
      );
    }),
  ]);
  if (timer) clearTimeout(timer);
  return JSON.parse(body) as PeakReport;
}

async function runChrome(bundlePath: string): Promise<PeakReport> {
  if (!chromeBin || !playwrightEntry) throw new Error('Chrome harness is unavailable.');
  const { url, result, close } = await serve(bundlePath);
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
    const report = await waitForReport(result);
    console.log(`chrome ${browser.version()}`);
    if (errors.length && !report.error) report.error = errors.join('\n');
    return report;
  } finally {
    await browser.close();
    close();
  }
}

async function runFirefox(bundlePath: string): Promise<PeakReport> {
  if (!firefoxBin) throw new Error('Firefox 157 is unavailable.');
  const { url, result, close } = await serve(bundlePath);
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
    return await waitForReport(result);
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
    console.log(
      `${sound} ${row.root} ${row.mode} ${row.octave} ${row.via} gap ${row.gap} peak ${row.limited} + pluck ${pluck} = ${sum} walk ${report.walkPeak} (midi ${report.walkMidi}) together ${report.together[sound]}`,
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
    timeout: 240000,
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
    timeout: 240000,
  },
  async () => {
    const pluck = pluckAttackLevel();
    const report = await runFirefox(bundleProbe());
    console.log(report.ua);
    assertHeadroom(report, pluck);
  },
);
