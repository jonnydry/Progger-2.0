import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  const button = page.locator('.phrase-open');
  await button.waitFor();
  // The server-rendered button accepts a click before React attaches its
  // handler, so wait for React before clicking.
  await page.waitForFunction(() => {
    const node = document.querySelector('.phrase-open');
    if (!node) return false;
    return Object.keys(node).some((key) => key.startsWith('__reactProps'));
  });
  await button.click();
  try {
    await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  } catch (error) {
    if ((await button.getAttribute('aria-expanded')) === 'true') throw error;
    await button.click();
    await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  }
  await page.locator('.phrase-action', { hasText: 'Play' }).waitFor();
  for (const selector of ['.deck-build', '.deck-feel']) {
    const fold = page.locator(selector);
    if ((await fold.getAttribute('open')) === null) {
      await fold.locator('> summary').click();
    }
  }
}

type StaffSample = {
  head: string | null;
  notes: string[];
  bars: string[];
};

/** Read the staff's playhead and sounding marks on every frame. */
async function sampleStaff(page: Page) {
  await page.evaluate(() => {
    const view = window as Window & { __staffSamples?: StaffSample[] };
    view.__staffSamples = [];
    const sample = () => {
      const head = document.querySelector<HTMLElement>(
        '[data-phrase-playhead]:not([hidden])',
      );
      const marks = [
        ...document.querySelectorAll<HTMLElement>(
          '[data-phrase-note].is-current',
        ),
      ];
      view.__staffSamples?.push({
        head: head?.dataset.phrasePlayhead ?? null,
        notes: marks.map((mark) => mark.dataset.phraseNote ?? ''),
        bars: marks.map(
          (mark) =>
            mark.closest<HTMLElement>('[data-phrase-bar]')?.dataset.phraseBar ??
            '',
        ),
      });
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

async function staffSamples(page: Page) {
  return page.evaluate(() => {
    const view = window as Window & { __staffSamples?: StaffSample[] };
    return view.__staffSamples ?? [];
  });
}

/**
 * The playhead looks its heads and marks up once per run of its effect,
 * not on every frame. A bar change mid-loop swaps in a staff with rows 3
 * and 4, which the 2-bar staff never had, so the playhead only reaches them
 * if the lookup was redone for the new staff.
 */
void test('the staff playhead follows the sounding note into a new 4-bar staff', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await openPhrases(page);
    await page
      .locator('button[aria-pressed="true"]', { hasText: '2 bars' })
      .waitFor();
    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('.phrase-action[aria-pressed="true"]', { hasText: 'Loop' })
      .waitFor();
    await sampleStaff(page);
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () =>
        document.querySelector<HTMLElement>(
          '[data-phrase-playhead]:not([hidden])',
        )?.dataset.phrasePlayhead === '2',
      undefined,
      { timeout: 8000 },
    );
    const twoBar = await page
      .locator('[data-phrase-bar]')
      .evaluateAll((nodes) =>
        nodes.map((node) => (node as HTMLElement).dataset.phraseBar),
      );
    assert.equal(twoBar.includes('3'), false, twoBar.join(','));

    await page.getByRole('button', { name: '4 bars' }).click();
    // The new staff arrives at the pass boundary. Its bar 3 row and the
    // notes in it are new elements.
    await page.locator('[data-phrase-bar="3"]').waitFor({ timeout: 15000 });
    await page.waitForFunction(
      () => {
        const view = window as Window & { __staffSamples?: StaffSample[] };
        return (view.__staffSamples ?? []).some(
          ({ head, bars }) =>
            head === '3' && bars.some((bar) => bar === '3' || bar === '4'),
        );
      },
      undefined,
      { timeout: 15000 },
    );

    const samples = await staffSamples(page);
    assert.ok(samples.length > 60, `only ${samples.length} frames sampled`);
    for (const { head, notes, bars } of samples) {
      if (notes.length === 0) continue;
      // One sounding note, marked on the finger lane and on the tab line.
      assert.equal(notes.length, 2, `marks ${notes.join(',')} at ${head}`);
      assert.equal(notes[0], notes[1], `marks ${notes.join(',')} at ${head}`);
      assert.equal(bars[0], bars[1], `marks in bars ${bars.join(',')}`);
      assert.notEqual(head, null, 'a note was marked with no playhead');
    }
    const sounded = new Set(
      samples.flatMap(({ notes, bars }) =>
        notes.length ? [`${bars[0]}:${notes[0]}`] : [],
      ),
    );
    assert.ok(sounded.size >= 4, [...sounded].join(' '));
    const heads = new Set(samples.map(({ head }) => head));
    for (const bar of ['1', '2', '3']) {
      assert.ok(heads.has(bar), `playhead never reached bar ${bar}`);
    }
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});
