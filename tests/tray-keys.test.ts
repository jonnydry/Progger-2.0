import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import {
  TRAY_KEY,
  TRAY_UNREADABLE_NOTE,
  type TrayPhrase,
} from '../lib/tray.ts';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';
import { openTray } from './open-tray.ts';

const phrase: TrayPhrase = {
  id: 'phrase-1',
  type: 'phrase',
  name: 'A Dorian phrase',
  savedAt: 1_700_000_000_000,
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

void test(
  'tray tab wraps and escape then enter still renames',
  { timeout: 120_000 },
  async (t) => {
    const browser: Browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.addInitScript(
      ([key, raw]) => {
        localStorage.setItem(key, raw);
      },
      [TRAY_KEY, JSON.stringify({ version: 1, items: [phrase] })] as const,
    );
    await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
    await openTray(page);
    await page.waitForFunction(() => {
      const panel = document.querySelector('#practice-tray');
      if (!(panel instanceof HTMLElement)) return false;
      const rect = panel.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= window.innerWidth + 1;
    });

    const focusable = () =>
      page.evaluate(() => {
        const panel = document.querySelector('#practice-tray');
        if (!panel) return [];
        return [
          ...panel.querySelectorAll<HTMLElement>(
            'button:not([disabled]), input:not([disabled])',
          ),
        ]
          .filter((node) => node.tabIndex >= 0)
          .map(
            (node) => node.getAttribute('aria-label') || node.textContent || '',
          );
      });
    const labels = (await focusable()).map((label) =>
      label.replace(/\s+/g, ' ').trim(),
    );
    assert.ok(labels.length >= 2, `focusable controls ${labels.join(', ')}`);
    await page.locator('#practice-tray').locator('button').last().focus();
    await page.keyboard.press('Tab');
    const wrapped = await page.evaluate(() => {
      const active = document.activeElement;
      return (active?.getAttribute('aria-label') || active?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    });
    assert.equal(wrapped, labels[0]);
    await page.keyboard.press('Shift+Tab');
    const back = await page.evaluate(() => {
      const active = document.activeElement;
      return (active?.getAttribute('aria-label') || active?.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    });
    assert.equal(back, labels[labels.length - 1]);

    await page.getByRole('button', { name: 'Rename' }).click();
    const input = page.getByRole('textbox', { name: 'Rename A Dorian phrase' });
    await input.fill('Dropped name');
    await input.press('Escape');
    assert.equal(
      await page.locator('.practice-tray-name').textContent(),
      'A Dorian phrase',
    );
    await page.getByRole('button', { name: 'Rename' }).click();
    const again = page.getByRole('textbox', { name: 'Rename A Dorian phrase' });
    await again.fill('Kept name');
    await again.press('Enter');
    await page.waitForFunction(
      () =>
        document.querySelector('.practice-tray-name')?.textContent ===
        'Kept name',
    );
    assert.equal(
      await page.locator('.practice-tray-name').textContent(),
      'Kept name',
    );
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      TRAY_KEY,
    );
    assert.match(stored ?? '', /Kept name/);
    assert.doesNotMatch(stored ?? '', /Dropped name/);
  },
);

void test(
  'an unreadable tray says it was left untouched',
  { timeout: 120_000 },
  async (t) => {
    const browser: Browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    const unread = [
      '{',
      JSON.stringify({ version: 2, items: [] }),
      JSON.stringify({ version: 1, items: { id: 'nope' } }),
    ];
    for (const raw of unread) {
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
      await page.evaluate(([key, value]) => localStorage.setItem(key, value), [
        TRAY_KEY,
        raw,
      ] as const);
      await page.reload({ waitUntil: 'networkidle' });
      await openTray(page);
      await page.getByText(TRAY_UNREADABLE_NOTE).waitFor();
      assert.equal(
        await page.locator('#practice-tray-empty').textContent(),
        TRAY_UNREADABLE_NOTE,
      );
      assert.equal(await page.getByText('Nothing saved yet').count(), 0);
      assert.equal(
        await page.evaluate((key) => localStorage.getItem(key), TRAY_KEY),
        raw,
      );
      await page.keyboard.press('Escape');
      await page.locator('#practice-tray').waitFor({ state: 'detached' });
    }
    await page.evaluate((key) => localStorage.removeItem(key), TRAY_KEY);
    await page.reload({ waitUntil: 'networkidle' });
    await openTray(page);
    await page.getByRole('heading', { name: 'Nothing saved yet' }).waitFor();
    assert.equal(await page.getByText(TRAY_UNREADABLE_NOTE).count(), 0);
  },
);
