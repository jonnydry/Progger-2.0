import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { launchNamed, type BrowserName } from './browser-launch.ts';

const STEP_LIMIT = 1e-3;
const DRONE_CASES = 96;
const WALK_CASES = 48;
const CASES = DRONE_CASES * 3 + WALK_CASES;

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
  seams?: {
    file: string;
    step: number;
    bufferStep: number;
    slope: number;
    playbackSlope: number;
    oldSlope: number;
    interiorStep: number;
    decodedLength?: number;
    before: number;
    beforeBody: number;
    after: number;
    body: number;
    playback: number;
  }[];
  switches?: {
    name: string;
    from: string;
    to: string;
    align: number;
    max?: number;
    tailMax?: number;
    fail?: boolean;
  }[];
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
    `export { startMeasuredReed, startMeasuredWalk, startLiveVoice, prepareCelloBuffer, soundLinearCap, REED_TIMING, WALK_STOP_FADE, ROOM_SECONDS, TAIL_MARGIN } from '${root}/lib/drone-audio.ts';
export { dronePitches, celloLoopBounds, celloSeamFade, closeCelloSeam, celloWrapSlopeChange, celloWrapSecondDifference, celloBodySecondDifference, windowSecondDifference } from '${root}/lib/drone.ts';
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
import { startMeasuredReed, startMeasuredWalk, startLiveVoice, prepareCelloBuffer, soundLinearCap, REED_TIMING, WALK_STOP_FADE, ROOM_SECONDS, TAIL_MARGIN, dronePitches, celloLoopBounds, celloSeamFade, closeCelloSeam, celloWrapSlopeChange, celloWrapSecondDifference, celloBodySecondDifference, windowSecondDifference } from '/probe.js';
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

const CELLO_FILES = ['cello-d2.m4a','cello-a2.m4a','cello-e3.m4a','cello-b3.m4a','cello-f4.m4a'];

function seamAt390370f(samples, fadeSamples) {
  const out = samples.slice();
  const fade = Math.min(Math.max(1, fadeSamples), out.length - 1);
  const delta = out[0] - out[out.length - 1];
  for (let index = 0; index < fade; index += 1) {
    const progress = (index + 1) / fade;
    const weight = Math.sin((progress * Math.PI) / 2);
    out[out.length - fade + index] += delta * weight;
  }
  return out;
}

function seamQuarterSine(samples, fadeSamples) {
  const out = samples.slice();
  const fade = Math.min(Math.max(1, fadeSamples), out.length - 1);
  const target = 2 * out[0] - out[1];
  const delta = target - out[out.length - 1];
  for (let index = 0; index < fade; index += 1) {
    const progress = (index + 1) / fade;
    const weight = Math.sin((progress * Math.PI) / 2);
    out[out.length - fade + index] += delta * weight;
  }
  return out;
}

function copyMono(buffer) {
  const channel = new Float32Array(buffer.length);
  buffer.copyFromChannel(channel, 0);
  return channel;
}

async function measureSeam(file) {
  const decodeContext = new AudioContext({ sampleRate: 44100 });
  try {
    const bytes = await (await fetch('/audio/drone/' + file)).arrayBuffer();
    const decoded = await decodeContext.decodeAudioData(bytes.slice(0));
    const decodedChannel = copyMono(decoded);
    const bounds = celloLoopBounds(decoded.length, decoded.sampleRate);
    const body = decodedChannel.slice(bounds.start, bounds.end);
    const fade = celloSeamFade(decoded.sampleRate, body.length);
    const previous = seamAt390370f(body, fade);
    const quarter = seamQuarterSine(body, fade);
    const closed = closeCelloSeam(body, fade);
    const prepared = prepareCelloBuffer(decodeContext, decoded);
    const channel = copyMono(prepared);
    const bufferStep = Math.abs(channel[0] - channel[channel.length - 1]);
    const interiorStep = Math.abs(channel[1] - channel[0]);
    const rate = prepared.sampleRate;
    const tail = 8;
    const context = new OfflineAudioContext(1, channel.length + tail, rate);
    const source = context.createBufferSource();
    source.buffer = prepared;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = prepared.duration;
    source.connect(context.destination);
    source.start(0);
    const rendered = await context.startRendering();
    const data = new Float32Array(rendered.length);
    rendered.copyFromChannel(data, 0);
    const at = channel.length;
    const step = Math.abs(data[at] - data[at - 1]);
    const playbackSlope = (data[at + 1] - data[at]) - (data[at] - data[at - 1]);
    return {
      file,
      step,
      bufferStep,
      interiorStep,
      slope: celloWrapSlopeChange(closed),
      playbackSlope,
      oldSlope: celloWrapSlopeChange(previous),
      before: celloWrapSecondDifference(quarter),
      beforeBody: celloBodySecondDifference(quarter),
      after: celloWrapSecondDifference(closed),
      body: celloBodySecondDifference(closed),
      playback: windowSecondDifference(data, at, 8),
      decodedLength: decoded.length,
      around: Array.from(data.slice(at - 2, at + 3)),
    };
  } finally {
    void decodeContext.close();
  }
}

function switchCases() {
  const pairs = [
    ['reed', 'bow'],
    ['reed', 'cello'],
    ['bow', 'reed'],
    ['bow', 'cello'],
    ['cello', 'reed'],
    ['cello', 'bow'],
  ];
  const list = [];
  for (const pair of pairs) {
    for (const kind of ['mid', 'settled']) {
      for (let align = 0; align < 24; align += 1) {
        list.push({ from: pair[0], to: pair[1], kind, align });
      }
    }
  }
  return list;
}

async function renderSwitch(item) {
  const start = 128;
  const into = item.kind === 'mid'
    ? Math.round(1.269 * SAMPLE_RATE)
    : Math.round((REED_TIMING.playAttack + 0.75) * SAMPLE_RATE);
  const boundary = item.kind === 'mid'
    ? Math.ceil((start + into) / 128) * 128
    : Math.floor((start + into) / 128) * 128;
  const interesting = boundary + item.align;
  const stopAt = interesting + GAP;
  const release = Math.max(REED_TIMING.switchFade, 0.015);
  const tailNow = stopAt + Math.round(0.35 * SAMPLE_RATE);
  const end = tailNow;
  const pitches = dronePitches('C', 'ionian', 'low');
  const length = end + Math.ceil((Math.max(REED_TIMING.stopFade, 0.015) + 0.02) * SAMPLE_RATE) + 128;
  const context = new OfflineAudioContext(2, length, SAMPLE_RATE);
  const voices = {
    first: startMeasuredReed(
      context,
      context.destination,
      pitches,
      at(start),
      REED_TIMING.playAttack,
      item.from,
      soundLinearCap(item.from),
    ),
    live: null,
  };
  const events = [
    {
      at: interesting,
      run(ctx, held) {
        held.first.stop(at(stopAt), REED_TIMING.switchFade, at(interesting));
        held.live = startMeasuredReed(
          ctx,
          ctx.destination,
          pitches,
          at(stopAt),
          REED_TIMING.switchAttack,
          item.to,
          soundLinearCap(item.to),
        );
      },
    },
    {
      at: tailNow,
      run(_ctx, held) {
        held.live.stop(at(tailNow), REED_TIMING.stopFade, at(tailNow));
      },
    },
  ];
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
  const data = new Float32Array(rendered.length);
  rendered.copyFromChannel(data, 0);
  const step = analyze(data);
  const silenceAt = end + Math.ceil((Math.max(REED_TIMING.stopFade, 0.015) + 0.02) * SAMPLE_RATE);
  let tail = 0;
  for (let index = Math.min(data.length - 1, silenceAt); index < data.length; index += 1) {
    tail = Math.max(tail, Math.abs(data[index]));
  }
  const name = item.kind === 'mid' ? 'mid-swell sound switch' : 'settled sound switch';
  return {
    name,
    from: item.from,
    to: item.to,
    align: item.align,
    max: step.max,
    tailMax: tail,
    fail: step.max > STEP_LIMIT || tail > STEP_LIMIT,
  };
}

const seams = [];
for (const file of CELLO_FILES) seams.push(await measureSeam(file));

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
const switches = [];
for (const item of switchCases()) {
  try {
    switches.push(await renderSwitch(item));
  } catch (error) {
    switches.push({
      name: item.kind === 'mid' ? 'mid-swell sound switch' : 'settled sound switch',
      from: item.from,
      to: item.to,
      align: item.align,
      fail: true,
      error: String(error && error.message ? error.message : error),
    });
  }
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
  seams,
  switches,
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
    if (url.startsWith('/audio/drone/')) {
      const file = decodeURIComponent(
        url.slice('/audio/drone/'.length).split('?')[0] ?? '',
      );
      const audioDir = join(process.cwd(), 'public/audio/drone');
      const path = join(audioDir, file);
      if (
        file.length === 0 ||
        file !== file.split('/').pop() ||
        file.includes('..') ||
        !path.startsWith(`${audioDir}/`) ||
        !existsSync(path)
      ) {
        res.statusCode = 404;
        res.end('missing');
        return;
      }
      res.setHeader('content-type', 'audio/mp4');
      res.end(readFileSync(path));
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

async function runNamed(
  name: BrowserName,
  harness: { skip: (reason?: string) => void },
  bundlePath: string,
): Promise<RenderResult> {
  const browser = await launchNamed(name, harness);
  try {
    const { url, result } = await serve(bundlePath);
    const tab = await browser.newPage();
    const errors: string[] = [];
    tab.on('pageerror', (error) => errors.push(String(error)));
    tab.on('console', (message) => console.log(message.text()));
    await tab.goto(url, { waitUntil: 'load', timeout: 120000 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const body = await Promise.race([
      result,
      new Promise<string>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${name} render timed out`)),
          480000,
        );
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (errors.length) throw new Error(errors.join('\n'));
    console.log(`${name} ${browser.version()}`);
    return JSON.parse(body) as RenderResult;
  } finally {
    await browser.close();
  }
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
  assert.equal(result.seams?.length, 5);
  const slopeLimit = 1e-6;
  for (const seam of result.seams ?? []) {
    assert.equal(seam.decodedLength, 94815, JSON.stringify(seam));
    assert.ok(Number.isFinite(seam.step), JSON.stringify(seam));
    assert.ok(
      Math.abs(seam.slope) < slopeLimit,
      `${seam.file} slope ${seam.slope}`,
    );
    assert.ok(
      Math.abs(seam.playbackSlope) < slopeLimit,
      `${seam.file} playback slope ${seam.playbackSlope}`,
    );
    assert.ok(
      Math.abs(seam.oldSlope) > 1e-3,
      `${seam.file} 390370f slope ${seam.oldSlope} should fail`,
    );
    assert.ok(
      seam.after <= seam.body + 1e-6,
      `${seam.file} after ${seam.after} body ${seam.body}`,
    );
    assert.ok(
      seam.playback <= seam.body + 1e-4,
      `${seam.file} playback curvature ${seam.playback} body ${seam.body}`,
    );
    if (
      seam.file === 'cello-d2.m4a' ||
      seam.file === 'cello-e3.m4a' ||
      seam.file === 'cello-f4.m4a'
    ) {
      assert.ok(
        seam.before > seam.beforeBody,
        `${seam.file} quarter-sine ${seam.before} should exceed body ${seam.beforeBody}`,
      );
    }
    console.log(
      `${seam.file} before ${seam.before} body ${seam.beforeBody} after ${seam.after} playback ${seam.playback} body ${seam.body} slope ${seam.slope} old ${seam.oldSlope}`,
    );
  }
  assert.equal(result.switches?.length, 6 * 2 * 24);
  for (const row of result.switches ?? []) {
    assert.equal(row.fail, false, JSON.stringify(row));
    assert.ok((row.max ?? 1) < STEP_LIMIT, JSON.stringify(row));
    assert.ok((row.tailMax ?? 1) <= STEP_LIMIT, JSON.stringify(row));
  }
  const switchWorst = (result.switches ?? []).reduce((best, row) =>
    (row.max ?? 0) > (best.max ?? 0) ? row : best,
  );
  console.log(
    `sound switch worst ${switchWorst.max} ${switchWorst.from} to ${switchWorst.to} ${switchWorst.name} align ${switchWorst.align}`,
  );
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
  { timeout: 480000 },
  async (t) => {
    const result = await runNamed('chromium', t, bundleProbe());
    console.log(result.ua);
    console.log(JSON.stringify(result.bySound));
    console.log(
      `worst ${result.worst.max} ${result.worst.sound} ${result.worst.name} align ${result.worst.align}`,
    );
    assertContinuous(result);
  },
);

void test(
  'Firefox renders every drone sound, including the reed bellows, without a one-sample dip or a hard tail cut',
  { timeout: 480000 },
  async (t) => {
    const result = await runNamed('firefox', t, bundleProbe());
    console.log(result.ua);
    console.log(JSON.stringify(result.bySound));
    console.log(
      `worst ${result.worst.max} ${result.worst.sound} ${result.worst.name} align ${result.worst.align}`,
    );
    assertContinuous(result);
  },
);
