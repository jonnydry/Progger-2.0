import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

type Control = {
  name: string;
  top: number;
  left: number;
  disabled: boolean;
  tabIndex: number;
};

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

async function deckControls(page: Page): Promise<Control[]> {
  return page.evaluate(() => {
    const root = document.querySelector('.phrase-deck');
    if (!root) return [];
    const nodes = [
      ...root.querySelectorAll<HTMLElement>('button, input, select, textarea'),
    ];
    return nodes
      .filter((node) => {
        if (node.tabIndex < 0 && !node.hasAttribute('disabled')) return false;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden')
          return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => {
        const box = node.getBoundingClientRect();
        const aria = node.getAttribute('aria-label');
        const legend = node
          .closest('label')
          ?.querySelector('.deck-legend')
          ?.textContent;
        const name = (
          aria ||
          (node instanceof HTMLInputElement ? legend : '') ||
          node.innerText ||
          node.textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        return {
          name,
          top: box.top,
          left: box.left,
          disabled: node.hasAttribute('disabled'),
          tabIndex: node.tabIndex,
        };
      });
  });
}

function readingOrder(controls: Control[]): Control[] {
  return [...controls].sort((a, b) => {
    if (Math.abs(a.top - b.top) > 8) return a.top - b.top;
    return a.left - b.left;
  });
}

void test(
  'phrase deck tab order follows the visual rows at phone and desktop widths',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.phrase-open');

    for (const width of [1440, 800, 500, 390, 320]) {
      await page.setViewportSize({
        width,
        height: width >= 800 ? 900 : 844,
      });
      if ((await page.locator('.phrase-panel').count()) === 0) {
        await openPhrases(page);
      }
      await page.locator('.deck-key-play').scrollIntoViewIfNeeded();
      const controls = await deckControls(page);
      assert.ok(controls.length >= 10, `${width}px found ${controls.length}`);
      for (const control of controls) {
        assert.ok(
          control.tabIndex <= 0,
          `${width}px ${control.name} tabindex ${control.tabIndex}`,
        );
      }
      const visual = readingOrder(controls);
      assert.deepEqual(
        controls.map((control) => control.name),
        visual.map((control) => control.name),
        `${width}px dom ${controls.map((control) => control.name).join(', ')} visual ${visual.map((control) => control.name).join(', ')}`,
      );
      const group = page.getByRole('group', { name: 'Phrase history' });
      assert.equal(await group.count(), 1, `${width}px phrase history group`);

      await page.locator('.deck-key-play').focus();
      const keyboard: string[] = [];
      for (let step = 0; step < controls.length + 2; step += 1) {
        const current = await page.evaluate(() => {
          const node = document.activeElement;
          if (!(node instanceof HTMLElement)) return null;
          if (!node.closest('.phrase-deck')) return null;
          const aria = node.getAttribute('aria-label');
          const legend = node
            .closest('label')
            ?.querySelector('.deck-legend')
            ?.textContent;
          return (
            aria ||
            (node instanceof HTMLInputElement ? legend : '') ||
            node.innerText ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
        });
        if (!current) break;
        keyboard.push(current);
        await page.keyboard.press('Tab');
      }
      assert.deepEqual(
        keyboard,
        controls
          .filter((control) => !control.disabled)
          .map((control) => control.name),
        `${width}px keyboard ${keyboard.join(', ')}`,
      );
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      assert.ok(overflow <= 1, `${width}px overflow ${overflow}`);
    }
    await page.close();
  },
);
