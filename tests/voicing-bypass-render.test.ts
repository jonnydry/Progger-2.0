import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import { launchNamed, type BrowserName } from './browser-launch.ts';

/**
 * Chromium's offline renderer repeats an identical graph with single-ulp
 * float32 differences. Firefox repeats it exactly. The Chrome bound is one
 * float32 ulp at full scale, the same ceiling as rendering the direct path twice.
 */
const CHROME_ULP = 2 ** -23;

type Diff = { count: number; max: number };

type BypassReport = {
  ua?: string;
  error?: string;
  chords: {
    frets: string;
    samples: number;
    idle: Diff;
    snap: Diff;
    proxy: Diff;
    limited: Diff;
    repeat: Diff;
  }[];
  fadeDelta: number;
  steadyDelta: number;
};

function bundle(): string {
  const entry = join(tmpdir(), 'voicing-bypass-entry.ts');
  const outfile = join(tmpdir(), 'voicing-bypass-probe.js');
  const root = process.cwd();
  writeFileSync(
    entry,
    `export { scheduleVoicing } from '${root}/lib/voicing-audio.ts';
export { createOutputChain, voicingContext } from '${root}/lib/audio-output.ts';
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
<title>voicing-bypass</title>
<script type="module">
import { scheduleVoicing, createOutputChain, voicingContext } from '/probe.js';

const rate = 48000;
const seconds = 1;
const length = rate * seconds;
const chords = [
  [null, null, null, 14, 15, 13],
  [null, null, 6, 5, 4, null],
  [null, 3, 2, 0, 1, 0],
  [0, 2, 2, 1, 0, 0],
];

function render(schedule) {
  const context = new OfflineAudioContext(2, length, rate);
  schedule(context);
  return context.startRendering();
}

function channels(buffer) {
  const data = [];
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    data.push(buffer.getChannelData(channel));
  }
  return data;
}

function diff(left, right) {
  let count = 0;
  let max = 0;
  if (left.length !== right.length) return { count: -1, max: Infinity };
  for (let channel = 0; channel < left.length; channel += 1) {
    const a = left[channel];
    const b = right[channel];
    if (a.length !== b.length) return { count: -1, max: Infinity };
    for (let index = 0; index < a.length; index += 1) {
      if (a[index] !== b[index]) count += 1;
      const delta = Math.abs(a[index] - b[index]);
      if (delta > max) max = delta;
    }
  }
  return { count, max };
}

function maxStep(buffer, from, until) {
  let step = 0;
  const start = Math.floor(from * rate);
  const end = Math.min(buffer[0].length - 1, Math.ceil(until * rate));
  for (const data of buffer) {
    for (let index = start; index < end; index += 1) {
      const delta = Math.abs(data[index + 1] - data[index]);
      if (delta > step) step = delta;
    }
  }
  return step;
}

try {
  const rows = [];
  for (const frets of chords) {
    const direct = channels(await render((context) => {
      scheduleVoicing(context, frets, 0.05, context.destination);
    }));
    const idle = channels(await render((context) => {
      const chain = createOutputChain(context);
      scheduleVoicing(context, frets, 0.05, chain.voicingTarget());
    }));
    const snap = channels(await render((context) => {
      const chain = createOutputChain(context);
      chain.setDrone(true, 0, 0);
      chain.setDrone(false, 0, 0);
      scheduleVoicing(context, frets, 0.05, chain.voicingTarget());
    }));
    const proxy = channels(await render((context) => {
      const chain = createOutputChain(context);
      const voiced = voicingContext(context, chain);
      scheduleVoicing(voiced, frets, 0.05, voiced.destination);
    }));
    const limited = channels(await render((context) => {
      const chain = createOutputChain(context);
      chain.setDrone(true, 0, 0);
      scheduleVoicing(context, frets, 0.05, chain.voicingTarget());
    }));
    const repeat = channels(await render((context) => {
      scheduleVoicing(context, frets, 0.05, context.destination);
    }));
    rows.push({
      frets: frets.map((fret) => (fret === null ? 'x' : String(fret))).join(','),
      samples: direct[0].length * direct.length,
      idle: diff(direct, idle),
      snap: diff(direct, snap),
      proxy: diff(direct, proxy),
      limited: diff(direct, limited),
      repeat: diff(direct, repeat),
    });
  }
  const faded = channels(await render((context) => {
    const chain = createOutputChain(context);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    gain.gain.value = 0.4;
    oscillator.frequency.value = 440;
    oscillator.connect(gain);
    gain.connect(chain.bus);
    chain.setDrone(true, 0, 0);
    chain.setDrone(false, 0.05, 0.02);
    chain.setDrone(true, 0.12, 0.02);
    oscillator.start(0);
    oscillator.stop(0.2);
  }));
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({
      ua: navigator.userAgent,
      chords: rows,
      fadeDelta: Math.max(maxStep(faded, 0.05, 0.07), maxStep(faded, 0.12, 0.14)),
      steadyDelta: maxStep(faded, 0.08, 0.11),
    }),
  });
  document.title = 'done';
} catch (error) {
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ error: String(error && error.stack ? error.stack : error), chords: [] }),
  });
  document.title = 'done';
}
</script>`;
}

function serve(bundlePath: string): Promise<{
  url: string;
  result: Promise<string>;
  close: () => void;
}> {
  let settle: (body: string) => void = () => {};
  const result = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const sockets = new Set<Socket>();
  const server: Server = createServer((req, res) => {
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
      resolve({ url: `http://127.0.0.1:${address.port}/`, result, close });
    });
  });
}

function assertIdentical(name: BrowserName, label: string, found: Diff) {
  if (name === 'firefox') {
    assert.equal(found.count, 0, `${label} ${found.count}`);
    assert.equal(found.max, 0, `${label} max ${found.max}`);
    return;
  }
  assert.ok(
    found.max <= CHROME_ULP,
    `${label} max ${found.max} exceeds one float32 ulp`,
  );
}

function assertBypass(name: BrowserName, report: BypassReport) {
  assert.equal(report.error, undefined, report.error);
  assert.equal(report.chords.length, 4);
  for (const row of report.chords) {
    assertIdentical(name, `${row.frets} idle`, row.idle);
    assertIdentical(name, `${row.frets} snap`, row.snap);
    assertIdentical(name, `${row.frets} proxy`, row.proxy);
    assertIdentical(name, `${row.frets} repeat`, row.repeat);
    assert.ok(row.limited.max > 0.01, `${row.frets} limiter delta ${row.limited.max}`);
    console.log(
      `bypass ${name} ${row.frets} idle ${row.idle.count}/${row.idle.max} snap ${row.snap.count}/${row.snap.max} proxy ${row.proxy.count}/${row.proxy.max} repeat ${row.repeat.count}/${row.repeat.max} limited ${row.limited.max}`,
    );
  }
  assert.ok(report.steadyDelta > 0.005, `steady ${report.steadyDelta}`);
  assert.ok(
    report.fadeDelta < report.steadyDelta * 3,
    `crossfade step ${report.fadeDelta} vs steady ${report.steadyDelta}`,
  );
  console.log(`${name} crossfade step ${report.fadeDelta} steady ${report.steadyDelta}`);
}

async function renderInBrowser(browser: Browser, bundlePath: string): Promise<BypassReport> {
  const { url, result, close } = await serve(bundlePath);
  try {
    const tab = await browser.newPage();
    const errors: string[] = [];
    tab.on('pageerror', (error) => errors.push(error.message));
    await tab.goto(url, { waitUntil: 'load', timeout: 60000 });
    const body = await Promise.race([
      result,
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('bypass render timed out')), 60000);
      }),
    ]);
    const report = JSON.parse(body) as BypassReport;
    if (errors.length && !report.error) report.error = errors.join('\n');
    return report;
  } finally {
    close();
  }
}

for (const name of ['chromium', 'firefox'] as const) {
  void test(
    `${name} voicing with the drone off matches a direct render sample for sample`,
    { timeout: 120000 },
    async (t) => {
      const browser = await launchNamed(name satisfies BrowserName, t);
      try {
        const report = await renderInBrowser(browser, bundle());
        console.log(report.ua);
        assertBypass(name, report);
      } finally {
        await browser.close();
      }
    },
  );
}
