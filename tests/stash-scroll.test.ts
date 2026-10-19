import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

const START = 948;
const SLACK = 4;

async function scrollY(page: Page): Promise<number> {
  return page.evaluate(() => Math.round(window.scrollY));
}

async function settle(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(0)));
      }),
  );
}

function near(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= SLACK,
    `${label}: scrollY ${actual}, expected ${expected} ± ${SLACK}`,
  );
}

void test(
  'closing the stash and tabbing the header keep the scroll position',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.locator('.tray-open').waitFor();
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate((top) => window.scrollTo(0, top), START);
        await settle(page);
        const start = await scrollY(page);
        near(start, START, `${width} start`);

        await page.locator('.tray-open').click();
        await page.locator('#practice-tray').waitFor();
        await settle(page);
        near(await scrollY(page), start, `${width} open`);

        await page.locator('.practice-tray-close').click();
        await page.locator('#practice-tray').waitFor({ state: 'detached' });
        await settle(page);
        near(await scrollY(page), start, `${width} close X`);

        await page.evaluate((top) => window.scrollTo(0, top), START);
        await settle(page);
        await page.locator('.tray-open').click();
        await page.locator('#practice-tray').waitFor();
        await page.keyboard.press('Escape');
        await page.locator('#practice-tray').waitFor({ state: 'detached' });
        await settle(page);
        near(await scrollY(page), start, `${width} close Esc`);

        await page.evaluate((top) => {
          window.scrollTo(0, top);
          document
            .querySelector<HTMLElement>('.skip-link')
            ?.focus({ preventScroll: true });
        }, START);
        await settle(page);
        const beforeTab = await scrollY(page);
        near(beforeTab, start, `${width} before tab`);
        await page.keyboard.press('Tab');
        await settle(page);
        const inHeader = await page.evaluate(
          () =>
            document
              .querySelector('.site-header')
              ?.contains(document.activeElement) ?? false,
        );
        assert.equal(inHeader, true, `${width} tab missed the header`);
        near(await scrollY(page), start, `${width} tab into header`);
      }
    } finally {
      await page.close();
      await browser.close();
      await server.release();
    }
  },
);
