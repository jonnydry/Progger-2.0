import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

type Box = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

async function measure(page: Page) {
  return page.evaluate(() => {
    const read = (node: Element | null): Box | null => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };
    const panel = document.querySelector('#practice-tray');
    const scroll = Math.max(
      document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
      document.body.scrollWidth - document.body.clientWidth,
    );
    const styles =
      panel instanceof HTMLElement ? getComputedStyle(panel) : null;
    return {
      panel: read(panel),
      backdrop: read(document.querySelector('.practice-tray-backdrop')),
      scroll,
      drone:
        document.querySelector('#drone-toggle')?.getAttribute('aria-pressed') ??
        null,
      phrases: document
        .querySelector('.phrase-open')
        ?.textContent?.replace(/\s+/g, ' ')
        .trim(),
      focus: panel?.contains(document.activeElement) ?? false,
      transition: styles?.transitionDuration ?? '',
    };
  });
}

for (const name of ['chromium', 'firefox'] as const) {
  void test(
    `practice tray opens as a side panel at 1280 and a sheet at 390 in ${name}`,
    { timeout: 120_000 },
    async (t) => {
      const browser: Browser = await launchNamed(name, t);
      const server = await acquireDevServer();
      t.after(async () => {
        await browser.close();
        await server.release();
      });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      });
      await page.goto(`${server.origin}/`, { waitUntil: 'networkidle' });
      await page.waitForSelector('.tray-open');

      for (const width of [1280, 390, 414, 360, 320]) {
        await page.setViewportSize({ width, height: 900 });
        const closed = await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        );
        assert.ok(closed <= 1, `${width}px closed scroll ${closed}`);
        assert.equal(
          await page.locator('.tray-open').getAttribute('aria-expanded'),
          'false',
          `${width}px starts closed`,
        );
        await page.locator('.tray-open').click();
        await page.locator('#practice-tray').waitFor({ state: 'visible' });
        await page.waitForFunction((viewport) => {
          const panel = document.querySelector('#practice-tray');
          if (!(panel instanceof HTMLElement)) return false;
          const rect = panel.getBoundingClientRect();
          return rect.left >= -1 && rect.right <= viewport + 1;
        }, width);
        const open = await measure(page);
        assert.equal(
          open.drone,
          'false',
          `${width}px opening the tray starts the drone`,
        );
        assert.equal(open.phrases, 'Phrases', `${width}px phrases label`);
        assert.equal(open.focus, true, `${width}px focus leaves the dialog`);
        assert.ok(open.scroll <= 1, `${width}px open scroll ${open.scroll}`);
        assert.ok(open.panel, `${width}px panel`);
        assert.ok(open.backdrop, `${width}px backdrop`);
        const panel = open.panel!;
        assert.ok(
          panel.top <= 1 && panel.bottom >= 890,
          `${width}px height ${panel.bottom}`,
        );
        assert.ok(
          panel.left >= -1 && panel.right <= width + 1,
          `${width}px horizontal`,
        );
        if (width >= 800) {
          assert.ok(
            panel.width >= 320 && panel.width <= 460,
            `${width}px width ${panel.width}`,
          );
          assert.ok(panel.left > 200, `${width}px panel is not a sheet`);
          assert.ok(
            Math.abs(panel.right - width) <= 2,
            `${width}px right ${panel.right}`,
          );
        }
        if (width <= 700) {
          assert.ok(panel.left <= 1, `${width}px sheet left ${panel.left}`);
          assert.ok(
            Math.abs(panel.width - width) <= 2,
            `${width}px sheet width ${panel.width}`,
          );
        }
        await page.keyboard.press('Escape');
        await page.locator('#practice-tray').waitFor({ state: 'detached' });
        const returned = await page.evaluate(() =>
          document.activeElement?.classList.contains('tray-open'),
        );
        assert.equal(returned, true, `${width}px focus does not return`);
      }

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.locator('.tray-open').click();
      await page.locator('#practice-tray').waitFor({ state: 'visible' });
      await page.waitForFunction(() => {
        const panel = document.querySelector('#practice-tray');
        if (!(panel instanceof HTMLElement)) return false;
        const rect = panel.getBoundingClientRect();
        return rect.left >= -1 && rect.right <= window.innerWidth + 1;
      });
      const reduced = await measure(page);
      assert.ok(
        reduced.transition === '0s' || reduced.transition === '0ms',
        `reduced motion transition ${reduced.transition}`,
      );
      await page.keyboard.press('Escape');
      await page.close();
    },
  );
}
