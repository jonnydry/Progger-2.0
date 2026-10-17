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

type Row = {
  bar: Box;
  phrases: Box;
  toggle: Box | null;
  walk: Box | null;
  volume: Box | null;
  rule: Box | null;
  overflow: number;
  soundNameShown: boolean;
  phrasesLabel: string;
  droneOn: string | null;
  expanded: string | null;
  panel: Box | null;
  host: Box | null;
};

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.right - 0.5 &&
    a.right > b.left + 0.5 &&
    a.top < b.bottom - 0.5 &&
    a.bottom > b.top + 0.5
  );
}

async function readRow(page: Page): Promise<Row> {
  return page.evaluate(() => {
    const read = (node: Element | null) => {
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 && rect.height < 1) return null;
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        width: rect.width,
        height: rect.height,
      };
    };
    const bar = document.querySelector('.practice-bar');
    const phrases = document.querySelector('.phrase-open');
    if (!bar || !phrases) throw new Error('practice bar is missing');
    const sound = document.querySelector('.drone-sound-name');
    const soundNameShown = !!(
      sound &&
      getComputedStyle(sound).display !== 'none' &&
      sound.getBoundingClientRect().width > 0
    );
    const panel = read(document.querySelector('#phrase-practice'));
    const hostNode = document.querySelector('#phrase-tab-host');
    const host =
      hostNode instanceof HTMLElement &&
      getComputedStyle(hostNode).display !== 'none'
        ? read(hostNode)
        : null;
    return {
      bar: read(bar)!,
      phrases: read(phrases)!,
      toggle: read(document.querySelector('#drone-toggle')),
      walk: read(document.querySelector('#drone-walk')),
      volume: read(document.querySelector('#drone-volume-trigger')),
      rule: read(document.querySelector('.practice-bar-rule')),
      overflow: bar.scrollWidth - bar.clientWidth,
      soundNameShown,
      phrasesLabel: phrases.textContent?.replace(/\s+/g, ' ').trim() ?? '',
      droneOn: document
        .querySelector('#drone-toggle')
        ?.getAttribute('aria-pressed') ?? null,
      expanded: phrases.getAttribute('aria-expanded'),
      panel,
      host,
    };
  });
}

function assertSharedRow(row: Row, width: number) {
  assert.equal(row.phrasesLabel, 'Phrases', `${width}px label`);
  assert.ok(row.overflow <= 1, `${width}px bar overflow ${row.overflow}px`);
  assert.ok(row.toggle, `${width}px drone toggle`);
  assert.ok(row.walk, `${width}px walk`);
  assert.ok(row.volume, `${width}px volume`);
  assert.ok(row.rule, `${width}px divider`);
  const toggle = row.toggle!;
  const walk = row.walk!;
  const volume = row.volume!;
  const rule = row.rule!;
  assert.ok(
    Math.abs(row.phrases.top - toggle.top) <= 4,
    `${width}px phrases top ${row.phrases.top} toggle ${toggle.top}`,
  );
  assert.ok(
    Math.abs(row.phrases.height - 44) <= 1 &&
      Math.abs(toggle.height - 44) <= 1,
    `${width}px heights phrases ${row.phrases.height} toggle ${toggle.height}`,
  );
  assert.ok(row.phrases.left > toggle.right, `${width}px phrases is left of the toggle`);
  assert.ok(
    row.phrases.right <= row.bar.right + 1,
    `${width}px phrases spills past the bar`,
  );
  for (const [name, box] of [
    ['toggle', toggle],
    ['walk', walk],
    ['volume', volume],
    ['rule', rule],
  ] as const) {
    assert.equal(
      overlaps(row.phrases, box),
      false,
      `${width}px phrases overlaps ${name}`,
    );
  }
  assert.equal(
    row.soundNameShown,
    width > 500,
    `${width}px sound name shown ${row.soundNameShown}`,
  );
}

void test(
  'phrases and the drone toggle share one row at desktop and phone widths',
  { timeout: 120_000 },
  async (t) => {
    const browser: Browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    t.after(async () => {
      await browser.close();
      await server.release();
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor: 1,
    });
    await page.goto(`${server.origin}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#drone-toggle');
    await page.waitForSelector('.phrase-open');

    for (const width of [1280, 414, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForSelector('#drone-toggle');
      const closed = await readRow(page);
      assert.equal(closed.expanded, 'false', `${width}px starts closed`);
      assert.equal(closed.droneOn, 'false', `${width}px drone stays off`);
      assertSharedRow(closed, width);

      await page.locator('.practice-bar').scrollIntoViewIfNeeded();
      await page.locator('#drone-volume-trigger').click();
      await page.waitForFunction(() => {
        const pop = document.querySelector('#drone-volume-popover');
        return (
          pop instanceof HTMLElement &&
          getComputedStyle(pop).visibility !== 'hidden'
        );
      });
      const anchor = await page.evaluate(() => {
        const trigger = document
          .querySelector('#drone-volume-trigger')!
          .getBoundingClientRect();
        const pop = document
          .querySelector('#drone-volume-popover')!
          .getBoundingClientRect();
        return {
          side: document
            .querySelector('#drone-volume-popover')!
            .getAttribute('data-side'),
          triggerTop: trigger.top,
          triggerBottom: trigger.bottom,
          triggerLeft: trigger.left,
          popTop: pop.top,
          popBottom: pop.bottom,
          popLeft: pop.left,
        };
      });
      assert.ok(
        anchor.side === 'below' || anchor.side === 'above',
        `${width}px volume menu side ${anchor.side}`,
      );
      const gap =
        anchor.side === 'below'
          ? anchor.popTop - anchor.triggerBottom
          : anchor.triggerTop - anchor.popBottom;
      assert.ok(
        gap >= 6 && gap <= 12,
        `${width}px volume menu gap ${gap} on ${anchor.side}`,
      );
      assert.ok(
        Math.abs(anchor.popLeft - anchor.triggerLeft) <= 2,
        `${width}px volume menu left ${anchor.popLeft} trigger ${anchor.triggerLeft}`,
      );
      await page.keyboard.press('Escape');
      await page.waitForSelector('#drone-volume-popover', { state: 'detached' });

      await page.locator('.phrase-open').click();
      await page.locator('#phrase-practice').waitFor({ state: 'visible' });
      await page.locator('.phrase-panel').waitFor({ state: 'visible' });
      await page.locator('#phrase-tab-host .phrase-staff').waitFor({
        state: 'visible',
      });
      const open = await readRow(page);
      assert.equal(open.expanded, 'true', `${width}px phrases opens`);
      assert.equal(open.droneOn, 'false', `${width}px opening phrases starts the drone`);
      assertSharedRow(open, width);
      assert.ok(open.panel, `${width}px panel`);
      assert.ok(open.host, `${width}px tab host`);
      assert.ok(
        Math.abs(open.panel!.left - open.bar.left) <= 2 &&
          Math.abs(open.panel!.width - open.bar.width) <= 2,
        `${width}px panel is not the full bar`,
      );
      assert.ok(
        open.panel!.top >= open.bar.bottom - 1,
        `${width}px panel overlaps the bar`,
      );
      assert.ok(
        Math.abs(open.host!.left - open.bar.left) <= 2 &&
          Math.abs(open.host!.width - open.bar.width) <= 2,
        `${width}px tab host is not the full bar`,
      );
      assert.ok(
        open.host!.top >= open.bar.bottom - 1,
        `${width}px tab host overlaps the bar`,
      );

      await page.locator('.phrase-open').click();
      await page.locator('#phrase-practice').waitFor({ state: 'detached' });
      await page.getByRole('button', { name: 'Chords', exact: true }).click();
      await page.waitForSelector('#drone-toggle', { state: 'detached' });
      const chords = await readRow(page);
      assert.equal(chords.toggle, null, `${width}px chord mode still shows the drone`);
      assert.equal(chords.rule, null, `${width}px chord mode still shows the divider`);
      assert.equal(chords.expanded, 'false');
      assert.ok(
        Math.abs(chords.phrases.top - chords.bar.top) <= 4,
        `${width}px chord phrases leaves the bar`,
      );
      assert.ok(
        Math.abs(chords.phrases.right - chords.bar.right) <= 2,
        `${width}px chord phrases right ${chords.phrases.right} bar ${chords.bar.right}`,
      );
      assert.ok(chords.overflow <= 1, `${width}px chord bar overflow`);
      assert.equal(chords.phrasesLabel, 'Phrases');

      await page.locator('#scales-reference-tab').click();
      await page.waitForSelector('#drone-toggle');
    }
    await page.close();
  },
);
