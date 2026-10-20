import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { PHRASE_HISTORY_KEY } from '../lib/phrase-history.ts';
import { TRAY_KEY } from '../lib/tray.ts';
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

async function phraseNotes(page: Page) {
  return page.locator('.phrase-panel ol.sr-only li').allTextContents();
}

async function chooseRoot(page: Page, name: string) {
  const trigger = page.locator('#explore-root');
  await trigger.scrollIntoViewIfNeeded();
  await trigger.click();
  const option = page.getByRole('option', { name, exact: true });
  await option.click();
  // The root menu returns focus after it closes. A scale click in that
  // window is swallowed, so wait until the chosen option is gone.
  await option.waitFor({ state: 'hidden' });
}

async function chooseSearch(
  page: Page,
  searchLabel: string,
  query: string,
  option: string | RegExp,
) {
  const input = page.getByRole('combobox', { name: searchLabel });
  const trigger = page.locator('#explore-type');
  await trigger.scrollIntoViewIfNeeded();
  let opened = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4 && !opened; attempt += 1) {
    if (!(await input.isVisible())) await trigger.click();
    try {
      await input.waitFor({ state: 'visible', timeout: 2000 });
      opened = true;
    } catch (error) {
      lastError = error;
    }
  }
  if (!opened) throw lastError;
  try {
    await input.fill(query);
  } catch {
    if (!(await input.isVisible())) await trigger.click();
    await input.waitFor({ state: 'visible' });
    await input.fill(query);
  }
  await page
    .getByRole('option', {
      name: option,
      exact: typeof option === 'string',
    })
    .click();
}

async function historyEntries(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { entries?: unknown };
    return parsed.entries ?? null;
  }, PHRASE_HISTORY_KEY);
}

async function armPhraseChanges(page: Page) {
  await page.evaluate(async () => {
    const view = window as Window & {
      __phraseChanges?: number;
      __phraseChangeArmed?: boolean;
    };
    view.__phraseChanges = 0;
    view.__phraseChangeArmed = true;
    if (
      view.__phraseChangeArmed &&
      (window as Window & { __phraseHooked?: boolean }).__phraseHooked
    ) {
      return;
    }
    const urls = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => name.includes('phrase-audio'));
    if (!urls.length) throw new Error('phrase audio was not loaded');
    const imported = (await import(
      /* @vite-ignore */ urls[urls.length - 1]
    )) as {
      PhrasePlayer: {
        prototype: {
          start: (...args: unknown[]) => unknown;
          queuePhrase: (...args: unknown[]) => unknown;
        };
      };
    };
    const proto = imported.PhrasePlayer.prototype;
    const count = (method: 'start' | 'queuePhrase') => {
      const original = proto[method];
      proto[method] = function counted(this: unknown, ...args: unknown[]) {
        const host = window as Window & {
          __phraseChanges?: number;
          __phraseChangeArmed?: boolean;
        };
        if (host.__phraseChangeArmed) {
          host.__phraseChanges = (host.__phraseChanges ?? 0) + 1;
        }
        return original.apply(this, args);
      };
    };
    count('start');
    count('queuePhrase');
    (window as Window & { __phraseHooked?: boolean }).__phraseHooked = true;
  });
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
    // Still inside this bar. The queued change waits for the loop seam
    // today, and for the next bar line once that timing lands. Neither
    // cuts the sounding pass in this window.
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

void test('back restores the key, scale, chord, and notes together', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.evaluate(
      ([historyKey, trayKey]) => {
        localStorage.removeItem(historyKey);
        localStorage.removeItem(trayKey);
      },
      [PHRASE_HISTORY_KEY, TRAY_KEY],
    );
    await openPhrases(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await chooseRoot(page, 'E');
    await chooseSearch(page, 'Search scale / mode', 'mixo', 'Mixolydian');
    await page.getByRole('button', { name: 'New phrase' }).click();
    const firstNotes = await phraseNotes(page);
    const firstSeed = await seedOf(page);
    assert.ok(firstNotes.length > 2, firstNotes.join(' | '));
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over E tonic in E Mixolydian/,
    );

    await chooseRoot(page, 'C');
    await chooseSearch(page, 'Search scale / mode', 'dorian', 'Dorian');
    await page.getByRole('button', { name: 'Chords' }).click();
    await chooseSearch(page, 'Search chord quality', 'minor', /^Minor m$/);
    const drifted = await phraseNotes(page);
    assert.notDeepEqual(drifted, firstNotes);
    await page.getByRole('button', { name: 'New phrase' }).click();
    const secondNotes = await phraseNotes(page);
    assert.notDeepEqual(secondNotes, firstNotes);
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over Cm in C Dorian/,
    );
    const stored = await historyEntries(page);

    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 15000 });
    await armPhraseChanges(page);
    await page.getByRole('button', { name: 'Previous phrase' }).click();

    assert.deepEqual(await phraseNotes(page), firstNotes);
    assert.equal(await seedOf(page), firstSeed);
    assert.equal(
      await page.evaluate(
        () =>
          (window as Window & { __phraseChanges?: number }).__phraseChanges ??
          -1,
      ),
      1,
    );
    assert.deepEqual(await historyEntries(page), stored);
    assert.equal(
      await page
        .getByRole('button', { name: '4 bars' })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.match(await page.locator('#explore-root').innerText(), /E/);
    assert.match(await page.locator('#explore-type').innerText(), /Mixolydian/);
    assert.equal(
      await page.locator('#scales-reference-tab').getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Chords' })
        .getAttribute('aria-pressed'),
      'false',
    );
    assert.match(await page.locator('#drone-legend-hint').innerText(), /E/);
    assert.equal(
      await page.locator('#drone-toggle').getAttribute('aria-pressed'),
      'false',
    );
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over E tonic in E Mixolydian/,
    );
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});

void test('a reload in another key steps back to the last saved phrase', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.evaluate(
      (key) => localStorage.removeItem(key),
      PHRASE_HISTORY_KEY,
    );
    await openPhrases(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await chooseRoot(page, 'E');
    await chooseSearch(page, 'Search scale / mode', 'mixo', 'Mixolydian');
    await page.getByRole('button', { name: 'New phrase' }).click();
    const savedNotes = await phraseNotes(page);
    const savedSeed = await seedOf(page);
    const raw = await page.evaluate(
      (key) => localStorage.getItem(key),
      PHRASE_HISTORY_KEY,
    );
    await page.reload({ waitUntil: 'networkidle' });
    await openPhrases(page);
    assert.notEqual(await seedOf(page), savedSeed);
    assert.match(await page.locator('#explore-root').innerText(), /A/);
    assert.equal(
      await page.getByRole('button', { name: 'Previous phrase' }).isDisabled(),
      false,
    );
    await page.getByRole('button', { name: 'Previous phrase' }).click();
    assert.equal(
      await page.evaluate(
        (key) => localStorage.getItem(key),
        PHRASE_HISTORY_KEY,
      ),
      raw,
    );
    assert.equal(await seedOf(page), savedSeed);
    assert.deepEqual(await phraseNotes(page), savedNotes);
    assert.match(await page.locator('#explore-root').innerText(), /E/);
    assert.match(await page.locator('#explore-type').innerText(), /Mixolydian/);
    assert.equal(
      await page
        .getByRole('button', { name: '4 bars' })
        .getAttribute('aria-pressed'),
      'true',
    );
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});

void test('a stashed phrase from another key survives new and back', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.evaluate(
      ([historyKey, trayKey]) => {
        localStorage.removeItem(historyKey);
        localStorage.removeItem(trayKey);
      },
      [PHRASE_HISTORY_KEY, TRAY_KEY],
    );
    await chooseRoot(page, 'E');
    await chooseSearch(page, 'Search scale / mode', 'mixo', 'Mixolydian');
    await openPhrases(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await page.getByRole('button', { name: 'Save to stash' }).click();
    await page.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const stashed = await phraseNotes(page);
    await chooseRoot(page, 'C');
    await chooseSearch(page, 'Search scale / mode', 'dorian', 'Dorian');
    assert.notDeepEqual(await phraseNotes(page), stashed);
    await page.getByRole('button', { name: 'Stash, 1 saved' }).click();
    await page.getByRole('button', { name: 'Open' }).click();
    assert.deepEqual(await phraseNotes(page), stashed);
    const before = await historyEntries(page);
    await page.getByRole('button', { name: 'New phrase' }).click();
    assert.notDeepEqual(await phraseNotes(page), stashed);
    const generated = await historyEntries(page);
    assert.notDeepEqual(generated, before);
    await page.getByRole('button', { name: 'Previous phrase' }).click();
    assert.deepEqual(await phraseNotes(page), stashed);
    assert.deepEqual(await historyEntries(page), generated);
    assert.match(await page.locator('#explore-root').innerText(), /E/);
    assert.match(await page.locator('#explore-type').innerText(), /Mixolydian/);
    assert.match(await page.locator('#drone-legend-hint').innerText(), /E/);
    assert.equal(
      await page.locator('#drone-toggle').getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(
      await page
        .getByRole('button', { name: '4 bars' })
        .getAttribute('aria-pressed'),
      'true',
    );
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});
