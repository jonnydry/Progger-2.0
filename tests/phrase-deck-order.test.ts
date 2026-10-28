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
      ...root.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, summary',
      ),
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
          ?.querySelector('.deck-legend')?.textContent;
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

async function activeControlName(page: Page): Promise<string> {
  return page.evaluate(() => {
    const node = document.activeElement;
    if (!(node instanceof HTMLElement)) return 'none';
    if (node === document.body) return 'body';
    if (node === document.documentElement) return 'document';
    const aria = node.getAttribute('aria-label');
    const legend = node
      .closest('label')
      ?.querySelector('.deck-legend')?.textContent;
    const name = (
      aria ||
      (node instanceof HTMLInputElement ? legend : '') ||
      node.innerText ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim();
    return name || node.tagName.toLowerCase();
  });
}

async function assertDeckTabOrder(page: Page, width: number) {
  await page.setViewportSize({
    width,
    height: width >= 800 ? 900 : 844,
  });
  if ((await page.locator('.phrase-panel').count()) === 0) {
    await openPhrases(page);
  }
  await page.locator('.deck-key-play').scrollIntoViewIfNeeded();
  const controls = await deckControls(page);
  assert.ok(controls.length >= 7, `${width}px found ${controls.length}`);
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
    const current = await activeControlName(page);
    if (
      current === 'body' ||
      current === 'document' ||
      current === 'none' ||
      !controls.some((control) => control.name === current)
    ) {
      break;
    }
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
  return keyboard;
}

type DeckDensity = {
  height: number;
  rows: { key: string; top: number; height: number; left: number }[];
  clipped: string[];
  shortTargets: string[];
  legendGutters: number[];
  sliders: { name: string; width: number }[];
};

/**
 * The deck is dense by design, so it has to stay legible while it shrinks:
 * no label may clip, every control keeps a --tap target, each pin legend
 * shares a line with its own options, and a fader keeps a usable length.
 */
async function deckDensity(page: Page): Promise<DeckDensity> {
  return page.evaluate(() => {
    const deck = document.querySelector('.phrase-deck');
    if (!deck) throw new Error('deck is missing');
    const name = (node: Element) =>
      (node.getAttribute('aria-label') || node.textContent || '')
        .replace(/\s+/g, ' ')
        .trim();
    const controls = [
      ...deck.querySelectorAll<HTMLElement>(
        'button, summary, input[type="range"], input:not([type])',
      ),
    ].filter((node) => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    const clipped = controls
      .filter(
        (node) =>
          node.scrollWidth > node.clientWidth + 1 ||
          node.scrollHeight > node.clientHeight + 1,
      )
      .map(name);
    const shortTargets = controls
      .filter((node) => node.getBoundingClientRect().height < 43)
      .map(name);
    const rows = [
      ...deck.querySelectorAll<HTMLElement>(
        '.deck-key, .deck-switch button, .deck-toggle, .deck-setting, .phrase-pin-row, .phrase-tempo, .deck-counter',
      ),
    ].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        key: node.className,
        top: Math.round(box.top),
        height: Math.round(box.height),
        left: Math.round(box.left),
      };
    });
    /* A pin legend must sit inside its own row's box, not on the row above or
       under the neighbouring column. */
    const legendGutters = [
      ...deck.querySelectorAll<HTMLElement>('.phrase-pin-row'),
    ].map((row) => {
      const legend = row.querySelector('.deck-legend');
      if (!legend) return -1;
      const label = legend.getBoundingClientRect();
      const options = row.querySelector('.phrase-pin-line');
      if (!options) return -1;
      return Math.round(options.getBoundingClientRect().left - label.right);
    });
    const sliders = [
      ...deck.querySelectorAll<HTMLElement>(
        '.phrase-tempo input[type="range"], .phrase-swing input[type="range"]',
      ),
    ].map((node) => ({
      name: name(node.closest('label') ?? node),
      width: Math.round(node.getBoundingClientRect().width),
    }));
    return {
      height: Math.round(deck.getBoundingClientRect().height),
      rows,
      clipped,
      shortTargets,
      legendGutters,
      sliders,
    };
  });
}

async function openDeckFolds(page: Page) {
  for (const selector of ['.deck-build', '.deck-feel']) {
    const fold = page.locator(selector);
    if ((await fold.getAttribute('open')) === null) {
      await fold.locator('> summary').click();
    }
  }
  await page.locator('.phrase-pin').first().waitFor({ state: 'visible' });
  await page.locator('.phrase-swing input').waitFor({ state: 'visible' });
}

async function seedValue(page: Page) {
  return page.locator('.phrase-seed input').inputValue();
}

/** Sit in the middle of three phrases so Previous and Next both tab. */
async function enableHistorySteps(page: Page) {
  const first = await seedValue(page);
  await page.getByRole('button', { name: 'New phrase' }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector<HTMLInputElement>('.phrase-seed input')?.value !==
      previous,
    first,
  );
  const second = await seedValue(page);
  await page.getByRole('button', { name: 'New phrase' }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector<HTMLInputElement>('.phrase-seed input')?.value !==
      previous,
    second,
  );
  await page.getByRole('button', { name: 'Previous phrase' }).click();
  await page.waitForFunction(
    (expected) =>
      document.querySelector<HTMLInputElement>('.phrase-seed input')?.value ===
      expected,
    second,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Previous phrase' }).isDisabled(),
    false,
  );
  assert.equal(
    await page.getByRole('button', { name: 'Next phrase' }).isDisabled(),
    false,
  );
}

void test(
  'phrase deck tab order follows the visual rows at phone and desktop widths',
  { timeout: 180_000 },
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

    for (const width of [1440, 900, 800, 500, 390, 320]) {
      const closed = await assertDeckTabOrder(page, width);
      assert.equal(
        closed.some(
          (name) =>
            name === 'Half speed' ||
            name === 'arch' ||
            name.toLowerCase().startsWith('tempo'),
        ),
        false,
        `${width}px first look includes a folded control: ${closed.join(', ')}`,
      );
      assert.equal(
        closed.some((name) => name.toLowerCase().startsWith('build')),
        true,
        `${width}px build summary missing: ${closed.join(', ')}`,
      );
    }

    await enableHistorySteps(page);
    for (const width of [1440, 390, 320]) {
      const keyboard = await assertDeckTabOrder(page, width);
      const play = keyboard.indexOf('Play phrase');
      const created = keyboard.indexOf('New phrase');
      const previous = keyboard.indexOf('Previous phrase');
      const next = keyboard.indexOf('Next phrase');
      assert.ok(
        play !== -1 &&
          created !== -1 &&
          previous !== -1 &&
          next !== -1 &&
          play < created &&
          created < previous &&
          previous < next,
        `${width}px history keyboard ${keyboard.join(', ')}`,
      );
    }

    await openDeckFolds(page);
    for (const width of [1440, 390, 320]) {
      const keyboard = await assertDeckTabOrder(page, width);
      const at = (name: string) => keyboard.indexOf(name);
      const build = keyboard.findIndex((name) =>
        name.toLowerCase().startsWith('build'),
      );
      const tempo = keyboard.findIndex((name) =>
        name.toLowerCase().startsWith('tempo'),
      );
      assert.ok(
        at('Play phrase') < at('New phrase') &&
          at('New phrase') < at('Previous phrase') &&
          at('Previous phrase') < at('Next phrase') &&
          build !== -1 &&
          tempo !== -1 &&
          at('Next phrase') < build &&
          build < tempo &&
          tempo < at('Half speed') &&
          at('Half speed') < at('Swing') &&
          at('Swing') < at('Seed'),
        `${width}px open keyboard ${keyboard.join(', ')}`,
      );
    }
    await page.close();
  },
);

void test(
  'the compact deck keeps every label whole and every target tappable',
  { timeout: 180_000 },
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
    await openPhrases(page);

    const closedHeights = new Map<number, number>();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({
        width,
        height: width >= 800 ? 900 : 844,
      });
      await page.locator('.deck-key-play').scrollIntoViewIfNeeded();
      closedHeights.set(
        width,
        await page
          .locator('.phrase-deck')
          .evaluate((node) => Math.round(node.getBoundingClientRect().height)),
      );
    }
    await openDeckFolds(page);

    /* Every band the layout switches at, and the awkward widths inside each:
       a fader once collapsed to 0px at 650px and 1081px because the readout
       and Half speed held the line and only the slider could give. */
    const heights = new Map<number, number>();
    for (const width of [
      1600, 1440, 1250, 1211, 1210, 1200, 1150, 1100, 1081, 1080, 960, 900, 860,
      800, 760, 700, 650, 641, 640, 500, 480, 471, 470, 420, 390, 360, 320,
    ]) {
      await page.setViewportSize({
        width,
        height: width >= 800 ? 900 : 844,
      });
      await page.locator('.deck-key-play').scrollIntoViewIfNeeded();
      const deck = await deckDensity(page);
      assert.deepEqual(deck.clipped, [], `${width}px clipped labels`);
      assert.deepEqual(deck.shortTargets, [], `${width}px short targets`);
      for (const gap of deck.legendGutters) {
        assert.ok(
          gap >= 2 && gap <= 24,
          `${width}px pin legend sits ${gap}px from its options`,
        );
      }
      for (const slider of deck.sliders) {
        assert.ok(
          slider.width >= 88,
          `${width}px ${slider.name} fader is ${slider.width}px`,
        );
      }
      heights.set(width, deck.height);
    }
    assert.ok(
      heights.get(1440)! > closedHeights.get(1440)! + 80,
      `opening build at 1440px (${closedHeights.get(1440)} -> ${heights.get(1440)}) did not reveal the pins`,
    );
    assert.ok(
      heights.get(320)! > closedHeights.get(320)!,
      `opening build at 320px (${closedHeights.get(320)} -> ${heights.get(320)}) did not grow the deck`,
    );

    /* Half speed is a tempo control, so it must never land below Swing or Seed
       in reading order: a wrapped toggle sat under the row beneath it while the
       tab order still reached it first, which broke keyboard order at
       1081-1200px. Sweep every 20px rather than only the band edges. */
    for (let width = 320; width <= 1600; width += 20) {
      await page.setViewportSize({ width, height: width >= 800 ? 900 : 844 });
      const order = await page.evaluate(() => {
        const box = (selector: string) => {
          const node = document.querySelector(selector);
          if (!node) throw new Error(selector);
          const rect = node.getBoundingClientRect();
          return { top: Math.round(rect.top), left: Math.round(rect.left) };
        };
        return {
          speed: box('.deck-speed'),
          swing: box('.phrase-swing .deck-legend'),
          seed: box('.deck-counter .deck-legend'),
        };
      });
      for (const next of [order.swing, order.seed]) {
        assert.ok(
          order.speed.top <= next.top + 2,
          `${width}px Half speed at ${order.speed.top} sits below a control at ${next.top}`,
        );
      }
    }

    /* One line per pin row on a phone: the whole pin block is at most two
       rows tall for the two four-option fields and one each for the rest,
       so the panel never spends four full lines on pins again. */
    await page.setViewportSize({ width: 320, height: 844 });
    const pins = await page.evaluate(() => {
      const block = document.querySelector('.phrase-pins');
      const rows = [...document.querySelectorAll('.phrase-pin-row')];
      if (!block) throw new Error('pins are missing');
      return {
        height: Math.round(block.getBoundingClientRect().height),
        lines: rows.map((row) => {
          const tops = new Set(
            [...row.querySelectorAll('.phrase-pin')].map((button) =>
              Math.round(button.getBoundingClientRect().top),
            ),
          );
          return tops.size;
        }),
      };
    });
    assert.deepEqual(pins.lines, [2, 2, 1, 1], 'pin rows at 320px');
    await page.close();
  },
);

void test(
  'resizing the deck across a breakpoint keeps focus in Firefox',
  { timeout: 180_000 },
  async (t) => {
    const browser = await launchNamed('firefox', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 1200, height: 900 },
      deviceScaleFactor: 1,
    });
    // Chrome accepts focus() in the same turn a focused node moves. Firefox
    // and Safari can ignore that call and leave the document focused. This
    // page ignores same-turn focus() inside the deck, then allows it on the
    // next frame, so the test locks that later restore.
    await page.addInitScript({
      content: `(() => {
        let blockDeckFocus = false;
        const orig = HTMLElement.prototype.focus;
        HTMLElement.prototype.focus = function () {
          if (blockDeckFocus && this.closest && this.closest('.phrase-deck')) {
            return;
          }
          return orig.apply(this, arguments);
        };
        const arm = (node) => {
          if (!(node instanceof HTMLElement) || !node.closest('.phrase-deck')) {
            return;
          }
          blockDeckFocus = true;
          requestAnimationFrame(() => {
            blockDeckFocus = false;
          });
        };
        const insert = Node.prototype.insertBefore;
        Node.prototype.insertBefore = function (node, child) {
          const result = insert.call(this, node, child);
          arm(node);
          return result;
        };
        const append = Node.prototype.appendChild;
        Node.prototype.appendChild = function (node) {
          const result = append.call(this, node);
          arm(node);
          return result;
        };
      })();`,
    });
    await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.phrase-open');
    await openPhrases(page);
    await openDeckFolds(page);

    async function resizeKeeps(
      from: number,
      to: number,
      focus: () => Promise<void>,
      expected: string,
    ) {
      await page.setViewportSize({
        width: from,
        height: from >= 800 ? 900 : 844,
      });
      if ((await page.locator('.phrase-panel').count()) === 0) {
        await openPhrases(page);
      }
      await focus();
      assert.equal(
        await activeControlName(page),
        expected,
        `focus at ${from}px`,
      );
      await page.setViewportSize({
        width: to,
        height: to >= 800 ? 900 : 844,
      });
      await page.waitForFunction(
        (name) => {
          const node = document.activeElement;
          if (!(node instanceof HTMLElement)) return false;
          if (node === document.body || node === document.documentElement) {
            return false;
          }
          const aria = node.getAttribute('aria-label');
          const legend = node
            .closest('label')
            ?.querySelector('.deck-legend')?.textContent;
          const current = (
            aria ||
            (node instanceof HTMLInputElement ? legend : '') ||
            node.innerText ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          return current === name;
        },
        expected,
        { timeout: 2_000 },
      );
    }

    await resizeKeeps(
      1200,
      800,
      () => page.locator('.phrase-swing input').focus(),
      'Swing',
    );
    await resizeKeeps(
      800,
      390,
      () => page.getByRole('button', { name: 'New phrase' }).focus(),
      'New phrase',
    );
    await resizeKeeps(
      500,
      320,
      () => page.getByRole('button', { name: 'Half speed' }).focus(),
      'Half speed',
    );
    await resizeKeeps(
      320,
      1200,
      () => page.locator('.phrase-swing input').focus(),
      'Swing',
    );
    await page.locator('.phrase-open').focus();
    assert.equal(await activeControlName(page), 'Phrases');
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForFunction(
      () =>
        document.activeElement instanceof HTMLElement &&
        document.activeElement.classList.contains('phrase-open'),
      undefined,
      { timeout: 2_000 },
    );
    await page.close();
  },
);
