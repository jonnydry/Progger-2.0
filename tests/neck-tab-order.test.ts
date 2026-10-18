import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

void test(
  'at 390px the neck form controls follow the visual tab order',
  { timeout: 120_000 },
  async (t) => {
    const browser: Browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${server.origin}/`, {
      waitUntil: 'domcontentloaded',
    });
    await page.waitForSelector('.neck .connection-controls');
    await page.waitForFunction(() => {
      const neck = document.querySelector('.neck');
      if (!neck) return false;
      const names = [...neck.children].map((child) => child.className);
      const form = names.findIndex((name) =>
        name.includes('connection-controls'),
      );
      const transport = names.findIndex((name) =>
        name.includes('instrument-dock'),
      );
      return form > transport && transport >= 0;
    });
    const order = await page.evaluate(() => {
      const neck = document.querySelector('.neck');
      if (!neck) return [];
      const groups: { group: string; top: number }[] = [];
      const nodes = neck.querySelectorAll<HTMLElement>(
        'button, a, input, select, textarea, summary, [tabindex]',
      );
      for (const node of nodes) {
        if (node.tabIndex < 0) continue;
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const group = node.closest('.connection-controls')
          ? 'form'
          : node.closest('.neck-overview-slot')
            ? 'overview'
            : node.closest('.under-neck')
              ? 'phrase'
              : node.closest('.instrument-dock')
                ? 'transport'
                : node.closest('.neck-frame')
                  ? 'neck'
                  : node.closest('.pattern-details')
                    ? 'pattern'
                    : '';
        if (!group) continue;
        const top = node.getBoundingClientRect().top;
        if (groups.at(-1)?.group !== group) groups.push({ group, top });
      }
      return groups;
    });
    assert.deepEqual(
      order.map((item) => item.group),
      ['neck', 'overview', 'phrase', 'transport', 'form', 'pattern'],
    );
    for (let index = 1; index < order.length; index += 1) {
      assert.ok(
        order[index].top >= order[index - 1].top,
        `${order[index].group} at ${order[index].top}px is above ${order[index - 1].group}`,
      );
    }
    await page.close();
  },
);
