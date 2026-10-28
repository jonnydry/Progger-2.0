import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  const button = page.locator('.phrase-open');
  await button.waitFor();
  // The server-rendered button accepts a click before React attaches its
  // handler. networkidle does not wait for that, so on a busy runner the
  // click is lost and .phrase-panel never appears.
  await page.waitForFunction(() => {
    const node = document.querySelector('.phrase-open');
    if (!node) return false;
    return Object.keys(node).some((key) => key.startsWith('__reactProps'));
  });
  await button.click();
  try {
    await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  } catch (error) {
    if ((await button.getAttribute('aria-expanded')) === 'true') throw error;
    await button.click();
    await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  }
  await page.locator('.phrase-action', { hasText: 'Play' }).waitFor();
  for (const selector of ['.deck-build', '.deck-feel']) {
    const fold = page.locator(selector);
    if ((await fold.getAttribute('open')) === null) {
      await fold.locator('> summary').click();
    }
  }
}

async function watchRestart(page: Page) {
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
}

async function restartFlags(page: Page) {
  return page.evaluate(() => {
    const view = window as Window & {
      __phraseSawStarting?: boolean;
      __phraseRestarted?: boolean;
    };
    return {
      sawStarting: view.__phraseSawStarting === true,
      restarted: view.__phraseRestarted === true,
    };
  });
}

async function playLooping(page: Page) {
  await page
    .locator('button[aria-pressed="true"]', { hasText: '2 bars' })
    .waitFor();
  await page.locator('.phrase-action', { hasText: 'Loop' }).click();
  await page
    .locator('.phrase-action[aria-pressed="true"]', { hasText: 'Loop' })
    .waitFor();
  await page.locator('.phrase-action', { hasText: 'Play' }).click();
  await page
    .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
    .waitFor({ timeout: 15000 });
  await page.waitForFunction(
    () => {
      const head = document.querySelector<HTMLElement>(
        '[data-phrase-playhead]:not([hidden])',
      );
      if (head?.dataset.phrasePlayhead !== '2') return false;
      const left = Number.parseFloat(head.style.left);
      return left > 12 && left < 40;
    },
    undefined,
    { timeout: 8000 },
  );
}

/**
 * Choosing a new length while Loop is on must not restart the pass.
 * start() would flash "Starting…". The queued phrase waits for the next
 * bar line, which is still ahead of this check.
 */
void test('choosing bars while Loop is on does not restart the pass', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await playLooping(page);
    await watchRestart(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 800)),
    );
    const flags = await restartFlags(page);
    assert.equal(
      flags.restarted,
      false,
      'choosing bars restarted playback from bar 1',
    );
    assert.equal(flags.sawStarting, false);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Looping this phrase\./);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * A bar change during the cadence after Loop is turned off must not cut
 * that pass. The new phrase waits until the closing note has finished.
 */
void test('choosing bars while a pass is finishing does not restart it', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await playLooping(page);
    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 2000 });
    await watchRestart(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 800)),
    );
    const flags = await restartFlags(page);
    assert.equal(
      flags.restarted,
      false,
      'choosing bars restarted the finishing pass from bar 1',
    );
    assert.equal(flags.sawStarting, false);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Playing this phrase\./);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});
