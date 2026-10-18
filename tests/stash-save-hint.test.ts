import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

const TRAY_KEY = 'progger.tray.v1';

function stashPhrase(index: number) {
  return {
    id: `phrase-${index}`,
    type: 'phrase',
    name: `Phrase ${index}`,
    savedAt: 1_700_000_000_000 + index,
    notes: [
      {
        name: 'A',
        pc: 9,
        degree: '1',
        midi: 57,
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
    seed: index,
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
}

async function openPhrases(page: Page) {
  await page.locator('.phrase-open').click();
  await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  await page.getByRole('button', { name: 'Save to stash' }).waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((node) =>
      node.textContent?.includes('Save to stash'),
    );
    return button instanceof HTMLButtonElement && !button.disabled;
  });
}

async function watchAnnouncements(page: Page) {
  await page.evaluate(() => {
    const view = window as Window & { __saveAnnouncements?: string[] };
    const node = document.getElementById('phrase-save-announce');
    view.__saveAnnouncements = [];
    if (!node) return;
    const push = () => {
      view.__saveAnnouncements?.push(node.textContent ?? '');
    };
    new MutationObserver(push).observe(node, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
}

async function announcements(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const view = window as Window & { __saveAnnouncements?: string[] };
    const changes: string[] = [];
    for (const text of view.__saveAnnouncements ?? []) {
      if (changes[changes.length - 1] !== text) changes.push(text);
    }
    return changes;
  });
}

void test(
  'a successful save shows Saved ✓ and announces every save',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await openPhrases(page);
      await watchAnnouncements(page);
      await page.getByRole('button', { name: 'Save to stash' }).click();
      await page.getByRole('button', { name: 'Saved ✓' }).waitFor();
      await page
        .locator('#phrase-seed-help', { hasText: 'Saved to stash.' })
        .waitFor();
      await page.getByRole('button', { name: 'Saved ✓' }).click();
      await page.waitForFunction(() => {
        const view = window as Window & { __saveAnnouncements?: string[] };
        const changes: string[] = [];
        for (const text of view.__saveAnnouncements ?? []) {
          if (changes[changes.length - 1] !== text) changes.push(text);
        }
        return (
          changes.filter(
            (text) => text.replaceAll('\u200b', '') === 'Saved to stash.',
          ).length >= 2
        );
      });
      const changes = await announcements(page);
      const saved = changes.filter(
        (text) => text.replaceAll('\u200b', '') === 'Saved to stash.',
      );
      assert.ok(saved.length >= 2, JSON.stringify(changes));
      assert.notEqual(saved[0], saved[1], JSON.stringify(changes));
      assert.equal(
        await page.locator('#phrase-save-announce').innerText(),
        saved[saved.length - 1],
      );
    } finally {
      await page.close();
      await browser.close();
      await server.release();
    }
  },
);

void test(
  'evicting the oldest item still shows Saved ✓ with the cap message',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await page.goto(server.origin, { waitUntil: 'domcontentloaded' });
      const full = JSON.stringify({
        version: 1,
        items: Array.from({ length: 80 }, (_, index) => stashPhrase(index)),
      });
      await page.evaluate(([key, raw]) => localStorage.setItem(key, raw), [
        TRAY_KEY,
        full,
      ] as const);
      await page.reload({ waitUntil: 'networkidle' });
      await openPhrases(page);
      await page.getByRole('button', { name: 'Save to stash' }).click();
      await page.getByRole('button', { name: 'Saved ✓' }).waitFor();
      const notice = await page.locator('#phrase-seed-help').innerText();
      assert.match(notice, /Stash full, removed the oldest phrase\./);
      const live = (
        await page.locator('#phrase-save-announce').innerText()
      ).replaceAll('\u200b', '');
      assert.match(live, /Stash full, removed the oldest phrase\./);
    } finally {
      await page.close();
      await browser.close();
      await server.release();
    }
  },
);

void test(
  'a failed save announces the error and never shows Saved ✓',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await openPhrases(page);
      await page.evaluate((key) => {
        const storage = window.localStorage;
        const original = storage.setItem.bind(storage);
        storage.setItem = (name, value) => {
          if (name === key) throw new Error('storage unavailable');
          original(name, value);
        };
      }, TRAY_KEY);
      await page.getByRole('button', { name: 'Save to stash' }).click();
      await page
        .locator('#phrase-seed-help', {
          hasText: 'Could not save this phrase.',
        })
        .waitFor();
      assert.equal(
        await page.getByRole('button', { name: 'Saved ✓' }).count(),
        0,
      );
      assert.equal(await page.locator('.phrase-action.is-saved').count(), 0);
      const live = (
        await page.locator('#phrase-save-announce').innerText()
      ).replaceAll('\u200b', '');
      assert.match(live, /Could not save this phrase\./);
    } finally {
      await page.close();
      await browser.close();
      await server.release();
    }
  },
);

void test(
  'the drone hint names sharp and flat keys and describes the toggle',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.locator('#drone-toggle').waitFor();
      for (const [label, hint] of [
        ['F♯', 'Sustained F♯ under your playing'],
        ['B♭', 'Sustained B♭ under your playing'],
      ] as const) {
        await page.locator('#explore-root').click();
        await page.getByRole('option', { name: label, exact: true }).click();
        await page.locator('.drone-legend-hint', { hasText: hint }).waitFor();
        assert.equal(
          await page.locator('#drone-legend-hint').innerText(),
          hint,
        );
        assert.equal(
          await page.locator('#drone-toggle').getAttribute('aria-describedby'),
          'drone-legend-hint',
        );
        assert.equal(
          await page.locator('.drone-legend').getAttribute('aria-label'),
          null,
        );
      }
    } finally {
      await page.close();
      await browser.close();
      await server.release();
    }
  },
);
