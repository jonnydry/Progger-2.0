import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  await page.locator('.phrase-open').click();
  await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  await page.locator('.phrase-action', { hasText: 'Play' }).waitFor();
}

void test('an unplayable chord stops a phrase that is already playing', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('.phrase-status', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 15000 });

    await page.getByRole('button', { name: 'Chords' }).click();
    await page.locator('#explore-type').click();
    await page
      .getByRole('combobox', { name: 'Search chord quality' })
      .fill('power');
    await page.getByRole('option', { name: 'Power chord' }).click();
    await page.locator('#explore-root').click();
    await page.getByRole('option', { name: 'C♯', exact: true }).click();

    await page
      .locator('.phrase-status', {
        hasText: 'This chord has no tones in the selected scale',
      })
      .waitFor({ timeout: 10000 });
    const status = await page.locator('.phrase-status').allTextContents();
    assert.equal(
      status.some(
        (text) => text.includes('Playing') || text.includes('Looping'),
      ),
      false,
      status.join(' | '),
    );
    await page
      .locator('.phrase-action', { hasText: 'Stop' })
      .waitFor({ state: 'hidden', timeout: 2000 })
      .catch(() => {});
    const stopVisible = await page
      .locator('.phrase-action', { hasText: 'Stop' })
      .count();
    assert.equal(stopVisible, 0);
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});
