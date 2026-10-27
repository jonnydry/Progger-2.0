import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  const open = page.locator('.phrase-open');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await open.getAttribute('aria-expanded')) !== 'true') {
      await open.click({ timeout: 5_000 });
    }
    const shown = await page
      .locator('.deck-key-play')
      .waitFor({ state: 'visible', timeout: 1_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) return;
  }
  await page.locator('.deck-key-play').waitFor({ state: 'visible' });
}

type Flags = {
  sawStarting?: boolean;
  restarted?: boolean;
};

/**
 * Watches the tape window and the playhead so a restart from bar 1 is
 * visible even when it happens between frames.
 */
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
}

async function restartFlags(page: Page): Promise<Flags> {
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

async function playStraight(page: Page) {
  await page
    .locator('button[aria-pressed="true"]', { hasText: '2 bars' })
    .waitFor();
  await page.locator('.phrase-action', { hasText: 'Play' }).click();
  await page
    .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
    .waitFor({ timeout: 15000 });
}

/** Bar 2 at least a quarter of the way in, so a bar-1 restart is obvious. */
async function waitMidSecondBar(page: Page) {
  await page.waitForFunction(
    () => {
      const head = document.querySelector<HTMLElement>(
        '[data-phrase-playhead]:not([hidden])',
      );
      if (head?.dataset.phrasePlayhead !== '2') return false;
      return Number.parseFloat(head.style.left) > 30;
    },
    undefined,
    { timeout: 12000 },
  );
}

/**
 * Turning Loop on in the middle of a pass used to fade the pass and start
 * again at bar 1, contradicting the panel's own bar-line promise. The pass
 * must keep playing and the repeat must take the next bar line.
 */
void test('turning Loop on mid-pass keeps the running pass and loops at the bar line', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await playStraight(page);
    await waitMidSecondBar(page);
    await watchRestart(page);
    await page.locator('.deck-key-loop').click();
    await page
      .locator('.deck-key-loop[aria-pressed="true"]')
      .waitFor({ timeout: 2000 });
    // Inside the bar that is already sounding. A restart would show bar 1
    // inside this window; a bar-line handoff cannot.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 700)),
    );
    const flags = await restartFlags(page);
    assert.equal(flags.restarted, false, 'Loop on restarted from bar 1');
    assert.equal(
      flags.sawStarting,
      false,
      'Loop on restarted playback (Starting… flashed)',
    );
    // The deck already reports Loop as on, because that is what the
    // request is. What matters is that the bar being heard was not cut.
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.doesNotMatch(status, /Starting/);
    // The repeat does arrive: the pass wraps and the status becomes looping.
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 12000 });
    const after = await restartFlags(page);
    assert.equal(after.restarted, false, 'the repeat began at bar 1 early');
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * Turning Loop back off before the armed bar line landed must leave the
 * sounding pass alone rather than cutting it.
 */
void test('turning Loop off before its bar line keeps the pass running', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await playStraight(page);
    await waitMidSecondBar(page);
    await watchRestart(page);
    await page.locator('.deck-key-loop').click();
    await page
      .locator('.deck-key-loop[aria-pressed="true"]')
      .waitFor({ timeout: 2000 });
    await page.locator('.deck-key-loop').click();
    await page
      .locator('.deck-key-loop[aria-pressed="false"]')
      .waitFor({ timeout: 2000 });
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 900)),
    );
    const flags = await restartFlags(page);
    assert.equal(flags.restarted, false, 'Loop off restarted from bar 1');
    assert.equal(flags.sawStarting, false);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Playing this phrase\./);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * Half speed mid-pass is a retime, so it also waits for the bar line. The
 * bar being heard keeps going instead of being cut and replayed at bar 1.
 */
void test('Half speed mid-pass does not restart the running pass', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await playStraight(page);
    await waitMidSecondBar(page);
    await watchRestart(page);
    await page.locator('.deck-toggle', { hasText: 'Half speed' }).click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 700)),
    );
    const flags = await restartFlags(page);
    assert.equal(flags.restarted, false, 'Half speed restarted from bar 1');
    assert.equal(flags.sawStarting, false);
    assert.equal(
      await page.locator('.phrase-tempo output').first().innerText(),
      '48 BPM',
    );
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * The tape window is the transport's only status line. A save notice must
 * not outlive the action, and it must never hide an audio error.
 */
void test('a save notice clears on the next transport action', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await page.getByRole('button', { name: 'Save to stash' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Saved to stash.' })
      .waitFor();
    await page.locator('.deck-key-play').click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 15000 });
    await page.locator('.deck-key-play').click();
    await page
      .locator('#phrase-seed-help', {
        hasText: 'Same seed replays this phrase.',
      })
      .waitFor({ timeout: 8000 });
    // A new phrase is a different line, so the old save note is stale.
    await page.getByRole('button', { name: 'New phrase' }).click();
    const text = await page.locator('#phrase-seed-help').innerText();
    assert.doesNotMatch(text, /Saved to stash/);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});
