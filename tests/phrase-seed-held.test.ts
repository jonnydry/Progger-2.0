import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { parseSeed } from '../lib/phrase.ts';
import { launchNamed } from './browser-launch.ts';

const LOADED_SEED = 17;

type SeedProbe = {
  releases: number;
  seed: string;
  stash: boolean;
  open: boolean;
};

function readProbe(page: Page): Promise<SeedProbe> {
  return page.evaluate(() => {
    const probe = (window as unknown as { __seedHeld?: { releases: number } })
      .__seedHeld;
    const input =
      document.querySelector<HTMLInputElement>('.phrase-seed input');
    const body = document.body.textContent ?? '';
    return {
      releases: probe?.releases ?? -1,
      seed: input?.value ?? '',
      stash: body.includes('StashTone'),
      open: document.querySelector('.deck-seed')?.hasAttribute('open') ?? false,
    };
  });
}

function settle(page: Page) {
  return page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

/**
 * Mounts PhrasePanel on a loaded stash phrase. Opening Seed focuses the
 * field. Copy seed and blur both commit that text. The commit must keep
 * the held phrase when the text still parses as the current seed. A
 * different seed still releases it.
 */
void test(
  'a loaded stash phrase survives an unchanged seed disclosure, copy, and blur',
  { timeout: 60_000 },
  async (t) => {
    const root = process.cwd();
    const scratch = join(root, 'node_modules/.cache');
    mkdirSync(scratch, { recursive: true });
    const suffix = `${process.pid}-${randomUUID()}`;
    const entry = join(scratch, `phrase-seed-held-entry-${suffix}.tsx`);
    const outfile = join(scratch, `phrase-seed-held-probe-${suffix}.js`);
    let server: ReturnType<typeof createServer> | undefined;
    let browser: Browser | undefined;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      writeFileSync(
        entry,
        `import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PhrasePanel } from '${root}/components/phrase-panel.tsx';

const capture = {
  position: 2,
  view: 'pattern',
  place: 'scale',
  degrees: false,
  left: false,
  chordRoot: 'C',
  qualityId: 'major',
  chordView: 'shape',
  voicingIndex: 0,
  voicingBass: 'all',
  voicingStrings: 'all',
  voicingNearFret: null,
};

const scaleNotes = [
  { name: 'A', pc: 9, degree: '1' },
  { name: 'B', pc: 11, degree: '2' },
  { name: 'C', pc: 0, degree: 'b3' },
  { name: 'D', pc: 2, degree: '4' },
  { name: 'E', pc: 4, degree: '5' },
  { name: 'F', pc: 5, degree: 'b6' },
  { name: 'G', pc: 7, degree: 'b7' },
];

function held(id) {
  return {
    id,
    type: 'phrase',
    name: 'Held phrase',
    savedAt: 1,
    notes: [
      {
        name: 'StashTone',
        pc: 9,
        degree: '1',
        midi: 45,
        beat: 0,
        duration: 1,
        strong: true,
        chordTone: true,
        string: 0,
        fret: 5,
        finger: 1,
        position: 5,
        shift: false,
      },
    ],
    key: 'A',
    scaleId: 'dorian',
    scaleName: 'Dorian',
    chord: null,
    bars: 2,
    tempo: 96,
    slow: false,
    swing: 0,
    plan: {
      contour: 'arch',
      rhythm: 'quarters',
      register: 'mid',
      cadence: 'root',
    },
    seed: ${LOADED_SEED},
    ...capture,
  };
}

const probe = { releases: 0 };
window.__seedHeld = probe;

function Harness() {
  const [heldId, setHeldId] = useState('stash-phrase');
  return createElement(PhrasePanel, {
    active: false,
    scaleRoot: 'A',
    scaleId: 'dorian',
    scaleName: 'Dorian',
    scaleNotes,
    chord: null,
    held: heldId ? held(heldId) : null,
    contextKey: 'scales|A|dorian',
    onReleaseHeld() {
      probe.releases += 1;
      setHeldId(null);
    },
    capture,
    onMarks() {},
  });
}

const root = createRoot(document.getElementById('root'));
await act(async () => {
  root.render(createElement(Harness));
});
document.documentElement.dataset.ready = '1';
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
          '--jsx=automatic',
          '--loader:.css=empty',
          `--alias:@=${root}`,
        ],
        { cwd: root, stdio: 'pipe' },
      );

      const httpServer = createServer((request, response) => {
        if ((request.url ?? '/').startsWith('/probe.js')) {
          response.setHeader('content-type', 'text/javascript');
          response.end(readFileSync(outfile));
          return;
        }
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(`<!doctype html>
<div id="root"></div>
<script type="module" src="/probe.js"></script>`);
      });
      server = httpServer;
      await new Promise<void>((resolve, reject) => {
        const fail = (error: Error) => reject(error);
        httpServer.once('error', fail);
        httpServer.listen(0, '127.0.0.1', () => {
          httpServer.off('error', fail);
          resolve();
        });
      });
      browser = await launchNamed('chromium', t);
      const address = httpServer.address() as AddressInfo;
      const origin = `http://127.0.0.1:${address.port}`;
      context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
      });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
        origin,
      });
      page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      await page.goto(`${origin}/`, { waitUntil: 'load' });
      await page.waitForFunction(
        (seed) =>
          document.documentElement.dataset.ready === '1' &&
          (document.body.textContent ?? '').includes('StashTone') &&
          document.querySelector<HTMLInputElement>('.phrase-seed input')
            ?.value === seed,
        String(LOADED_SEED),
      );
      if (errors.length) throw new Error(errors.join('\n'));

      const input = page.locator('.phrase-seed input');
      await page.locator('.deck-feel > summary').click();
      await page.locator('.deck-seed > summary').click();
      await page.locator('.deck-seed-copy').waitFor();
      await settle(page);
      const disclosed = await readProbe(page);

      await input.focus();
      await page.getByRole('button', { name: 'Copy seed' }).click();
      await settle(page);
      const copied = await readProbe(page);

      await input.focus();
      await input.blur();
      await settle(page);
      const blurred = await readProbe(page);

      const shown = await input.inputValue();
      await input.fill(` ${shown.trim()} `);
      await input.blur();
      await settle(page);
      const sameSeed = await readProbe(page);

      assert.deepEqual(
        {
          disclose: disclosed.releases,
          discloseOpen: disclosed.open,
          copy: copied.releases,
          blur: blurred.releases,
          sameSeed: sameSeed.releases,
          parses: parseSeed(sameSeed.seed),
          stash: sameSeed.stash,
        },
        {
          disclose: 0,
          discloseOpen: true,
          copy: 0,
          blur: 0,
          sameSeed: 0,
          parses: LOADED_SEED,
          stash: true,
        },
        'an unchanged seed must not drop the loaded stash phrase',
      );

      const nextSeed = String((LOADED_SEED + 1) >>> 0);
      await input.fill(nextSeed);
      await input.blur();
      await settle(page);
      const edited = await readProbe(page);
      assert.equal(
        edited.releases,
        1,
        'a different seed still releases the loaded stash phrase',
      );
      assert.equal(
        edited.stash,
        false,
        'the loaded stash phrase leaves the panel once the seed changes',
      );
      if (errors.length) throw new Error(errors.join('\n'));
    } finally {
      await page?.close();
      await context?.close();
      await browser?.close();
      if (server) await new Promise((resolve) => server?.close(resolve));
      rmSync(entry, { force: true });
      rmSync(outfile, { force: true });
    }
  },
);
