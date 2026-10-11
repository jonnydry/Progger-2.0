import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const STEP_LIMIT = 1e-3;
const DRONE_CASES = 96;
const WALK_CASES = 48;
const CASES = DRONE_CASES * 3 + WALK_CASES;

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

type TailResult = {
  name: string;
  fade: number;
  early: number;
  mid: number;
  late: number;
};

type RenderResult = {
  ua: string;
  count: number;
  failureCount: number;
  tails?: TailResult[];
  bySound?: Record<
    string,
    {
      count: number;
      failureCount: number;
      max?: number;
      tail?: number;
      name?: string;
      align?: number;
    }
  >;
  worst: {
    name?: string;
    sound?: string;
    align?: number;
    max?: number;
    prev?: number;
    cur?: number;
    next?: number;
    tailMax?: number;
    window?: number[];
  };
};

function bundleProbe(): string {
  const entry = join(tmpdir(), 'drone-render-entry.ts');
  const outfile = join(tmpdir(), 'drone-probe.js');
  const root = process.cwd();
  writeFileSync(
    entry,
    `export { startMeasuredReed, startMeasuredWalk, startLiveVoice, REED_TIMING, WALK_STOP_FADE, ROOM_SECONDS, TAIL_MARGIN } from '${root}/lib/drone-audio.ts';
export { dronePitches } from '${root}/lib/drone.ts';
`,
  );
  execFileSync(
    join(root, 'node_modules/esbuild/bin/esbuild'),
    [
      entry,
      '--bundle',
      '--format=esm',
      `--outfile=${outfile}`,
      '--platform=browser',
    ],
    { stdio: 'ignore' },
  );
  return outfile;
}

function page(): string {
  return `<!doctype html>
<meta charset="utf-8" />
<script type="module">
import { startMeasuredReed, startMeasuredWalk, startLiveVoice, REED_TIMING, WALK_STOP_FADE, ROOM_SECONDS, TAIL_MARGIN, dronePitches } from '/probe.js';
const SOUNDS = ['reed', 'bow', 'cello'];

const SAMPLE_RATE = 48000;
const STEP_LIMIT = ${STEP_LIMIT};
const GAP = Math.round(0.02 * SAMPLE_RATE);

function cases() {
  const list = [];
  for (let align = 0; align < 48; align += 1) {
    list.push({ name: 'mid-swell key change', align, kind: 'mid' });
    list.push({ name: '0.18s into a later swell', align, kind: 'later' });
  }
  return list;
}

function analyze(data, from) {
  let max = 0;
  let at = from || 1;
  for (let index = from || 1; index < data.length; index += 1) {
    const step = Math.abs(data[index] - data[index - 1]);
    if (step > max) {
      max = step;
      at = index;
    }
  }
  return {
    max,
    prev: data[at - 1],
    cur: data[at],
    next: data[Math.min(data.length - 1, at + 1)],
  };
}

function at(samples) {
  return samples / SAMPLE_RATE;
}

async function render(item, sound) {
  const stopRelease = Math.max(REED_TIMING.stopFade, 0.015);
  let end = 0;
  let interesting = 0;
  const events = [];
  let startVoice;
  if (item.kind === 'mid') {
    const start = 128;
    const boundary = Math.ceil((start + Math.round(1.269 * SAMPLE_RATE)) / 128) * 128;
    interesting = boundary + item.align;
    const stopAt = interesting + GAP;
    const tailNow = stopAt + Math.round(0.35 * SAMPLE_RATE);
    end = tailNow;
    events.push({
      at: boundary,
      run(context, voices) {
        voices.first.stop(at(stopAt), REED_TIMING.switchFade, at(interesting));
        voices.live = startMeasuredReed(
          context,
          context.destination,
          dronePitches('G', 'dorian', 'low'),
          at(stopAt),
          REED_TIMING.switchAttack,
          sound,
        );
      },
    });
    events.push({
      at: tailNow,
      run(_context, voices) {
        voices.live.stop(at(tailNow), REED_TIMING.stopFade, at(tailNow));
      },
    });
    startVoice = (context) =>
      startMeasuredReed(
        context,
        context.destination,
        dronePitches('C', 'ionian', 'low'),
        at(start),
        REED_TIMING.playAttack,
        sound,
      );
  } else {
    const startA = 128;
    const firstStop = 2048;
    const startB = firstStop + GAP;
    const into = startB + Math.round(0.18 * SAMPLE_RATE);
    const boundary = Math.floor(into / 128) * 128;
    interesting = boundary + item.align;
    const stopAt = interesting + GAP;
    const tailNow = stopAt + Math.round(0.35 * SAMPLE_RATE);
    end = tailNow;
    events.push({
      at: firstStop,
      run(context, voices) {
        voices.first.stop(at(startB), REED_TIMING.switchFade, at(firstStop));
        voices.live = startMeasuredReed(
          context,
          context.destination,
          dronePitches('G', 'dorian', 'low'),
          at(startB),
          REED_TIMING.switchAttack,
          sound,
        );
      },
    });
    events.push({
      at: boundary,
      run(context, voices) {
        voices.live.stop(at(stopAt), REED_TIMING.switchFade, at(interesting));
        voices.live = startMeasuredReed(
          context,
          context.destination,
          dronePitches('D', 'mixolydian', 'low'),
          at(stopAt),
          REED_TIMING.switchAttack,
          sound,
        );
      },
    });
    events.push({
      at: tailNow,
      run(_context, voices) {
        voices.live.stop(at(tailNow), REED_TIMING.stopFade, at(tailNow));
      },
    });
    startVoice = (context) =>
      startMeasuredReed(
        context,
        context.destination,
        dronePitches('C', 'ionian', 'low'),
        at(startA),
        REED_TIMING.playAttack,
        sound,
      );
  }
  const length = end + Math.ceil((stopRelease + 0.02) * SAMPLE_RATE) + 128;
  const context = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const voices = { first: startVoice(context), live: null };
  if (typeof context.suspend === 'function') {
    for (const event of events) {
      context.suspend(at(event.at)).then(() => {
        event.run(context, voices);
        return context.resume();
      });
    }
  } else {
    for (const event of events) event.run(context, voices);
  }
  const rendered = await context.startRendering();
  const data = rendered.getChannelData(0);
  const step = analyze(data);
  const silenceAt = end + Math.ceil((stopRelease + 0.02) * SAMPLE_RATE);
  let tail = 0;
  for (let index = Math.min(data.length - 1, silenceAt); index < data.length; index += 1) {
    tail = Math.max(tail, Math.abs(data[index]));
  }
  return {
    name: item.name,
    sound,
    align: item.align,
    max: step.max,
    prev: step.prev,
    cur: step.cur,
    next: step.next,
    tailMax: tail,
    fail: step.max > STEP_LIMIT || tail > STEP_LIMIT,
    window: Array.from(data.slice(Math.max(0, interesting - 1), interesting + 3)),
  };
}

function walkCases() {
  const list = [];
  for (let align = 0; align < ${WALK_CASES}; align += 1) list.push({ align });
  return list;
}

async function renderWalk(item) {
  const start = 128;
  const attackEnd = start + Math.round(0.006 * SAMPLE_RATE);
  const interesting = attackEnd + 64 + item.align;
  const release = Math.max(WALK_STOP_FADE, 0.015);
  const releaseSamples = Math.ceil(release * SAMPLE_RATE);
  const end = interesting + releaseSamples;
  const length = end + 256;
  const context = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const voice = startMeasuredWalk(context, context.destination, at(start));
  const run = () => voice.stop(at(interesting), WALK_STOP_FADE, at(interesting));
  if (typeof context.suspend === 'function') {
    context.suspend(at(interesting)).then(() => {
      run();
      return context.resume();
    });
  } else run();
  const rendered = await context.startRendering();
  const data = rendered.getChannelData(0);
  const step = analyze(data, attackEnd + 2);
  const silenceAt = end + 8;
  let tail = 0;
  for (let index = Math.min(data.length - 1, silenceAt); index < data.length; index += 1) {
    tail = Math.max(tail, Math.abs(data[index]));
  }
  return {
    name: 'walk mid-note stop',
    sound: 'walk',
    align: item.align,
    max: step.max,
    prev: step.prev,
    cur: step.cur,
    next: step.next,
    tailMax: tail,
    fail: step.max > STEP_LIMIT || tail > STEP_LIMIT,
    window: Array.from(data.slice(Math.max(0, interesting - 1), interesting + 3)),
  };
}

function peakBetween(data, from, to) {
  let peak = 0;
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(data.length, Math.ceil(to));
  for (let index = start; index < end; index += 1) {
    peak = Math.max(peak, Math.abs(data[index]));
  }
  return peak;
}

async function renderTail(name, fade) {
  const release = Math.max(fade, 0.015);
  const start = 0.05;
  const stopAt = 0.5;
  const dryEnd = stopAt + release;
  const tailEnd = dryEnd + ROOM_SECONDS + TAIL_MARGIN;
  const seconds = tailEnd + 0.08;
  const context = new OfflineAudioContext(2, Math.ceil(SAMPLE_RATE * seconds), SAMPLE_RATE);
  const voice = startLiveVoice(
    context,
    context.destination,
    dronePitches('C', 'ionian', 'low'),
    start,
    0.2,
    'reed',
  );
  voice.stop(stopAt, fade, stopAt);
  const rendered = await context.startRendering();
  const data = rendered.getChannelData(0);
  const early = peakBetween(data, (dryEnd + 0.02) * SAMPLE_RATE, (dryEnd + 0.1) * SAMPLE_RATE);
  const mid = peakBetween(data, (dryEnd + 0.25) * SAMPLE_RATE, (dryEnd + 0.45) * SAMPLE_RATE);
  const late = peakBetween(data, tailEnd * SAMPLE_RATE, seconds * SAMPLE_RATE);
  return { name, fade, early, mid, late, dryEnd, tailEnd };
}

const rows = [];
for (const sound of SOUNDS) {
  for (const item of cases()) {
    try {
      rows.push(await render(item, sound));
    } catch (error) {
      rows.push({
        name: item.name,
        sound,
        align: item.align,
        fail: true,
        error: String(error && error.message ? error.message : error),
      });
    }
  }
}
for (const item of walkCases()) {
  try {
    rows.push(await renderWalk(item));
  } catch (error) {
    rows.push({
      name: 'walk mid-note stop',
      sound: 'walk',
      align: item.align,
      fail: true,
      error: String(error && error.message ? error.message : error),
    });
  }
}
const tails = [];
for (const item of [
  ['leave', REED_TIMING.hideFade],
  ['toggle off', REED_TIMING.stopFade],
  ['key change', REED_TIMING.switchFade],
]) {
  tails.push(await renderTail(item[0], item[1]));
}
let worst = rows[0];
for (const row of rows) if ((row.max ?? 0) > (worst.max ?? 0)) worst = row;
const failing = rows.filter((row) => row.fail);
const bySound = {};
for (const sound of SOUNDS.concat(['walk'])) {
  const group = rows.filter((row) => row.sound === sound);
  let soundWorst = group[0];
  for (const row of group) {
    if ((row.max ?? 0) > (soundWorst.max ?? 0)) soundWorst = row;
  }
  let tail = 0;
  for (const row of group) tail = Math.max(tail, row.tailMax ?? 0);
  bySound[sound] = {
    count: group.length,
    failureCount: group.filter((row) => row.fail).length,
    max: soundWorst && soundWorst.max,
    tail,
    name: soundWorst && soundWorst.name,
    align: soundWorst && soundWorst.align,
  };
}
const result = {
  ua: navigator.userAgent,
  count: rows.length,
  failureCount: failing.length,
  worst,
  bySound,
  tails,
  errors: failing.slice(0, 3).map((row) => row.error).filter(Boolean),
};
window.__RESULT = result;
await fetch('/result', { method: 'POST', body: JSON.stringify(result) });
document.title = 'done';
</script>`;
}

function serve(
  bundlePath: string,
): Promise<{ server: Server; url: string; result: Promise<string> }> {
  let settle: (body: string) => void = () => {};
  const result = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/probe.js')) {
      res.setHeader('content-type', 'text/javascript');
      res.end(readFileSync(bundlePath));
      return;
    }
    if (url.startsWith('/result') && req.method === 'POST') {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        res.end('ok');
        settle(Buffer.concat(chunks).toString());
        for (const socket of sockets) socket.destroy();
        server.close();
      });
      return;
    }
    res.setHeader('content-type', 'text/html');
    res.end(page());
  });
  return new Promise((resolve) => {
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('no port');
      resolve({ server, url: `http://127.0.0.1:${address.port}/`, result });
    });
  });
}

async function runChrome(bundlePath: string): Promise<RenderResult> {
  if (!chromeBin || !playwrightEntry)
    throw new Error('Chrome harness is unavailable.');
  const { url, result } = await serve(bundlePath);
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
          waitForFunction: (
            fn: () => boolean,
            arg: null,
            options: { timeout: number },
          ) => Promise<unknown>;
          on: (event: string, listener: (error: Error) => void) => void;
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
    tab.on('pageerror', (error) => errors.push(String(error)));
    await tab.goto(url, { waitUntil: 'load', timeout: 120000 });
    await tab.waitForFunction(() => document.title === 'done', null, {
      timeout: 180000,
    });
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`chrome ${browser.version()}`);
  } finally {
    await browser.close();
  }
  return JSON.parse(await result) as RenderResult;
}

async function runFirefox(bundlePath: string): Promise<RenderResult> {
  if (!firefoxBin) throw new Error('Firefox 157 is unavailable.');
  const { url, result } = await serve(bundlePath);
  const profile = join(tmpdir(), 'fx157-reed-profile');
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
    ].join('\n'),
  );
  const version = execFileSync(firefoxBin, ['--version'], {
    encoding: 'utf8',
  }).trim();
  console.log(version);
  const child = spawn(
    firefoxBin,
    ['--headless', '--no-remote', '--profile', profile, url],
    { stdio: 'ignore', detached: true },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const body = await Promise.race([
    result,
    new Promise<string>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Firefox render timed out')),
        180000,
      );
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
  child.unref();
  return JSON.parse(body) as RenderResult;
}

function assertContinuous(result: RenderResult) {
  assert.equal(result.count, CASES);
  assert.equal(result.failureCount, 0, JSON.stringify(result.worst));
  assert.ok((result.worst.max ?? 1) < STEP_LIMIT, JSON.stringify(result.worst));
  assert.ok((result.worst.tailMax ?? 1) <= STEP_LIMIT);
  for (const sound of ['reed', 'bow', 'cello']) {
    const row = result.bySound?.[sound];
    assert.ok(row, sound);
    assert.equal(row.count, DRONE_CASES, sound);
    assert.equal(row.failureCount, 0, JSON.stringify(row));
    assert.ok((row.max ?? 1) < STEP_LIMIT, JSON.stringify(row));
    assert.equal(row.tail, 0, JSON.stringify(row));
  }
  const walk = result.bySound?.walk;
  assert.ok(walk, 'walk');
  assert.equal(walk.count, WALK_CASES);
  assert.equal(walk.failureCount, 0, JSON.stringify(walk));
  assert.ok((walk.max ?? 1) < STEP_LIMIT, JSON.stringify(walk));
  assert.equal(walk.tail, 0, JSON.stringify(walk));
  assert.equal(result.tails?.length, 3);
  for (const tail of result.tails ?? []) {
    assert.ok(tail.early > 1e-4, `${tail.name} early tail ${tail.early}`);
    assert.ok(tail.mid > 1e-5, `${tail.name} mid tail ${tail.mid}`);
    assert.ok(tail.late === 0, `${tail.name} late tail ${tail.late}`);
    console.log(
      `${tail.name} fade ${tail.fade} early ${tail.early} mid ${tail.mid} late ${tail.late}`,
    );
  }
}

void test(
  'Chrome renders every drone sound, including the reed bellows, without a one-sample dip or a hard tail cut',
  {
    skip:
      chromeBin && playwrightEntry
        ? false
        : 'Chrome or Playwright is not installed',
    timeout: 180000,
  },
  async () => {
    const result = await runChrome(bundleProbe());
    console.log(result.ua);
    console.log(JSON.stringify(result.bySound));
    console.log(
      `worst ${result.worst.max} ${result.worst.sound} ${result.worst.name} align ${result.worst.align}`,
    );
    assertContinuous(result);
  },
);

void test(
  'Firefox 157 renders every drone sound, including the reed bellows, without a one-sample dip or a hard tail cut',
  {
    skip: firefoxBin ? false : 'Firefox 157 is not installed',
    timeout: 180000,
  },
  async () => {
    const result = await runFirefox(bundleProbe());
    console.log(result.ua);
    console.log(JSON.stringify(result.bySound));
    console.log(
      `worst ${result.worst.max} ${result.worst.sound} ${result.worst.name} align ${result.worst.align}`,
    );
    assertContinuous(result);
  },
);
