import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import * as esbuild from 'esbuild';

const outDir = process.env.DRONE_ARTIFACT_DIR ?? '/opt/cursor/artifacts';
const chromeBin = process.env.CHROME_BIN ?? '/usr/bin/google-chrome-stable';
const port = 8765;
const debugPort = 9334;

const bundled = join(tmpdir(), 'reed-headroom.js');
await esbuild.build({
  entryPoints: ['scripts/reed-headroom-browser.ts'],
  bundle: true,
  format: 'iife',
  outfile: bundled,
  platform: 'browser',
  target: 'chrome120',
  legalComments: 'none',
});

const script = readFileSync(bundled);
const html = `<!doctype html><meta charset="utf-8"><title>reed headroom</title><pre id="status"></pre><script src="/measure.js"></script>`;
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/measure.js') {
    response.writeHead(200, { 'content-type': 'text/javascript' });
    response.end(script);
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end(html);
});
await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

const profile = join(tmpdir(), `chrome-reed-${Date.now()}`);
const chrome = spawn(
  chromeBin,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

function stop() {
  chrome.kill('SIGKILL');
  server.close();
}

try {
  let version;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      version = await fetch(`http://127.0.0.1:${debugPort}/json/version`).then((response) =>
        response.json(),
      );
      break;
    } catch {
      await delay(200);
    }
  }
  if (!version?.webSocketDebuggerUrl) throw new Error('Chrome DevTools did not start.');
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.send('Target.createTarget', { url: `http://127.0.0.1:${port}/measure.html` });
  let pageInfo;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) =>
      response.json(),
    );
    pageInfo = pages.find((page) => page.url.includes('measure.html'));
    if (pageInfo?.webSocketDebuggerUrl) break;
    await delay(100);
  }
  if (!pageInfo?.webSocketDebuggerUrl) throw new Error('The measurement page did not open.');
  const page = await connect(pageInfo.webSocketDebuggerUrl);
  page.ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.consoleAPICalled') {
      const text = message.params.args
        .map((arg) => arg.value ?? arg.description ?? '')
        .join(' ');
      if (text) console.log(text);
    }
  });
  await page.send('Runtime.enable');
  const started = Date.now();
  let report;
  for (;;) {
    if (Date.now() - started > 20 * 60 * 1000) throw new Error('Headroom render timed out.');
    const evaluated = await page.send('Runtime.evaluate', {
      expression: 'window.__report ? JSON.stringify(window.__report) : ""',
      returnByValue: true,
    });
    const value = evaluated.result?.value;
    if (value) {
      report = JSON.parse(value);
      break;
    }
    await delay(1000);
  }
  if (report.error) throw new Error(report.error);
  mkdirSync(outDir, { recursive: true });
  const fixtureDir = join(process.cwd(), 'tests/fixtures');
  mkdirSync(fixtureDir, { recursive: true });
  const json = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(outDir, 'reed-headroom.json'), json);
  writeFileSync(join(fixtureDir, 'reed-headroom.json'), json);
  const clips = [
    ['__clipAlone', 'reed-0.15-alone.wav', 'reed-0.15-alone.mp4'],
    ['__clipNote', 'reed-0.15-single-note.wav', 'reed-0.15-single-note.mp4'],
    ['__clipChord', 'reed-0.15-six-string.wav', 'reed-0.15-six-string.mp4'],
  ];
  for (const [expression, wavName, mp4Name] of clips) {
    const clipEval = await page.send('Runtime.evaluate', {
      expression: `window.${expression} || ""`,
      returnByValue: true,
    });
    const clip = clipEval.result?.value;
    if (!clip) throw new Error(`${expression} was not rendered.`);
    const wavPath = join(outDir, wavName);
    writeFileSync(wavPath, Buffer.from(clip, 'base64'));
    await waveToMp4(wavPath, join(outDir, mp4Name));
  }
  console.log(
    JSON.stringify(
      {
        gain: report.gain,
        bySize: report.bySize,
        drone: report.drone,
        sum: report.sum,
        passes: report.passes,
        nodeCounts: report.nodeCounts,
      },
      null,
      2,
    ),
  );
} finally {
  stop();
}

function waveToMp4(wavPath, mp4Path) {
  mkdirSync(dirname(mp4Path), { recursive: true });
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-y',
        '-i',
        wavPath,
        '-filter_complex',
        '[0:a]showwaves=s=960x240:mode=cline:rate=30:colors=0xC4A574,format=yuv420p[v]',
        '-map',
        '[v]',
        '-map',
        '0:a',
        '-c:v',
        'libx264',
        '-c:a',
        'aac',
        '-shortest',
        mp4Path,
      ],
      { stdio: 'ignore' },
    );
    ffmpeg.on('error', reject);
    ffmpeg.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code} for ${mp4Path}`));
    });
  });
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(JSON.stringify(message.error)));
    else waiter.resolve(message.result);
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        ws,
        send(method, params = {}) {
          const messageId = ++id;
          return new Promise((resolveSend, rejectSend) => {
            pending.set(messageId, { resolve: resolveSend, reject: rejectSend });
            ws.send(JSON.stringify({ id: messageId, method, params }));
          });
        },
      });
    });
    ws.addEventListener('error', () => reject(new Error('DevTools socket failed.')));
  });
}
