#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { diagnose } from './doctor.mjs';
import { readCurrent } from './run-state.mjs';

const FEATURES = ['explore', 'phrases', 'match', 'stash'];

function flat(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function shot(page, dir, name) {
  await page.screenshot({ path: resolve(dir, name), fullPage: true });
}

async function openApp(page, origin, hash = '') {
  // networkidle waits until the client bundle has hydrated. A click on the
  // server HTML before that does not open a menu.
  await page.goto(`${origin}/${hash}`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: 'Explore' }).waitFor();
}

async function chooseRoot(page, note) {
  await page.getByRole('combobox', { name: 'Root note' }).click();
  await page.getByRole('option', { name: note, exact: true }).click();
}

async function withPage(origin, dir, run) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const external = [];
  const consoleErrors = [];
  const httpErrors = [];
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
  });
  await context.route('**/*', async (route) => {
    const host = new URL(route.request().url()).hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      await route.continue();
      return;
    }
    external.push(route.request().url());
    await route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', (error) => {
    consoleErrors.push({ type: 'pageerror', text: error.message });
  });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consoleErrors.push({ type: 'console', text: message.text() });
    }
  });
  page.on('response', (response) => {
    let host = '';
    try {
      host = new URL(response.url()).hostname;
    } catch {
      return;
    }
    if (
      (host === '127.0.0.1' || host === 'localhost') &&
      response.status() >= 400
    ) {
      httpErrors.push({ status: response.status(), url: response.url() });
    }
  });
  try {
    const observed = await run(page);
    check(external.length === 0, `aborted external requests: ${external.join(', ')}`);
    check(consoleErrors.length === 0, `console errors: ${JSON.stringify(consoleErrors)}`);
    check(httpErrors.length === 0, `HTTP errors: ${JSON.stringify(httpErrors)}`);
    return { observed, external, consoleErrors, httpErrors };
  } catch (error) {
    await page.screenshot({ path: resolve(dir, 'failure.png'), fullPage: true }).catch(() => {});
    const snapshot = await page.locator('main').ariaSnapshot().catch(() => '');
    if (snapshot) await writeFile(resolve(dir, 'failure.aria.txt'), snapshot);
    throw Object.assign(error, { external, consoleErrors, httpErrors });
  } finally {
    await browser.close();
  }
}

async function driveExplore(page, origin, dir) {
  await openApp(page, origin, '#explore');
  const explore = page.getByRole('link', { name: 'Explore' });
  check(
    (await explore.getAttribute('aria-current')) === 'page',
    '#explore did not open Explore',
  );
  await page.getByRole('heading', { name: 'A Dorian guitar reference' }).waitFor();
  const root = page.getByRole('combobox', { name: 'Root note' });
  check(flat(await root.innerText()) === 'A', 'root did not start at A');
  const aName = await page.getByRole('img', { name: /A Dorian notes/ }).getAttribute('aria-label');
  check(
    aName.includes('A degree 1') &&
      aName.includes('C degree ♭3') &&
      aName.includes('F♯ degree 6') &&
      aName.includes('G degree ♭7'),
    aName,
  );
  await shot(page, dir, '01-a-dorian.png');

  await page.goto(`${origin}/#match`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Match your chords' }).waitFor();
  await explore.click();
  await page.getByRole('heading', { name: 'A Dorian guitar reference' }).waitFor();
  check(
    (await explore.getAttribute('aria-current')) === 'page',
    'Explore link did not return from Match',
  );

  await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'A Dorian guitar reference' }).waitFor();

  await chooseRoot(page, 'F♯');
  await page.getByRole('heading', { name: 'F♯ Dorian guitar reference' }).waitFor();
  const sharp = await page
    .getByRole('img', { name: /F♯ Dorian notes/ })
    .getAttribute('aria-label');
  check(
    sharp.startsWith('F♯ Dorian notes:') &&
      sharp.includes('F♯ degree 1') &&
      sharp.includes('G♯ degree 2') &&
      sharp.includes('A degree ♭3') &&
      sharp.includes('C♯ degree 5') &&
      sharp.includes('D♯ degree 6') &&
      sharp.includes('E degree ♭7'),
    sharp,
  );
  check(
    (await page.getByRole('button', { name: 'Drone, off, Reed' }).count()) === 1,
    'drone toggle missing on the scale page',
  );
  await shot(page, dir, '02-f-sharp-dorian.png');
  await writeFile(
    resolve(dir, '02-f-sharp-dorian.aria.txt'),
    await page.locator('main').ariaSnapshot(),
  );

  await page.getByRole('button', { name: 'Chords', exact: true }).click();
  await page.getByRole('heading', { name: 'C Major guitar reference' }).waitFor();
  const chord = await page
    .getByRole('img', { name: /C Major sounding notes/ })
    .getAttribute('aria-label');
  check(
    chord.includes('C Major sounding notes: C degree 1, E degree 3, G degree 5'),
    chord,
  );
  check(
    (await page.getByRole('button', { name: 'Drone, off, Reed' }).count()) === 0,
    'drone toggle stayed on the chord page',
  );
  await shot(page, dir, '03-c-major.png');

  await page.getByRole('button', { name: 'Scales & modes' }).click();
  await page.getByRole('heading', { name: 'F♯ Dorian guitar reference' }).waitFor();
  check(flat(await root.innerText()) === 'F♯', 'scale root was lost after Chords');
  await shot(page, dir, '04-back-to-f-sharp.png');
  return {
    heading: 'F♯ Dorian guitar reference',
    chordHeading: 'C Major guitar reference',
  };
}

async function drivePhrases(page, origin, dir) {
  await openApp(page, origin);
  await page.getByRole('button', { name: 'Phrases', exact: true }).click();
  await page.getByRole('region', { name: 'Phrase practice' }).waitFor();
  await page.getByRole('heading', { name: 'Phrase', exact: true }).waitFor();
  await page.getByText('Over A tonic in A Dorian.').waitFor();
  const seed = page.getByRole('textbox', { name: 'Seed' });
  const first = await seed.inputValue();
  check(/^\d+$/.test(first), `seed ${first}`);
  await page.locator('#phrase-tab-host .phrase-staff').waitFor();
  check(
    (await page.getByRole('button', { name: '2 bars' }).getAttribute('aria-pressed')) ===
      'true',
    '2 bars was not pressed',
  );
  await page.getByText('Same seed replays this phrase.', { exact: true }).waitFor();
  await shot(page, dir, '01-open.png');

  await page.getByRole('button', { name: 'New phrase' }).click();
  await page.waitForFunction((previous) => {
    const label = [...document.querySelectorAll('label')].find((node) =>
      node.textContent?.includes('Seed'),
    );
    const input = label?.querySelector('input');
    return input instanceof HTMLInputElement && input.value !== previous;
  }, first);
  const second = await seed.inputValue();
  check(second !== first && /^\d+$/.test(second), `seed stayed ${second}`);
  const plan = page.locator('p').filter({ hasText: 'lands on the', visible: true });
  check((await plan.count()) > 0, 'plan line missing after New phrase');
  await shot(page, dir, '02-new-phrase.png');

  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByText('Playing this phrase.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  await shot(page, dir, '03-playing.png');
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).waitFor();

  await page.getByRole('button', { name: 'Save to stash' }).click();
  await page.locator('#phrase-save-announce').getByText('Saved to stash.').waitFor();
  await page.getByRole('button', { name: /^Stash/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash' });
  await dialog.waitFor();
  check(
    flat(await dialog.innerText()).includes('A Dorian · 2 bars'),
    flat(await dialog.innerText()),
  );
  await shot(page, dir, '04-stash.png');
  await writeFile(resolve(dir, '04-stash.aria.txt'), await dialog.ariaSnapshot());

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Stash/ }).click();
  await dialog.waitFor();
  const reloaded = flat(await dialog.innerText());
  check(reloaded.includes('A Dorian · 2 bars'), reloaded);
  const stored = await page.evaluate(() => localStorage.getItem('progger.tray.v1'));
  check(stored?.includes('A Dorian'), 'progger.tray.v1 did not keep the phrase');
  await shot(page, dir, '05-stash-after-reload.png');
  return { seedBefore: first, seedAfter: second, stash: 'A Dorian · 2 bars' };
}

async function driveMatch(page, origin, dir) {
  await openApp(page, origin, '#match');
  const matchLink = page.getByRole('link', { name: 'Match chords' });
  check(
    (await matchLink.getAttribute('aria-current')) === 'page',
    '#match did not open Match chords',
  );
  await page.getByRole('heading', { name: 'Match your chords' }).waitFor();

  await openApp(page, origin);
  await matchLink.click();
  await page.getByRole('heading', { name: 'Match your chords' }).waitFor();
  await page.getByRole('heading', { name: 'No need to know the key.' }).waitFor();
  await page.getByRole('button', { name: /A brighter minor sound/ }).click();
  await page.getByRole('heading', { name: 'A Dorian', exact: true, level: 3 }).waitFor();
  const status = flat(await page.locator('.result-count').innerText());
  check(
    status === '3 different collections contain all your chord tones · Am → D',
    status,
  );
  check(
    flat(await page.locator('[aria-label="Recognized chords"]').innerText()) === 'Am D',
    'recognized chords',
  );
  const cards = await page.locator('article h3').allInnerTexts();
  check(
    cards.join('|') === 'A Dorian|A Jazz melodic minor|A Dorian ♭2',
    cards.join('|'),
  );
  const home = flat(
    await page.locator('summary').filter({ hasText: 'Home note' }).innerText(),
  );
  check(home === 'Home note · A', home);
  await shot(page, dir, '01-starter.png');
  await writeFile(
    resolve(dir, '01-starter.aria.txt'),
    await page.locator('main').ariaSnapshot(),
  );

  await page
    .locator('article')
    .filter({
      has: page.getByRole('heading', { name: 'A Jazz melodic minor', level: 3 }),
    })
    .getByRole('button', { name: 'Try on the fretboard' })
    .click();
  await page.getByRole('heading', { name: 'A Jazz melodic minor guitar reference' }).waitFor();
  const banner = flat(await page.locator('.context-banner').innerText());
  check(banner.includes('Back to your chords') && banner.includes('Am → D'), banner);
  const neck = await page
    .getByRole('img', { name: /Jazz melodic minor notes/ })
    .getAttribute('aria-label');
  check(
    neck.includes('A degree 1') &&
      neck.includes('C degree ♭3') &&
      neck.includes('F♯ degree 6') &&
      neck.includes('G♯ degree 7') &&
      neck.includes('All note locations through fret 24'),
    neck,
  );
  await shot(page, dir, '02-on-neck.png');

  await page.getByRole('button', { name: 'Back to your chords' }).click();
  await page.getByRole('heading', { name: 'Match your chords' }).waitFor();
  check(
    (await page.getByRole('textbox', { name: 'What are you playing?' }).inputValue()) ===
      'Am D',
    'progression was cleared on return',
  );

  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('textbox', { name: 'What are you playing?' }).fill('Cwat');
  await page.locator('#chord-errors').getByText('unsupported chord quality').waitFor();
  const shown = flat(await page.locator('#chord-errors').innerText());
  check(
    shown ===
      '“Cwat” has an unsupported chord quality. Use the chord builder to see supported choices.',
    shown,
  );
  check(
    (await page.getByRole('heading', { name: 'Let’s get your chords in place.' }).count()) ===
      1,
    'invalid empty state missing',
  );
  check((await page.locator('article h3').count()) === 0, 'stale match cards remained');
  await shot(page, dir, '03-invalid.png');
  return { status, error: shown };
}

async function driveStash(page, origin, dir) {
  await openApp(page, origin);
  const neck = await page.getByRole('img', { name: /A Dorian notes/ }).getAttribute('aria-label');
  check(neck.includes('starts on low E at fret 5'), neck);
  await page.getByRole('button', { name: 'Stash', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Stash' });
  await dialog.waitFor();
  await page.getByRole('heading', { name: 'Nothing saved yet' }).waitFor();
  await shot(page, dir, '01-empty.png');
  await page.getByRole('button', { name: 'Bookmark this scale' }).click();
  await dialog.getByText('Saved to stash.').waitFor();
  check(flat(await dialog.innerText()).includes('A Dorian · form 4'), flat(await dialog.innerText()));
  await shot(page, dir, '02-saved.png');
  await dialog.getByRole('button', { name: 'Close stash' }).click();
  await dialog.waitFor({ state: 'hidden' });

  await chooseRoot(page, 'C');
  await page.getByRole('heading', { name: 'C Dorian guitar reference' }).waitFor();
  await page.getByRole('button', { name: /^Stash/ }).click();
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Open' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('heading', { name: 'A Dorian guitar reference' }).waitFor();
  const restored = await page
    .getByRole('img', { name: /A Dorian notes/ })
    .getAttribute('aria-label');
  check(restored.includes('starts on low E at fret 5'), restored);
  await shot(page, dir, '03-reopened.png');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /^Stash/ }).click();
  await dialog.waitFor();
  const reloaded = flat(await dialog.innerText());
  check(reloaded.includes('A Dorian · form 4'), reloaded);
  check(!reloaded.includes('Saved to stash.'), 'save banner survived reload');
  const stored = await page.evaluate(() => localStorage.getItem('progger.tray.v1'));
  check(stored?.includes('A Dorian'), 'progger.tray.v1 did not keep the scale');
  await shot(page, dir, '04-after-reload.png');
  await writeFile(resolve(dir, '04-after-reload.aria.txt'), await dialog.ariaSnapshot());
  return { saved: 'A Dorian · form 4' };
}

const runners = {
  explore: driveExplore,
  phrases: drivePhrases,
  match: driveMatch,
  stash: driveStash,
};

const flag = process.argv.indexOf('--feature');
const requested = flag === -1 ? FEATURES : [process.argv[flag + 1]];
if (requested.some((id) => !runners[id])) {
  console.error(`Unknown feature. Use ${FEATURES.join(', ')}.`);
  process.exit(1);
}

const state = readCurrent();
const problems = await diagnose(state);
if (problems.length > 0) {
  for (const problem of problems) console.error(problem);
  process.exit(1);
}

await mkdir(state.evidenceDir, { recursive: true });
const summary = {
  origin: state.origin,
  ok: true,
  features: [],
};
let failed = false;
for (const id of requested) {
  const dir = resolve(state.evidenceDir, id);
  await mkdir(dir, { recursive: true });
  try {
    const { observed, external, consoleErrors, httpErrors } = await withPage(
      state.origin,
      dir,
      (page) => runners[id](page, state.origin, dir),
    );
    await writeFile(
      resolve(dir, 'console.json'),
      JSON.stringify(consoleErrors, null, 2) + '\n',
    );
    await writeFile(
      resolve(dir, 'network.json'),
      JSON.stringify({ external, httpErrors }, null, 2) + '\n',
    );
    await writeFile(
      resolve(dir, 'result.json'),
      JSON.stringify({ feature: id, ok: true, ...observed }, null, 2) + '\n',
    );
    summary.features.push({ id, ok: true });
    console.log(`pass ${id}`);
  } catch (error) {
    failed = true;
    summary.ok = false;
    const detail = error instanceof Error ? error.message : String(error);
    await writeFile(
      resolve(dir, 'console.json'),
      JSON.stringify(error.consoleErrors ?? [], null, 2) + '\n',
    );
    await writeFile(
      resolve(dir, 'network.json'),
      JSON.stringify(
        { external: error.external ?? [], httpErrors: error.httpErrors ?? [] },
        null,
        2,
      ) + '\n',
    );
    await writeFile(
      resolve(dir, 'result.json'),
      JSON.stringify({ feature: id, ok: false, error: detail }, null, 2) + '\n',
    );
    summary.features.push({ id, ok: false, error: detail });
    console.error(`fail ${id}: ${detail}`);
  }
}
await writeFile(
  resolve(state.evidenceDir, 'summary.json'),
  JSON.stringify(summary, null, 2) + '\n',
);
process.exit(failed ? 1 : 0);
