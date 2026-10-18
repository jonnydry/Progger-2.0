import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';

function showHeld(page: Page, id: string, contextKey: string) {
  return page.evaluate(
    ([nextId, nextKey]) =>
      (
        window as unknown as {
          __heldRelease: {
            show: (heldId: string, key: string) => Promise<number>;
          };
        }
      ).__heldRelease.show(nextId, nextKey),
    [id, contextKey] as const,
  );
}

/**
 * Mounts PhrasePanel and drives held + contextKey. Deleting the release
 * line in the seenHeld effect leaves this red: a context change must call
 * onReleaseHeld once, and the other updates must not. Clearing the held
 * phrase resets that memory, so bringing the same phrase back does not
 * release it again.
 */
void test('a context change releases a held tray phrase', async (t) => {
  const root = process.cwd();
  // The entry has to live in the project. esbuild resolves bare imports
  // from the entry's directory, and CI has no node_modules above /tmp.
  const scratch = join(root, 'node_modules/.cache');
  mkdirSync(scratch, { recursive: true });
  const suffix = `${process.pid}-${randomUUID()}`;
  const entry = join(scratch, `phrase-held-release-entry-${suffix}.tsx`);
  const outfile = join(scratch, `phrase-held-release-probe-${suffix}.js`);
  let server: ReturnType<typeof createServer> | undefined;
  let browser: Browser | undefined;
  let page: Page | undefined;
  try {
  writeFileSync(
    entry,
    `import { act, createElement } from 'react';
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
        name: 'A',
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
    seed: 17,
    ...capture,
  };
}

let releases = 0;
const onReleaseHeld = () => {
  releases += 1;
};
const root = createRoot(document.getElementById('root'));

async function show(id, contextKey) {
  await act(() => {
    root.render(
      createElement(PhrasePanel, {
        active: false,
        scaleRoot: 'A',
        scaleId: 'dorian',
        scaleName: 'Dorian',
        scaleNotes,
        chord: null,
        held: id ? held(id) : null,
        contextKey,
        onReleaseHeld,
        capture,
        onMarks() {},
      }),
    );
  });
  return releases;
}

export { show };
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
<script type="module">
import { show } from '/probe.js';
window.__heldRelease = { show };
document.documentElement.dataset.ready = '1';
</script>`);
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
    page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(`http://127.0.0.1:${address.port}/`, {
      waitUntil: 'load',
    });
    await page.waitForFunction(
      () => document.documentElement.dataset.ready === '1',
    );
    if (errors.length) throw new Error(errors.join('\n'));

    const first = await showHeld(page, 'phrase-a', 'scales|A|dorian');
    assert.equal(first, 0, 'opening a held phrase does not release it');

    const same = await showHeld(page, 'phrase-a', 'scales|A|dorian');
    assert.equal(same, 0, 'the same context does not release the held phrase');

    const changed = await showHeld(page, 'phrase-a', 'scales|D|mixolydian');
    assert.equal(
      changed,
      1,
      'changing the context releases the held phrase once',
    );

    const next = await showHeld(page, 'phrase-b', 'chords|G|major');
    assert.equal(next, 1, 'a new held phrase in a new context is kept');

    const cleared = await showHeld(page, '', 'chords|G|major');
    assert.equal(cleared, 1, 'clearing the held phrase does not release it');

    const restored = await showHeld(page, 'phrase-b', 'chords|C|minor');
    assert.equal(
      restored,
      1,
      'a held phrase that went away does not release when it returns',
    );
    if (errors.length) throw new Error(errors.join('\n'));
  } finally {
    await page?.close();
    await browser?.close();
    if (server) await new Promise((resolve) => server?.close(resolve));
    rmSync(entry, { force: true });
    rmSync(outfile, { force: true });
  }
});
