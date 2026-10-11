import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const firefoxBin = ['/tmp/firefox-157/firefox/firefox'].find((path) =>
  existsSync(path),
);

type OpusReport = {
  ua?: string;
  error?: string;
  audioAtStart?: number;
  contextState?: string;
  canPlay?: { aac: string; opus: string };
  natural?: string[];
  opusPeaks?: { href: string; peak: number; samples: number; rate: number }[];
  aac?: string;
  fallback?: string;
};

function bundleProbe(): string {
  const outfile = join(tmpdir(), 'cello-opus-probe.js');
  execFileSync(
    join(process.cwd(), 'node_modules/esbuild/bin/esbuild'),
    [
      'tests/cello-opus-probe.ts',
      '--bundle',
      '--format=iife',
      '--platform=browser',
      `--outfile=${outfile}`,
    ],
    { cwd: process.cwd(), stdio: 'inherit' },
  );
  return outfile;
}

function page(): string {
  return `<!doctype html>
<meta charset="utf-8">
<title>Cello opus</title>
<script src="/probe.js"></script>
<script>
  window.addEventListener('load', () => {
    fetch('/ready', { method: 'POST' });
    setTimeout(() => window.startCello(), 600);
  });
</script>`;
}

function serve(bundlePath: string): Promise<{
  url: string;
  result: Promise<string>;
  audioTimes: number[];
  readyAt: Promise<number>;
  close: () => void;
}> {
  let settle: (body: string) => void = () => {};
  const result = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const sockets = new Set<Socket>();
  const audioDir = join(process.cwd(), 'public/audio/drone');
  const started = Date.now();
  const audioTimes: number[] = [];
  let markReady: (elapsed: number) => void = () => {};
  const readyAt = new Promise<number>((resolve) => {
    markReady = resolve;
  });
  const server = createServer((req, res) => {
    const url = req.url ?? '/';
    if (url.startsWith('/probe.js')) {
      res.setHeader('content-type', 'text/javascript');
      res.end(readFileSync(bundlePath));
      return;
    }
    if (url.startsWith('/audio/')) {
      audioTimes.push(Date.now() - started);
      const file = decodeURIComponent(
        url.slice('/audio/drone/'.length).split('?')[0] ?? '',
      );
      const path = join(audioDir, file);
      if (!existsSync(path)) {
        res.statusCode = 404;
        res.end('missing');
        return;
      }
      const type = file.endsWith('.webm') ? 'audio/webm' : 'audio/mp4';
      res.setHeader('content-type', type);
      res.end(readFileSync(path));
      return;
    }
    if (url.startsWith('/ready') && req.method === 'POST') {
      markReady(Date.now() - started);
      res.end('ok');
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
        url: `http://127.0.0.1:${address.port}/`,
        result,
        audioTimes,
        readyAt,
        close,
      });
    });
  });
}

function firefoxProfile(): string {
  const profile = join(tmpdir(), 'fx157-cello-opus');
  execFileSync('rm', ['-rf', profile]);
  execFileSync('mkdir', ['-p', profile]);
  writeFileSync(
    join(profile, 'user.js'),
    [
      'user_pref("browser.shell.checkDefaultBrowser", false);',
      'user_pref("browser.aboutwelcome.enabled", false);',
      'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);',
      'user_pref("termsofuse.bypassNotification", true);',
      'user_pref("datareporting.policy.dataSubmissionEnabled", false);',
      'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);',
      'user_pref("browser.startup.homepage_override.mstone", "ignore");',
      'user_pref("media.cubeb.sandbox", false);',
    ].join('\n'),
  );
  return profile;
}

async function launchFirefox(url: string): Promise<{
  stop: () => void;
}> {
  const profile = firefoxProfile();
  const child = spawn(
    firefoxBin!,
    ['--headless', '--no-remote', '--profile', profile, url],
    { stdio: 'ignore', detached: true },
  );
  return {
    stop() {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
      child.unref();
    },
  };
}

void test(
  'Firefox 157 decodes the Opus cello loops and fetches no audio on first load',
  { skip: firefoxBin ? false : 'Firefox 157 is not installed', timeout: 60000 },
  async () => {
    const bundle = bundleProbe();
    const { url, result, audioTimes, readyAt, close } = await serve(bundle);
    console.log(
      execFileSync(firefoxBin!, ['--version'], { encoding: 'utf8' }).trim(),
    );
    const firefox = await launchFirefox(url);
    let report: OpusReport;
    let ready = 0;
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const body = await Promise.race([
        result,
        new Promise<string>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Firefox cello probe timed out')),
            40000,
          );
        }),
      ]);
      if (timer) clearTimeout(timer);
      report = JSON.parse(body) as OpusReport;
      ready = await readyAt;
    } finally {
      firefox.stop();
      close();
    }
    assert.equal(report.error, undefined, report.error);
    assert.match(report.ua ?? '', /Firefox\/157/);
    assert.equal(report.audioAtStart, 0);
    assert.ok(
      audioTimes[0] >= ready + 450,
      `audio at ${audioTimes[0]} ms, page ready at ${ready} ms`,
    );
    assert.equal(report.canPlay?.opus, 'probably');
    assert.deepEqual(report.natural, ['m4a', 'opus']);
    assert.equal(report.opusPeaks?.length, 5);
    for (const loop of report.opusPeaks ?? []) {
      assert.ok(loop.href.endsWith('.webm'), loop.href);
      assert.ok(loop.peak > 0.2, `${loop.href} peak ${loop.peak}`);
      assert.ok(loop.samples > 40000, `${loop.href} samples ${loop.samples}`);
    }
    assert.equal(report.fallback, 'opus-after-aac-failure');
    assert.equal(report.aac === 'ok' || report.aac === 'EncodingError', true);
    console.log(
      JSON.stringify(
        {
          ua: report.ua,
          canPlay: report.canPlay,
          natural: report.natural,
          contextState: report.contextState,
          audioAtStart: report.audioAtStart,
          readyMs: ready,
          firstAudioMs: audioTimes[0],
          aac: report.aac,
          fallback: report.fallback,
          opusPeaks: report.opusPeaks,
        },
        null,
        2,
      ),
    );
  },
);

type Marionette = {
  send: (name: string, params: Record<string, unknown>) => Promise<unknown>;
  close: () => void;
};

function marionette(): Promise<Marionette> {
  const socket = net.connect(2828, '127.0.0.1');
  let buf = Buffer.alloc(0);
  const waiters: ((value: unknown) => void)[] = [];
  let nextId = 0;
  function pump(): void {
    while (true) {
      const sep = buf.indexOf(58);
      if (sep < 0) return;
      const len = Number(buf.slice(0, sep).toString());
      if (!Number.isFinite(len) || buf.length < sep + 1 + len) return;
      const body = JSON.parse(buf.slice(sep + 1, sep + 1 + len).toString()) as unknown;
      buf = buf.slice(sep + 1 + len);
      const waiter = waiters.shift();
      if (waiter) waiter(body);
    }
  }
  socket.on('data', (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    pump();
  });
  return new Promise((resolve, reject) => {
    socket.once('error', reject);
    waiters.push(() => {
      resolve({
        async send(name, params) {
          nextId += 1;
          const id = nextId;
          const payload = JSON.stringify([0, id, name, params]);
          socket.write(`${Buffer.byteLength(payload)}:${payload}`);
          const message = (await new Promise<unknown>((done) => {
            waiters.push(done);
          })) as [
            number,
            number,
            { error?: string; message?: string } | null,
            unknown,
          ];
          if (message[2]) {
            throw new Error(message[2].message ?? message[2].error ?? name);
          }
          return message[3];
        },
        close() {
          socket.end();
        },
      });
    });
  });
}

void test(
  'the app first load in Firefox 157 fetches no cello audio',
  { skip: firefoxBin ? false : 'Firefox 157 is not installed', timeout: 60000 },
  async () => {
    const home = await fetch('http://[::1]:3000/').catch(() => null);
    if (!home || !home.ok) {
      throw new Error('The dev server is not answering on port 3000.');
    }
    const profile = firefoxProfile();
    writeFileSync(
      join(profile, 'user.js'),
      `${readFileSync(join(profile, 'user.js'), 'utf8')}\nuser_pref("marionette.port", 2828);\n`,
    );
    const child = spawn(
      firefoxBin!,
      ['--headless', '--marionette', '--no-remote', '--profile', profile, 'about:blank'],
      { stdio: 'ignore', detached: true },
    );
    let session: Marionette | null = null;
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        try {
          session = await marionette();
          break;
        } catch (error) {
          if (attempt === 29) throw error;
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }
      if (!session) throw new Error('Marionette did not connect.');
      await session.send('WebDriver:NewSession', {
        capabilities: {
          alwaysMatch: { browserName: 'firefox', acceptInsecureCerts: true },
        },
      });
      await session.send('WebDriver:Navigate', { url: 'http://[::1]:3000/' });
      let toggle = false;
      for (let wait = 0; wait < 20 && !toggle; wait += 1) {
        const result = (await session.send('WebDriver:ExecuteScript', {
          script: 'return document.querySelector("#drone-toggle") ? "yes" : "no"',
          args: [],
        })) as { value?: string };
        toggle = result.value === 'yes';
        if (!toggle) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.equal(toggle, true);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const resources = (await session.send('WebDriver:ExecuteScript', {
        script:
          'return performance.getEntriesByType("resource").map((entry) => entry.name)',
        args: [],
      })) as { value?: string[] };
      const names = resources.value ?? [];
      const audio = names.filter((name) => name.includes('/audio/'));
      assert.deepEqual(audio, []);
      console.log(`app resources ${names.length}, audio ${audio.length}`);
    } finally {
      session?.close();
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGTERM');
        } catch {
          child.kill('SIGTERM');
        }
      }
      child.unref();
    }
  },
);
