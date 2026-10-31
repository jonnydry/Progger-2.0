import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { TRAY_KEY } from '../lib/tray.ts';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

async function openPhrases(page: Page) {
  const button = page.locator('.phrase-open');
  await button.waitFor();
  // The server-rendered button accepts a click before React attaches its
  // handler. networkidle does not wait for that, so on a busy runner the
  // click is lost and .phrase-panel never appears.
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

async function watchRestart(page: Page) {
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
}

async function restartFlags(page: Page) {
  return page.evaluate(() => {
    const view = window as Window & {
      __phraseSawStarting?: boolean;
      __phraseRestarted?: boolean;
    };
    return {
      sawStarting: view.__phraseSawStarting === true,
      restarted: view.__phraseRestarted === true,
    };
  });
}

async function playLooping(page: Page) {
  await page
    .locator('button[aria-pressed="true"]', { hasText: '2 bars' })
    .waitFor();
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
}

/** What the screen is describing: the spoken note list follows the frame. */
async function phraseNotes(page: Page) {
  return page.locator('.phrase-panel ol.sr-only li').allTextContents();
}

async function staffBars(page: Page) {
  return page
    .locator('[data-phrase-bar]')
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.phraseBar),
    );
}

async function seedOf(page: Page) {
  return page.locator('.phrase-seed input').inputValue();
}

/** Wait for the seed control to leave `before`, instead of trusting one read. */
async function seedChangedFrom(page: Page, before: string) {
  await page.waitForFunction(
    (previous) => {
      const input =
        document.querySelector<HTMLInputElement>('.phrase-seed input');
      return input !== null && input.value !== '' && input.value !== previous;
    },
    before,
    { timeout: 5000 },
  );
  return seedOf(page);
}

/** Record any change to the spoken note list until read back. */
async function watchNotes(page: Page) {
  await page.evaluate(() => {
    const view = window as Window & { __phraseNotesChanged?: boolean };
    view.__phraseNotesChanged = false;
    const list = document.querySelector('.phrase-panel ol.sr-only');
    if (!list) return;
    const before = list.textContent ?? '';
    new MutationObserver(() => {
      if ((list.textContent ?? '') !== before) {
        view.__phraseNotesChanged = true;
      }
    }).observe(list, { childList: true, characterData: true, subtree: true });
  });
}

async function notesChanged(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & { __phraseNotesChanged?: boolean })
        .__phraseNotesChanged === true,
  );
}

/**
 * A looping pass hands the next phrase off at the following bar line.
 * At 40 BPM that line is six seconds out. Choosing a root from the menu
 * can outlast it on a busy runner, and the screen then adopts the queued
 * phrase — which is what playback should do, and what makes a stash
 * snapshot of the sounding chord fail. This parks that handoff until the
 * test has saved: from the moment "Looping this phrase." is visible, the
 * audio clock stays where it is, and a timer longer than a scheduler
 * tick never fires. Clicks, the root menu, and the stash write still run.
 *
 * The threshold sits above the 25 ms scheduler tick and the 150 ms
 * lookahead, and below a 40 BPM bar. A delay of 400 ms still runs: the
 * root menu's select gate uses that delay.
 */
const PHRASE_HANDOFF_HOLD = `(() => {
  const nativeTimeout = window.setTimeout.bind(window);
  const nativeClear = window.clearTimeout.bind(window);
  let hold = false;
  const parked = new Map();
  let parkId = 1000000000;
  window.setTimeout = function (fn, ms) {
    const delay = ms == null ? 0 : Number(ms);
    if (hold && delay > 400) {
      const id = parkId++;
      parked.set(id, true);
      return id;
    }
    return nativeTimeout.apply(window, arguments);
  };
  window.clearTimeout = function (id) {
    if (parked.has(id)) {
      parked.delete(id);
      return;
    }
    return nativeClear(id);
  };
  // currentTime lives on BaseAudioContext, not AudioContext.
  const desc = Object.getOwnPropertyDescriptor(
    BaseAudioContext.prototype,
    'currentTime',
  );
  if (!desc || typeof desc.get !== 'function' || !desc.configurable) {
    window.__phraseHoldReady = false;
    return;
  }
  const read = desc.get;
  const frozen = new WeakMap();
  Object.defineProperty(BaseAudioContext.prototype, 'currentTime', {
    configurable: true,
    enumerable: Boolean(desc.enumerable),
    get() {
      const real = read.call(this);
      if (!hold) return real;
      let cap = frozen.get(this);
      if (cap === undefined) {
        cap = real;
        frozen.set(this, cap);
      }
      return cap;
    },
  });
  window.__holdPhraseHandoff = () => {
    hold = true;
  };
  window.__phraseHoldReady = true;
})();`;

async function installPhraseHandoffHold(page: Page) {
  await page.addInitScript({ content: PHRASE_HANDOFF_HOLD });
}

async function holdPhraseHandoff(page: Page) {
  const ready = await page.evaluate(() => {
    const view = window as Window & {
      __phraseHoldReady?: boolean;
      __holdPhraseHandoff?: () => void;
    };
    if (view.__phraseHoldReady !== true || !view.__holdPhraseHandoff) {
      return false;
    }
    view.__holdPhraseHandoff();
    return true;
  });
  assert.equal(ready, true, 'phrase handoff hold did not install');
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

/**
 * Choosing a new length while Loop is on must not restart the pass.
 * start() would flash "Starting…". The queued phrase waits for the next
 * bar line, which is still ahead of this check.
 */
void test('choosing bars while Loop is on does not restart the pass', async (t) => {
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
    await playLooping(page);
    const soundingNotes = await phraseNotes(page);
    const soundingBars = await staffBars(page);
    assert.ok(soundingBars.length >= 2, soundingBars.join(','));
    assert.equal(soundingBars.includes('3'), false, soundingBars.join(','));
    await watchRestart(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 800)),
    );
    const flags = await restartFlags(page);
    assert.equal(
      flags.restarted,
      false,
      'choosing bars restarted playback from bar 1',
    );
    assert.equal(flags.sawStarting, false);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Looping this phrase\./);
    // The staff must keep rowing the sounding 2-bar phrase by its own bar
    // count, not by the queued 4-bar selection.
    assert.deepEqual(
      await staffBars(page),
      soundingBars,
      'staff re-rowed the sounding phrase with the queued bar count',
    );
    assert.deepEqual(await phraseNotes(page), soundingNotes);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * A bar change during the cadence after Loop is turned off must not cut
 * that pass. The new phrase waits until the closing note has finished.
 */
void test('choosing bars while a pass is finishing does not restart it', async (t) => {
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
    await playLooping(page);
    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 2000 });
    await watchRestart(page);
    await page.getByRole('button', { name: '4 bars' }).click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 800)),
    );
    const flags = await restartFlags(page);
    assert.equal(
      flags.restarted,
      false,
      'choosing bars restarted the finishing pass from bar 1',
    );
    assert.equal(flags.sawStarting, false);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Playing this phrase\./);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

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

/**
 * Two quick New presses during a loop queue only the second phrase. The
 * first is dropped by the player without ever sounding, so the screen —
 * which holds the sounding phrase until the handoff — must never show it.
 * Showing the sounding notes unchanged after both presses proves the hold
 * kept the frame that is actually playing.
 */
void test('two quick New phrases while Loop is on never show the dropped phrase', async (t) => {
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
    await playLooping(page);
    const soundingNotes = await phraseNotes(page);
    const soundingSeed = await seedOf(page);
    assert.ok(soundingNotes.length > 2, soundingNotes.join(' | '));
    await watchNotes(page);

    await page.getByRole('button', { name: 'New phrase' }).click();
    const droppedSeed = await seedChangedFrom(page, soundingSeed);
    await page.getByRole('button', { name: 'New phrase' }).click();
    const queuedSeed = await seedChangedFrom(page, droppedSeed);
    assert.notEqual(queuedSeed, soundingSeed);

    // Still inside the sounding pass: the handoff bar line is ahead, and
    // the note list must not have moved at any point in between.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 300)),
    );
    assert.equal(
      await notesChanged(page),
      false,
      'screen showed a phrase the player is not sounding',
    );
    assert.deepEqual(await phraseNotes(page), soundingNotes);
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Looping this phrase\./);

    // The queued phrase — never the dropped one — takes over at the seam
    // and keeps looping.
    await page.waitForFunction(
      (before) => {
        const now = Array.from(
          document.querySelectorAll('.phrase-panel ol.sr-only li'),
        ).map((node) => node.textContent ?? '');
        return JSON.stringify(now) !== JSON.stringify(before);
      },
      soundingNotes,
      { timeout: 10000 },
    );
    assert.equal(await seedOf(page), queuedSeed);
    assert.match(
      await page.locator('#phrase-seed-help').innerText(),
      /Looping this phrase\./,
    );
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * After Loop is turned off, the pass is finishing its cadence. A New phrase
 * then waits in the player until that cadence ends, so the screen must keep
 * showing the finishing phrase — and then adopt the queued one when it
 * starts, not stay frozen.
 */
void test('New phrase while a pass is finishing keeps the finishing phrase on screen', async (t) => {
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
    await playLooping(page);
    const finishingNotes = await phraseNotes(page);
    assert.ok(finishingNotes.length > 2, finishingNotes.join(' | '));

    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 2000 });
    await page.getByRole('button', { name: 'New phrase' }).click();
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 400)),
    );
    assert.deepEqual(
      await phraseNotes(page),
      finishingNotes,
      'notation swapped while the finishing cadence was still sounding',
    );
    const status = await page.locator('#phrase-seed-help').innerText();
    assert.match(status, /Playing this phrase\./);

    // The queued phrase takes over once the cadence has finished, and
    // is itself playing — not merely revealed by playback stopping.
    await page.waitForFunction(
      (before) => {
        const now = Array.from(
          document.querySelectorAll('.phrase-panel ol.sr-only li'),
        ).map((node) => node.textContent ?? '');
        return JSON.stringify(now) !== JSON.stringify(before);
      },
      finishingNotes,
      { timeout: 10000 },
    );
    assert.match(
      await page.locator('#phrase-seed-help').innerText(),
      /Playing this phrase\./,
    );
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * Saving while a replacement waits for the bar line must stash the phrase
 * that is sounding — its key, scale, tempo, swing, seed, and notes — not
 * the live selection the controls have already moved on to. A slow tempo
 * stretches the bar so every control move lands before the handoff.
 */
void test('saving while a phrase waits for the bar line stashes the sounding phrase', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await installPhraseHandoffHold(page);
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.evaluate((key) => localStorage.removeItem(key), TRAY_KEY);
    await chooseRoot(page, 'E');
    await openPhrases(page);
    const panel = page.locator('.phrase-panel');
    const scaleId = await panel.getAttribute('data-scale-id');
    const scaleName = (
      await page.locator('.phrase-heading p').innerText()
    ).trim();

    // Slowest tempo and a touch of swing, set before anything sounds.
    const tempoInput = page.locator(
      'label.phrase-tempo:not(.phrase-swing) input',
    );
    await tempoInput.focus();
    await page.keyboard.press('Home');
    assert.equal(await tempoInput.inputValue(), '40');
    const swingInput = page.locator('label.phrase-swing input');
    await swingInput.focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    const soundingSwing = Number(await swingInput.inputValue());
    assert.ok(soundingSwing > 0, String(soundingSwing));

    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('.phrase-action[aria-pressed="true"]', { hasText: 'Loop' })
      .waitFor();
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 15000 });
    await holdPhraseHandoff(page);
    const soundingNotes = await phraseNotes(page);
    const soundingSeed = await seedOf(page);
    assert.ok(soundingNotes.length > 2, soundingNotes.join(' | '));

    // Queue a replacement, move the key, and start a tempo nudge. None of
    // these is sounding yet.
    await page.getByRole('button', { name: 'New phrase' }).click();
    assert.notEqual(await seedOf(page), soundingSeed);
    await chooseRoot(page, 'C');
    // Keys held down: the live swing and tempo move, but the release
    // that would commit them to the player has not happened.
    await swingInput.focus();
    await page.keyboard.down('ArrowRight');
    try {
      assert.notEqual(Number(await swingInput.inputValue()), soundingSwing);
      await tempoInput.focus();
      await page.keyboard.down('ArrowRight');
      assert.notEqual(await tempoInput.inputValue(), '40');
      assert.deepEqual(await phraseNotes(page), soundingNotes);
      await page.getByRole('button', { name: 'Save to stash' }).click();
      await page.getByRole('button', { name: 'Saved ✓' }).waitFor();
    } finally {
      await page.keyboard.up('ArrowRight');
    }

    const item = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        items?: Record<string, unknown>[];
      };
      return parsed.items?.find((entry) => entry.type === 'phrase') ?? null;
    }, TRAY_KEY);
    assert.ok(item, 'no phrase was stashed');
    assert.equal(item.key, 'E');
    assert.equal(item.scaleId, scaleId);
    assert.match(
      scaleName,
      new RegExp(String(item.scaleName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    );
    assert.equal(item.seed, Number(soundingSeed));
    assert.equal(item.bars, 2);
    assert.equal(item.tempo, 40);
    assert.equal(item.slow, false);
    assert.equal(item.swing, soundingSwing);
    const notes = item.notes as {
      name: string;
      string: number;
      fret: number;
    }[];
    const spoken = soundingNotes.map((line) => {
      const match = /^([^,]+), string (\d+), fret ([^,]+),/.exec(line) ?? [];
      const name = (match[1] ?? '').replaceAll('♯', '#').replaceAll('♭', 'b');
      const string = 6 - Number(match[2]);
      const fret = match[3] === 'open' ? 0 : Number(match[3]);
      return `${name}:${string}:${fret}`;
    });
    assert.deepEqual(
      notes.map((note) => `${note.name}:${note.string}:${note.fret}`),
      spoken,
      'stashed notes are not the sounding notes',
    );
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * The chord-place half of the stash snapshot: saving while a chord change
 * waits for the bar line must keep the sounding chord in both the chord
 * reference and the restore coordinates, so reopening the stash item
 * lands on the chord its notes were played over.
 */
void test('saving while a chord change waits stashes the sounding chord', async (t) => {
  let browser: Browser | undefined;
  let page: Page | undefined;
  let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
  try {
    browser = await launchNamed('chromium', t);
    server = await acquireDevServer();
    page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    });
    await installPhraseHandoffHold(page);
    await page.goto(server.origin, { waitUntil: 'networkidle' });
    await page.evaluate((key) => localStorage.removeItem(key), TRAY_KEY);
    await openPhrases(page);
    await page.getByRole('button', { name: 'Chords' }).click();
    await chooseRoot(page, 'C');
    await chooseSearch(page, 'Search chord quality', 'minor', /^Minor m$/);
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over Cm in/,
    );

    const tempoInput = page.locator(
      'label.phrase-tempo:not(.phrase-swing) input',
    );
    await tempoInput.focus();
    await page.keyboard.press('Home');
    assert.equal(await tempoInput.inputValue(), '40');

    await page.locator('.phrase-action', { hasText: 'Loop' }).click();
    await page
      .locator('.phrase-action[aria-pressed="true"]', { hasText: 'Loop' })
      .waitFor();
    await page.locator('.phrase-action', { hasText: 'Play' }).click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Looping this phrase.' })
      .waitFor({ timeout: 15000 });
    await holdPhraseHandoff(page);
    const soundingNotes = await phraseNotes(page);
    const soundingSeed = await seedOf(page);
    assert.ok(soundingNotes.length > 2, soundingNotes.join(' | '));

    await page.getByRole('button', { name: 'New phrase' }).click();
    assert.notEqual(await seedOf(page), soundingSeed);
    await chooseRoot(page, 'E');
    assert.deepEqual(await phraseNotes(page), soundingNotes);
    assert.match(
      await page.locator('.phrase-heading p').innerText(),
      /Over Cm in/,
      'heading moved to the queued chord while Cm was sounding',
    );

    await page.getByRole('button', { name: 'Save to stash' }).click();
    await page.getByRole('button', { name: 'Saved ✓' }).waitFor();
    const item = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as {
        items?: Record<string, unknown>[];
      };
      return parsed.items?.find((entry) => entry.type === 'phrase') ?? null;
    }, TRAY_KEY);
    assert.ok(item, 'no phrase was stashed');
    assert.equal(item.seed, Number(soundingSeed));
    assert.equal(item.tempo, 40);
    assert.equal(item.place, 'chord');
    assert.equal(item.chordRoot, 'C');
    const chord = item.chord as {
      symbol: string;
      root: string;
      qualityId: string;
    } | null;
    assert.ok(chord, 'stashed phrase lost its chord');
    assert.equal(chord.root, 'C');
    assert.match(chord.symbol, /^Cm/);
    assert.equal(item.qualityId, chord.qualityId);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});

/**
 * Loop off, on, and off again inside one cadence: the replacement armed
 * by the middle Loop-on must not start looping under a Loop-off toggle.
 * Left looping, the next phrase change would wait in the player while
 * the screen — believing Loop is off — described it at once.
 */
void test('Loop off, on, and off in one cadence does not leave the player looping', async (t) => {
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
    await playLooping(page);
    const finishingNotes = await phraseNotes(page);
    assert.ok(finishingNotes.length > 2, finishingNotes.join(' | '));

    const loopKey = page.locator('.phrase-action', { hasText: 'Loop' });
    await loopKey.click();
    await page
      .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
      .waitFor({ timeout: 2000 });
    await loopKey.click();
    await page
      .locator('.phrase-action[aria-pressed="true"]', { hasText: 'Loop' })
      .waitFor();
    await loopKey.click();
    await page
      .locator('.phrase-action[aria-pressed="false"]', { hasText: 'Loop' })
      .waitFor();

    // The cadence finishes and the armed replacement plays once, then
    // stops. A player left looping under the off toggle would never
    // reach the idle status, and a later New would describe a phrase
    // the still-looping pass is not sounding.
    await page
      .locator('#phrase-seed-help', {
        hasText: 'Same seed replays this phrase.',
      })
      .waitFor({ timeout: 20000 });
    assert.deepEqual(await phraseNotes(page), finishingNotes);
  } finally {
    await page?.close();
    await browser?.close();
    await server?.release();
  }
});
