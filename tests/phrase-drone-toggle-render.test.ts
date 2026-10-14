import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import { OUTPUT_CEILING } from '../lib/audio-output.ts';
import { launchNamed, type BrowserName } from './browser-launch.ts';

type ToggleReport = {
  ua?: string;
  error?: string;
  mode: 'suspend' | 'immediate';
  openPeak: number;
  limitedPeak: number;
  afterOffPeak: number;
};

function bundle(): string {
  const entry = join(tmpdir(), 'phrase-drone-toggle-entry.ts');
  const outfile = join(tmpdir(), 'phrase-drone-toggle-probe.js');
  const root = process.cwd();
  writeFileSync(
    entry,
    `export { createOutputChain, OUTPUT_CEILING } from '${root}/lib/audio-output.ts';
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
<title>phrase-drone-toggle</title>
<script type="module">
import { createOutputChain, OUTPUT_CEILING } from '/probe.js';

const rate = 48000;

function peakBetween(data, from, until) {
  let peak = 0;
  const start = Math.max(0, Math.floor(from * rate));
  const end = Math.min(data.length, Math.ceil(until * rate));
  for (let index = start; index < end; index += 1) {
    peak = Math.max(peak, Math.abs(data[index]));
  }
  return peak;
}

function hotPhrase(context, chain) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 220;
  gain.gain.value = 1.5;
  oscillator.connect(gain);
  gain.connect(chain.phraseInput);
  oscillator.start(0);
}

async function render(schedule) {
  const context = new OfflineAudioContext(1, rate, rate);
  const chain = createOutputChain(context);
  hotPhrase(context, chain);
  await schedule(context, chain);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0);
}

try {
  const probe = OUTPUT_CEILING;
  if (!(probe > 0.8 && probe < 0.9)) throw new Error('ceiling missing');
  let report;
  const context = new OfflineAudioContext(1, rate, rate);
  if (typeof context.suspend === 'function') {
    const chain = createOutputChain(context);
    hotPhrase(context, chain);
    context.suspend(0.3).then(() => {
      chain.setDrone(true, context.currentTime, 0);
      return context.resume();
    });
    context.suspend(0.7).then(() => {
      chain.setDrone(false, context.currentTime, 0);
      return context.resume();
    });
    const rendered = await context.startRendering();
    const data = rendered.getChannelData(0);
    report = {
      mode: 'suspend',
      openPeak: peakBetween(data, 0.05, 0.25),
      limitedPeak: peakBetween(data, 0.38, 0.64),
      afterOffPeak: peakBetween(data, 0.76, 0.95),
    };
  } else {
    const limited = await render(async (_context, chain) => {
      chain.setDrone(true, 0, 0);
    });
    const open = await render(async (_context, chain) => {
      chain.setDrone(true, 0, 0);
      chain.setDrone(false, 0, 0);
    });
    report = {
      mode: 'immediate',
      openPeak: peakBetween(open, 0.1, 0.9),
      limitedPeak: peakBetween(limited, 0.1, 0.9),
      afterOffPeak: peakBetween(open, 0.1, 0.9),
    };
  }
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify(report),
  });
} catch (error) {
  await fetch('/result', {
    method: 'POST',
    body: JSON.stringify({ error: String(error), mode: 'suspend', openPeak: 0, limitedPeak: 0, afterOffPeak: 0 }),
  });
}
</script>`;
}

function serve(
  bundlePath: string,
): Promise<{ url: string; result: Promise<string> }> {
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
      resolve({ url: `http://127.0.0.1:${address.port}/`, result });
    });
  });
}

async function runNamed(
  name: BrowserName,
  harness: { skip: (reason?: string) => void },
  bundlePath: string,
): Promise<ToggleReport> {
  const browser: Browser = await launchNamed(name, harness);
  try {
    const { url, result } = await serve(bundlePath);
    const tab = await browser.newPage();
    const errors: string[] = [];
    tab.on('pageerror', (error) => errors.push(String(error)));
    await tab.goto(url, { waitUntil: 'load', timeout: 60000 });
    const body = await Promise.race([
      result,
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error(`${name} render timed out`)), 60000);
      }),
    ]);
    if (errors.length) throw new Error(errors.join('\n'));
    const report = JSON.parse(body) as ToggleReport;
    report.ua = await tab.evaluate(() => navigator.userAgent);
    return report;
  } finally {
    await browser.close();
  }
}

function assertRouted(report: ToggleReport) {
  assert.equal(report.error, undefined, report.error);
  assert.ok(
    report.limitedPeak <= OUTPUT_CEILING + 0.002,
    `limited peak ${report.limitedPeak}`,
  );
  assert.ok(
    report.limitedPeak > 0.5,
    `limited peak ${report.limitedPeak} was silent`,
  );
  assert.ok(
    report.openPeak > OUTPUT_CEILING + 0.05,
    `open peak ${report.openPeak} did not leave the limiter`,
  );
  assert.ok(
    report.afterOffPeak > OUTPUT_CEILING + 0.05,
    `after drone off peak ${report.afterOffPeak} went silent or stayed limited`,
  );
  console.log(
    JSON.stringify({
      mode: report.mode,
      openPeak: report.openPeak,
      limitedPeak: report.limitedPeak,
      afterOffPeak: report.afterOffPeak,
      ceiling: OUTPUT_CEILING,
      ua: report.ua,
    }),
  );
}

void test('browser render tests fail in CI when the browser is missing', () => {
  const launch = readFileSync(
    new URL('./browser-launch.ts', import.meta.url),
    'utf8',
  );
  assert.match(launch, /if \(process\.env\.CI\) throw new Error/);
  for (const name of [
    'phrase-drone-toggle-render.test.ts',
    'voicing-bypass-render.test.ts',
    'drone-browser-render.test.ts',
    'drone-peak.test.ts',
  ]) {
    const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
    assert.match(source, /launchNamed\(/);
    assert.equal(source.includes('test' + '.skip('), false, name);
  }
});

void test(
  'Chromium keeps a looping phrase send limited while the drone is on and audible after it turns off',
  { timeout: 120000 },
  async (t) => {
    const report = await runNamed('chromium', t, bundle());
    assert.equal(report.mode, 'suspend');
    assertRouted(report);
  },
);

void test(
  'Firefox keeps a phrase send limited while the drone is on and audible after it turns off',
  { timeout: 120000 },
  async (t) => {
    const report = await runNamed('firefox', t, bundle());
    assertRouted(report);
  },
);
