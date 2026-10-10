import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
    if (Date.now() - started > 12 * 60 * 1000) throw new Error('Headroom render timed out.');
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
  writeFileSync(join(outDir, 'reed-headroom.json'), `${JSON.stringify(report, null, 2)}\n`);
  const clipEval = await page.send('Runtime.evaluate', {
    expression: 'window.__clip || ""',
    returnByValue: true,
  });
  const clip = clipEval.result?.value;
  if (!clip) throw new Error('The A Dorian clip was not rendered.');
  writeFileSync(join(outDir, 'drone-reed-a-dorian.wav'), Buffer.from(clip, 'base64'));
  console.log(
    JSON.stringify(
      {
        pluck: report.pluck,
        drone: report.drone,
        sum: report.sum,
        coherent: report.coherent,
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
