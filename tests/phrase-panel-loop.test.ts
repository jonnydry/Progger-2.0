import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  await page.locator('.phrase-open').click();
  await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  await page.locator('.phrase-action', { hasText: 'Play' }).waitFor();
  for (const selector of ['.deck-build', '.deck-feel']) {
    const fold = page.locator(selector);
    if ((await fold.getAttribute('open')) === null) {
      await fold.locator('> summary').click();
    }
  }
}

/**
 * Loop off during a pass must call finishPass and return. Falling
 * through to start() sets "Starting…" and puts the playhead back on
 * bar 1, so this fails if that handoff is removed.
 */
void test('turning Loop off mid-pass keeps the running pass', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await page
      .locator('button[aria-pressed="true"]', { hasText: '2 bars' })
      .waitFor();
    const tempo = await page
      .locator('label.phrase-tempo:not(.phrase-swing) input')
      .inputValue();
    assert.equal(tempo, '96');

    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('.phrase-action[aria-pressed="true"]', { hasText: 'Loop' })
      .waitFor();
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 15000 });

    // Bar 2, still clear of the 5s seam. A 10-beat restart would still
    // be on bar 1 when this pass reaches its closing note.
    await page.waitForFunction(
      () => {
        const head = document.querySelector<HTMLElement>(
          '[data-phrase-playhead]:not([hidden])',
        );
        if (head?.dataset.phrasePlayhead !== '2') return false;
        const left = Number.parseFloat(head.style.left);
        return left > 12 && left < 80;
      },
      undefined,
      { timeout: 8000 },
    );

    await page.evaluate(() => {
      const view = window as Window & {
        __phraseSawStarting?: boolean;
        __phraseRestarted?: boolean;
      };
      view.__phraseSawStarting = false;
      view.__phraseRestarted = false;
      const status = document.querySelector('#phrase-seed-help');
      const note = () => {
        if (status?.textContent?.includes('Starting')) {
          view.__phraseSawStarting = true;
        }
      };
      note();
      if (status) {
        new MutationObserver(note).observe(status, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
      const sample = () => {
        const head = document.querySelector<HTMLElement>(
          '[data-phrase-playhead]:not([hidden])',
        );
        const left = Number.parseFloat(head?.style.left ?? '');
        if (head?.dataset.phrasePlayhead === '1' && left < 25) {
          view.__phraseRestarted = true;
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    const turnedOffAt = Date.now();
    await page.locator('.phrase-action', { hasText: 'Loop' }).click();

    const landed = await page
      .waitForFunction(
        () => {
          const head = document.querySelector<HTMLElement>(
            '[data-phrase-playhead]:not([hidden])',
          );
          return head?.dataset.phrasePlayhead === 'land';
        },
        undefined,
        { timeout: 3500 },
      )
      .then(() => true)
      .catch(() => false);
    const flags = await page.evaluate(() => {
      const view = window as Window & {
        __phraseSawStarting?: boolean;
        __phraseRestarted?: boolean;
      };
      return {
        sawStarting: view.__phraseSawStarting === true,
        restarted: view.__phraseRestarted === true,
        status: document.querySelector('#phrase-seed-help')?.textContent ?? '',
      };
    });
    assert.equal(
      flags.restarted,
      false,
      'Loop off restarted playback from bar 1',
    );
    assert.equal(
      flags.sawStarting,
      false,
      `Loop off restarted playback (${flags.status})`,
    );
    assert.equal(
      landed,
      true,
      'the running pass did not reach its closing note',
    );
    assert.match(flags.status, /Playing this phrase\./);

    const remaining = 5000 - (Date.now() - turnedOffAt);
    await page
      .locator('#phrase-seed-help', {
        hasText: 'Same seed replays this phrase.',
      })
      .waitFor({ timeout: Math.max(500, remaining) });
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});
