import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Page } from 'playwright';
import { PHRASE_HISTORY_KEY } from '../lib/phrase-history.ts';
import { RHYTHM_LABEL, type RhythmId } from '../lib/phrase.ts';
import { TRAY_KEY } from '../lib/tray.ts';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhraseFolds(page: Page) {
  for (const selector of ['.deck-build', '.deck-feel']) {
    const fold = page.locator(selector);
    if ((await fold.getAttribute('open')) === null) {
      await fold.locator('> summary').click();
    }
  }
}

async function openPhrases(page: Page) {
  await page.locator('.phrase-open').click();
  await page.locator('.phrase-panel').waitFor({ state: 'visible' });
  await page.locator('.phrase-action', { hasText: 'Play' }).waitFor();
  await openPhraseFolds(page);
}

async function seedOf(page: Page) {
  return page.locator('.phrase-seed input').inputValue();
}

async function phraseNotes(page: Page) {
  return page.locator('.phrase-panel ol.sr-only li').allTextContents();
}

const menuStepMs = 5_000;

async function controlShows(page: Page, id: string, expected: string) {
  await page.waitForFunction(
    ({ controlId, label }) => {
      const text = document.getElementById(controlId)?.innerText ?? '';
      return text.replace(/\s+/g, ' ').trim().includes(label);
    },
    { controlId: id, label: expected },
    { timeout: menuStepMs },
  );
}

async function chooseRoot(page: Page, name: string) {
  const trigger = page.locator('#explore-root');
  const option = page.getByRole('option', { name, exact: true });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      // The menu returns focus after it closes. Wait until this control
      // shows the note before the next menu opens.
      await trigger.waitFor({ state: 'visible', timeout: menuStepMs });
      await trigger.scrollIntoViewIfNeeded();
      await trigger.click({ timeout: menuStepMs });
      await option.waitFor({ state: 'visible', timeout: menuStepMs });
      await option.click({ timeout: menuStepMs });
      await option.waitFor({ state: 'hidden', timeout: menuStepMs });
      await controlShows(page, 'explore-root', name);
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  throw lastError;
}

async function chooseSearch(
  page: Page,
  searchLabel: string,
  query: string,
  optionName: string | RegExp,
) {
  const trigger = page.locator('#explore-type');
  const input = page.getByRole('combobox', { name: searchLabel });
  const option = page.getByRole('option', {
    name: optionName,
    exact: typeof optionName === 'string',
  });
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      await trigger.waitFor({ state: 'visible', timeout: menuStepMs });
      await trigger.scrollIntoViewIfNeeded();
      if (!(await input.isVisible())) {
        await trigger.click({ timeout: menuStepMs });
      }
      await input.waitFor({ state: 'visible', timeout: menuStepMs });
      await input.fill(query, { timeout: menuStepMs });
      await option.waitFor({ state: 'visible', timeout: menuStepMs });
      const label = (await option.locator('span').first().innerText()).trim();
      await option.click({ timeout: menuStepMs });
      await input.waitFor({ state: 'hidden', timeout: menuStepMs });
      await controlShows(page, 'explore-type', label);
      return;
    } catch (error) {
      lastError = error;
      await page.keyboard.press('Escape').catch(() => {});
    }
  }
  throw lastError;
}

async function historyEntries(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { entries?: unknown };
    return parsed.entries ?? null;
  }, PHRASE_HISTORY_KEY);
}

type PhraseChangeCall = {
  method: 'start' | 'queuePhrase';
  bars: number;
  at: number;
};

async function armPhraseChanges(page: Page) {
  await page.evaluate(async () => {
    const view = window as Window & {
      __phraseChanges?: number;
      __phraseChangeCalls?: PhraseChangeCall[];
      __phraseChangeArmed?: boolean;
    };
    view.__phraseChanges = 0;
    view.__phraseChangeCalls = [];
    view.__phraseChangeArmed = true;
    if ((window as Window & { __phraseHooked?: boolean }).__phraseHooked) {
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
          __phraseChangeCalls?: PhraseChangeCall[];
          __phraseChangeArmed?: boolean;
        };
        if (host.__phraseChangeArmed) {
          host.__phraseChanges = (host.__phraseChanges ?? 0) + 1;
          const bars = (args[0] as { bars?: number } | undefined)?.bars;
          host.__phraseChangeCalls = host.__phraseChangeCalls ?? [];
          host.__phraseChangeCalls.push({
            method,
            bars: bars === 2 || bars === 4 ? bars : 0,
            at: performance.now(),
          });
        }
        return original.apply(this, args);
      };
    };
    count('start');
    count('queuePhrase');
    (window as Window & { __phraseHooked?: boolean }).__phraseHooked = true;
  });
}

async function settledChangeCount(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(() => {
            resolve(
              (window as Window & { __phraseChanges?: number })
                .__phraseChanges ?? -1,
            );
          }, 40);
        });
      }),
  );
}

function phraseChangeCalls(page: Page) {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __phraseChangeCalls?: PhraseChangeCall[];
        }
      ).__phraseChangeCalls ?? [],
  );
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
    const hint = page.locator('#phrase-history-hint');
    assert.match(await hint.innerText(), /Last 3 phrases\./);
    assert.equal(
      await hint.evaluate((node) => node.classList.contains('sr-only')),
      true,
    );
    assert.equal(
      await page.locator('[aria-describedby="phrase-history-hint"]').count(),
      2,
    );

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
    const secondSeed = await seedOf(page);
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

    // A looping pass hands the restored phrase over on the bar line, so the
    // heading, seed, and notes all change at that one moment. Wait for that
    // handoff, then assert the whole restored frame; the key, scale, and
    // chord controls on the page change as soon as Back is pressed.
    await page
      .locator('.phrase-panel ol.sr-only li')
      .filter({ hasText: firstNotes[0] ?? '' })
      .first()
      .waitFor({ timeout: 20_000 });
    assert.deepEqual(await phraseNotes(page), firstNotes);
    assert.equal(await seedOf(page), firstSeed);
    // Two player calls, not one: Back queues the restored phrase behind the
    // bar line and the player then starts it on that downbeat. The notes
    // above have already waited for the handoff, so this is the settled count
    // for the whole Back action rather than a partial one.
    assert.equal(await settledChangeCount(page), 2);
    const calls = await page.evaluate(
      () =>
        (window as Window & { __phraseChangeCalls?: { method: string }[] })
          .__phraseChangeCalls ?? [],
    );
    assert.deepEqual(
      calls.map((call) => call.method),
      ['queuePhrase', 'start'],
      'Back should queue the restored phrase and let the bar line start it',
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

    await page.evaluate(() => {
      const view = window as Window & { __phraseChanges?: number };
      view.__phraseChanges = 0;
    });
    await page.getByRole('button', { name: 'Next phrase' }).click();
    // Next is handed over on a bar line for the same reason Back is, so wait
    // for the restored phrase to sound before counting the change.
    await page
      .locator('.phrase-panel ol.sr-only li')
      .filter({ hasText: secondNotes[0] ?? '' })
      .first()
      .waitFor({ timeout: 20_000 });
    assert.deepEqual(await phraseNotes(page), secondNotes);
    assert.equal(await seedOf(page), secondSeed);
    assert.equal(await settledChangeCount(page), 2);
    assert.deepEqual(await historyEntries(page), stored);
    assert.equal(
      await page.locator('#scales-reference-tab').getAttribute('aria-pressed'),
      'false',
    );
    assert.equal(
      await page
        .getByRole('button', { name: 'Chords' })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.match(await page.locator('#explore-root').innerText(), /C/);
    assert.match(await page.locator('#explore-type').innerText(), /Minor/);
    await page.locator('#drone-toggle').waitFor({ state: 'detached' });
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

void test('back restores a phrase saved on the chords tab', async (t) => {
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
    await page.getByRole('button', { name: 'Chords' }).click();
    await chooseRoot(page, 'C');
    await chooseSearch(page, 'Search chord quality', 'minor', /^Minor m$/);
    await page.getByRole('button', { name: 'New phrase' }).click();
    const chordNotes = await phraseNotes(page);
    assert.ok(chordNotes.length > 2, chordNotes.join(' | '));
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over Cm in A Dorian/,
    );

    await page.getByRole('button', { name: 'Scales & modes' }).click();
    await chooseRoot(page, 'E');
    await chooseSearch(page, 'Search scale / mode', 'mixo', 'Mixolydian');
    assert.notDeepEqual(await phraseNotes(page), chordNotes);
    await page.getByRole('button', { name: 'New phrase' }).click();
    assert.notDeepEqual(await phraseNotes(page), chordNotes);
    const stored = await historyEntries(page);

    await page.getByRole('button', { name: 'Previous phrase' }).click();
    assert.deepEqual(await phraseNotes(page), chordNotes);
    assert.deepEqual(await historyEntries(page), stored);
    assert.equal(
      await page
        .getByRole('button', { name: 'Chords' })
        .getAttribute('aria-pressed'),
      'true',
    );
    assert.equal(
      await page.locator('#scales-reference-tab').getAttribute('aria-pressed'),
      'false',
    );
    assert.match(await page.locator('#explore-root').innerText(), /C/);
    assert.match(await page.locator('#explore-type').innerText(), /Minor/);
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over Cm in A Dorian/,
    );
    assert.equal(
      await page
        .getByRole('button', { name: '4 bars' })
        .getAttribute('aria-pressed'),
      'true',
    );
    await page.locator('#drone-toggle').waitFor({ state: 'detached' });
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});

void test('an identical history write from another tab does not restart playback', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await freshPhrases(page, server.origin, 1280);
    await page.getByRole('button', { name: 'New phrase' }).click();
    const notes = await phraseNotes(page);
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 15000 });
    await armPhraseChanges(page);
    const rewrite = (key: string) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('history missing');
      localStorage.setItem(key, raw);
      window.dispatchEvent(new StorageEvent('storage', { key, newValue: raw }));
    };
    await page.evaluate(() => {
      const view = window as Window & {
        __phraseChanges?: number;
        __phraseChangeCalls?: unknown[];
      };
      view.__phraseChanges = 0;
      view.__phraseChangeCalls = [];
    });
    await page.evaluate(rewrite, PHRASE_HISTORY_KEY);
    assert.equal(await settledChangeCount(page), 0);
    assert.deepEqual(await phraseNotes(page), notes);
    assert.match(
      await page.locator('#phrase-seed-help').innerText(),
      /Playing this phrase\./,
    );

    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 15000 });
    await page.evaluate(() => {
      const view = window as Window & {
        __phraseChanges?: number;
        __phraseChangeCalls?: unknown[];
      };
      view.__phraseChanges = 0;
      view.__phraseChangeCalls = [];
    });
    await page.evaluate(rewrite, PHRASE_HISTORY_KEY);
    assert.equal(await settledChangeCount(page), 0);
    assert.deepEqual(await phraseNotes(page), notes);
    assert.match(
      await page.locator('#phrase-seed-help').innerText(),
      /Looping this phrase\./,
    );
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});

void test('a history step that changes bars queues the next downbeat', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    for (const change of [
      { playing: 4 as const, back: 2 as const },
      { playing: 2 as const, back: 4 as const },
    ]) {
      await freshPhrases(page, server.origin, 1280);
      await page.getByRole('button', { name: `${change.back} bars` }).click();
      await page.getByRole('button', { name: 'New phrase' }).click();
      await page
        .getByRole('button', { name: `${change.playing} bars` })
        .click();
      await page
        .locator('button[aria-pressed="true"]', {
          hasText: `${change.playing} bars`,
        })
        .waitFor();
      await armPhraseChanges(page);
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
          if (head?.dataset.phrasePlayhead !== '1') return false;
          const left = Number.parseFloat(head.style.left);
          return left > 12 && left < 40;
        },
        undefined,
        { timeout: 8000 },
      );
      await page.evaluate(() => {
        const view = window as Window & {
          __phraseChanges?: number;
          __phraseChangeCalls?: unknown[];
        };
        view.__phraseChanges = 0;
        view.__phraseChangeCalls = [];
      });
      await page.getByRole('button', { name: 'Previous phrase' }).click();
      await page
        .locator('button[aria-pressed="true"]', {
          hasText: `${change.back} bars`,
        })
        .waitFor();
      await page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 400)),
      );
      const early = await phraseChangeCalls(page);
      assert.deepEqual(
        early.map((call) => call.method),
        ['queuePhrase'],
        `${change.playing} to ${change.back} did not queue a single change`,
      );
      assert.equal(early[0]?.bars, change.back);
      await page.evaluate(
        () => new Promise((resolve) => setTimeout(resolve, 2800)),
      );
      const later = await phraseChangeCalls(page);
      assert.deepEqual(
        later.map((call) => call.method),
        ['queuePhrase', 'start'],
        `${change.playing} to ${change.back} did not hand off before the pass ended`,
      );
      assert.equal(later[1]?.bars, change.back);
    }
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});

void test('the lock guard ignores a cross-tab write for a different key or phrase and keeps the matching one', async (t) => {
  const browser = await launchNamed('chromium', t);
  const server = await acquireDevServer();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  try {
    await freshPhrases(page, server.origin, 1280);
    await page.getByRole('button', { name: 'New phrase' }).click();
    await page.getByRole('button', { name: 'New phrase' }).click();
    const seed = await seedOf(page);
    const notes = await phraseNotes(page);
    const plan = await page.locator('.phrase-plan').innerText();
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 15000 });
    await armPhraseChanges(page);
    const resetChanges = () =>
      page.evaluate(() => {
        const view = window as Window & {
          __phraseChanges?: number;
          __phraseChangeCalls?: unknown[];
        };
        view.__phraseChanges = 0;
        view.__phraseChangeCalls = [];
      });
    await resetChanges();

    const historyKey = PHRASE_HISTORY_KEY;
    const stored = await page.evaluate(
      (key) => localStorage.getItem(key),
      historyKey,
    );
    assert.ok(stored);
    await page.evaluate(() => {
      const other = 'progger.not-the-phrase-history';
      localStorage.setItem(other, '{"version":1,"entries":[],"index":-1}');
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: other,
          newValue: localStorage.getItem(other),
        }),
      );
    });
    assert.equal(await settledChangeCount(page), 0);
    assert.equal(
      await page.evaluate((key) => localStorage.getItem(key), historyKey),
      stored,
    );
    assert.deepEqual(await phraseNotes(page), notes);
    assert.equal(await page.locator('.phrase-plan').innerText(), plan);
    assert.match(
      await page.locator('#phrase-seed-help').innerText(),
      /Playing this phrase\./,
    );

    await resetChanges();
    const otherPhrase = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) throw new Error('history missing');
      const parsed = JSON.parse(raw) as {
        entries: { seed: number }[];
        index: number;
      };
      const index = parsed.entries.findIndex(
        (_, entry) => entry !== parsed.index,
      );
      const entry = parsed.entries[index];
      if (!entry || index < 0) throw new Error('no other phrase');
      const previous = entry.seed;
      entry.seed = (previous + 97) >>> 0;
      const next = JSON.stringify(parsed);
      localStorage.setItem(key, next);
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue: next }),
      );
      return { previous, seed: entry.seed };
    }, historyKey);
    assert.notEqual(otherPhrase.seed, otherPhrase.previous);
    assert.equal(await settledChangeCount(page), 0);
    assert.equal(await seedOf(page), seed);
    assert.deepEqual(await phraseNotes(page), notes);
    assert.equal(await page.locator('.phrase-plan').innerText(), plan);
    assert.match(
      await page.locator('#phrase-seed-help').innerText(),
      /Playing this phrase\./,
    );

    await resetChanges();
    const rhythms: readonly { id: RhythmId; label: string }[] = [
      { id: 'eighths', label: RHYTHM_LABEL.eighths },
      { id: 'quarters', label: RHYTHM_LABEL.quarters },
      { id: 'push', label: RHYTHM_LABEL.push },
      { id: 'long-short', label: RHYTHM_LABEL['long-short'] },
    ];
    const rhythm = rhythms.find((item) => !plan.includes(item.label));
    assert.ok(rhythm, plan);
    await page.evaluate(
      ({ key, id }) => {
        const raw = localStorage.getItem(key);
        if (!raw) throw new Error('history missing');
        const parsed = JSON.parse(raw) as {
          entries: { locks?: { rhythm?: string } }[];
          index: number;
        };
        const entry = parsed.entries[parsed.index];
        if (!entry) throw new Error('the showing phrase is missing');
        entry.locks = { ...entry.locks, rhythm: id };
        const next = JSON.stringify(parsed);
        localStorage.setItem(key, next);
        window.dispatchEvent(
          new StorageEvent('storage', { key, newValue: next }),
        );
      },
      { key: historyKey, id: rhythm.id },
    );
    await page
      .locator('.phrase-plan', { hasText: rhythm.label })
      .waitFor({ timeout: 5000 });
    const calls = await phraseChangeCalls(page);
    assert.ok(
      calls.some((call) => call.method === 'start'),
      `the matching phrase was not played: ${JSON.stringify(calls)}`,
    );
    assert.match(
      await page.locator('.phrase-plan').innerText(),
      new RegExp(rhythm.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 15000 });
  } finally {
    await page.close();
    await browser.close();
    await server.release();
  }
});
