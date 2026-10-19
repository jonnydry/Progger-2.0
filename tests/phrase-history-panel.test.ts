import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { PHRASE_HISTORY_KEY } from '../lib/phrase-history.ts';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  await page.locator('.phrase-open').click();
  await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  await page.locator('.phrase-action', { hasText: 'Play' }).waitFor();
}

async function seedOf(page: Page) {
  return page.locator('.phrase-seed input').inputValue();
}

async function freshPhrases(page: Page, origin: string, width: number) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.evaluate(
    (key) => localStorage.removeItem(key),
    PHRASE_HISTORY_KEY,
  );
  await openPhrases(page);
}

function boxWithin(pageWidth: number) {
  return async (page: Page, name: string) => {
    const button = page.getByRole('button', { name });
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    assert.ok(box, name);
    assert.ok(box.x >= -1, `${name} starts at ${box.x}`);
    assert.ok(
      box.x + box.width <= pageWidth + 1,
      `${name} ends at ${box.x + box.width}`,
    );
    assert.ok(box.height >= 44, `${name} height ${box.height}`);
    return button;
  };
}

void test('back and forward restore the last phrases on a phone width', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage();
  const width = 320;
  try {
    await freshPhrases(page, server.origin, width);
    const fit = boxWithin(width);
    const previous = await fit(page, 'Previous phrase');
    const next = await fit(page, 'Next phrase');
    await fit(page, 'New phrase');
    assert.equal(await previous.isDisabled(), true);
    assert.equal(await next.isDisabled(), true);
    const hint = await page.locator('#phrase-history-hint').innerText();
    assert.match(hint, /Last 3 phrases\./);
    const hintBox = await page.locator('#phrase-history-hint').boundingBox();
    assert.ok(hintBox && hintBox.width > 0 && hintBox.x >= -1);
    assert.ok(hintBox.x + hintBox.width <= width + 1);

    const first = await seedOf(page);
    await page.getByRole('button', { name: 'New phrase' }).click();
    const second = await seedOf(page);
    assert.notEqual(second, first);
    assert.equal(await previous.isDisabled(), false);
    assert.equal(await next.isDisabled(), true);

    await previous.click();
    assert.equal(await seedOf(page), first);
    assert.equal(await previous.isDisabled(), true);
    assert.equal(await next.isDisabled(), false);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label'),
      ),
      'Next phrase',
    );
    await next.click();
    assert.equal(await seedOf(page), second);
    assert.equal(await next.isDisabled(), true);
    assert.equal(
      await page.evaluate(() =>
        document.activeElement?.getAttribute('aria-label'),
      ),
      'Previous phrase',
    );

    await page.reload({ waitUntil: 'networkidle' });
    await openPhrases(page);
    assert.equal(await seedOf(page), second);
    assert.equal(
      await page.getByRole('button', { name: 'Previous phrase' }).isDisabled(),
      false,
    );
    await page.getByRole('button', { name: 'Previous phrase' }).click();
    assert.equal(await seedOf(page), first);

    await page.evaluate(
      (key) => localStorage.setItem(key, '{'),
      PHRASE_HISTORY_KEY,
    );
    await page.reload({ waitUntil: 'networkidle' });
    await openPhrases(page);
    assert.equal(
      await page.getByRole('button', { name: 'Previous phrase' }).isDisabled(),
      true,
    );
    assert.equal(
      await page.getByRole('button', { name: 'Next phrase' }).isDisabled(),
      true,
    );
    await page.getByRole('button', { name: 'New phrase' }).click();
    assert.equal(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        PHRASE_HISTORY_KEY,
      ),
      '{',
    );
    assert.equal(
      await page.getByRole('button', { name: 'Previous phrase' }).isDisabled(),
      true,
    );
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});

void test('stepping back while looping waits for the current pass', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await freshPhrases(page, server.origin, 1280);
    const first = await seedOf(page);
    await page.getByRole('button', { name: 'New phrase' }).click();
    assert.notEqual(await seedOf(page), first);
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
    await page.getByRole('button', { name: 'Previous phrase' }).click();
    assert.equal(await seedOf(page), first);
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 800)),
    );
    const flags = await page.evaluate(() => {
      const view = window as Window & {
        __phraseSawStarting?: boolean;
        __phraseRestarted?: boolean;
      };
      return {
        sawStarting: view.__phraseSawStarting === true,
        restarted: view.__phraseRestarted === true,
      };
    });
    assert.equal(flags.restarted, false);
    assert.equal(flags.sawStarting, false);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Looping this phrase\./);
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});
