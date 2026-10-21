import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { DRONE_POPOVER_MARGIN_PX } from '../lib/drone-controls.ts';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

const MARGIN = DRONE_POPOVER_MARGIN_PX;

async function clearOfHeader(page: Page) {
  await page.evaluate(() => {
    const trigger = document.querySelector('#drone-volume-trigger');
    const bar = document.querySelector('.site-header');
    if (!(trigger instanceof HTMLElement) || !(bar instanceof HTMLElement))
      return;
    const rect = trigger.getBoundingClientRect();
    const minTop = bar.getBoundingClientRect().bottom + 12;
    if (rect.top < minTop) window.scrollBy(0, rect.top - minTop);
  });
}

function menuOpenInPage() {
  const pop = document.querySelector('#drone-volume-popover');
  return (
    pop instanceof HTMLElement &&
    getComputedStyle(pop).visibility !== 'hidden' &&
    pop.offsetHeight > 1
  );
}

async function menuIsOpen(page: Page) {
  return page
    .waitForFunction(
      menuOpenInPage,
      null,
      { timeout: 1_000 },
    )
    .then(() => true)
    .catch(() => false);
}

async function openMenu(page: Page) {
  const trigger = page.locator('#drone-volume-trigger');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click({ timeout: 5_000 });
    }
    if (await menuIsOpen(page)) return;
  }
  const detail = await page.evaluate(() => {
    const pop = document.querySelector('#drone-volume-popover');
    const trigger = document.querySelector('#drone-volume-trigger');
    return {
      expanded: trigger?.getAttribute('aria-expanded') ?? null,
      pop: pop instanceof HTMLElement,
    };
  });
  throw new Error(`drone sound menu did not open ${JSON.stringify(detail)}`);
}

async function closeMenu(page: Page) {
  await page.keyboard.press('Escape');
  await page.waitForSelector('#drone-volume-popover', { state: 'detached' });
}

async function placeTriggerBottom(page: Page, desiredBottom: number) {
  await page.evaluate((bottom) => {
    const trigger = document.querySelector('#drone-volume-trigger');
    if (!(trigger instanceof HTMLElement)) throw new Error('missing trigger');
    const rect = trigger.getBoundingClientRect();
    window.scrollBy(0, rect.bottom - bottom);
  }, desiredBottom);
}

type Frame = {
  scrollY: number;
  top: number;
  bottom: number;
  bar: number;
  innerHeight: number;
};

async function frameOf(page: Page): Promise<Frame> {
  return page.evaluate(() => {
    const trigger = document.querySelector('#drone-volume-trigger');
    if (!(trigger instanceof HTMLElement)) throw new Error('missing trigger');
    const rect = trigger.getBoundingClientRect();
    const bar = document.querySelector('.site-header');
    return {
      scrollY: window.scrollY,
      top: rect.top,
      bottom: rect.bottom,
      bar: bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0,
      innerHeight: window.innerHeight,
    };
  });
}

void test(
  'the drone sound menu scrolls just enough to fit below its button',
  { timeout: 120_000 },
  async (t) => {
    const browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 390, height: 780 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#drone-volume-trigger');
    await page.locator('#drone-volume-trigger').scrollIntoViewIfNeeded();
    await clearOfHeader(page);

    await openMenu(page);
    const menuHeight = await page.evaluate(() => {
      const pop = document.querySelector('#drone-volume-popover');
      if (!(pop instanceof HTMLElement)) throw new Error('missing menu');
      return pop.offsetHeight;
    });
    assert.ok(menuHeight > 40, `menu height ${menuHeight}`);
    await closeMenu(page);
    assert.equal(
      await page.locator('#drone-toggle').getAttribute('aria-pressed'),
      'false',
    );

    const fitsBottom = 780 - MARGIN * 2 - menuHeight - 24;
    await placeTriggerBottom(page, fitsBottom);
    const fitsBefore = await frameOf(page);
    const fitsNeeded =
      fitsBefore.bottom + MARGIN * 2 + menuHeight - fitsBefore.innerHeight;
    assert.ok(fitsNeeded <= 0, `fits case still needs ${fitsNeeded}px`);
    assert.ok(
      fitsBefore.top > fitsBefore.bar,
      `fits case tucked the button under the bar`,
    );
    await openMenu(page);
    const fitsAfter = await frameOf(page);
    const fitsMenu = await page.evaluate(() => {
      const pop = document.querySelector('#drone-volume-popover');
      const trigger = document.querySelector('#drone-volume-trigger');
      if (!(pop instanceof HTMLElement) || !(trigger instanceof HTMLElement)) {
        throw new Error('missing menu');
      }
      const popBox = pop.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      return {
        side: pop.getAttribute('data-side'),
        popTop: popBox.top,
        popBottom: popBox.bottom,
        triggerBottom: triggerBox.bottom,
        innerHeight: window.innerHeight,
      };
    });
    assert.ok(
      Math.abs(fitsAfter.scrollY - fitsBefore.scrollY) < 1,
      `menu that fits scrolled by ${fitsAfter.scrollY - fitsBefore.scrollY}`,
    );
    assert.equal(fitsMenu.side, 'below');
    assert.ok(
      fitsMenu.popTop >= fitsMenu.triggerBottom - 1,
      `menu top ${fitsMenu.popTop} button bottom ${fitsMenu.triggerBottom}`,
    );
    assert.ok(
      fitsMenu.popBottom <= fitsMenu.innerHeight + 1,
      `menu bottom ${fitsMenu.popBottom} viewport ${fitsMenu.innerHeight}`,
    );
    await closeMenu(page);

    const shortBy = 36;
    const lowBottom = 780 - MARGIN * 2 - menuHeight + shortBy;
    await placeTriggerBottom(page, lowBottom);
    const lowBefore = await frameOf(page);
    const lowNeeded =
      lowBefore.bottom + MARGIN * 2 + menuHeight - lowBefore.innerHeight;
    const room = lowBefore.top - lowBefore.bar - MARGIN;
    assert.ok(lowNeeded > 1, `low case needed ${lowNeeded}px`);
    assert.ok(
      lowNeeded <= room,
      `low case needed ${lowNeeded}px with only ${room}px above the button`,
    );
    await openMenu(page);
    const lowAfter = await frameOf(page);
    const lowMenu = await page.evaluate(() => {
      const pop = document.querySelector('#drone-volume-popover');
      const trigger = document.querySelector('#drone-volume-trigger');
      if (!(pop instanceof HTMLElement) || !(trigger instanceof HTMLElement)) {
        throw new Error('missing menu');
      }
      const popBox = pop.getBoundingClientRect();
      const triggerBox = trigger.getBoundingClientRect();
      return {
        side: pop.getAttribute('data-side'),
        height: pop.offsetHeight,
        popTop: popBox.top,
        popBottom: popBox.bottom,
        triggerTop: triggerBox.top,
        triggerBottom: triggerBox.bottom,
        innerHeight: window.innerHeight,
        bar: Math.max(
          0,
          document.querySelector('.site-header')?.getBoundingClientRect()
            .bottom ?? 0,
        ),
      };
    });
    const scrolled = lowAfter.scrollY - lowBefore.scrollY;
    const expected = Math.ceil(
      lowBefore.bottom + MARGIN * 2 + lowMenu.height - lowBefore.innerHeight,
    );
    assert.ok(
      Math.abs(scrolled - expected) < 1,
      `scrolled ${scrolled}px, just enough is ${expected}px`,
    );
    assert.equal(lowMenu.side, 'below');
    assert.ok(
      lowMenu.popTop >= lowMenu.triggerBottom - 1,
      `menu top ${lowMenu.popTop} button bottom ${lowMenu.triggerBottom}`,
    );
    assert.ok(
      lowMenu.popBottom <= lowMenu.innerHeight + 1,
      `menu bottom ${lowMenu.popBottom} still past the viewport ${lowMenu.innerHeight}`,
    );
    assert.ok(
      lowMenu.triggerTop >= lowMenu.bar - 1,
      `button top ${lowMenu.triggerTop} slid under the bar ${lowMenu.bar}`,
    );
    assert.equal(
      await page.locator('#drone-toggle').getAttribute('aria-pressed'),
      'false',
    );
    await page.close();
  },
);
