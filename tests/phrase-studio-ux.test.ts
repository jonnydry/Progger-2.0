import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

void test(
  'Phrase Studio keeps Play above the fold, verifies tab labels/legend/breakpoints, supports audition, and names all form fields',
  { timeout: 120_000 },
  async (t) => {
    let browser: Browser | undefined;
    let page: Page | undefined;
    let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
    try {
      browser = await launchNamed('chromium', t);
      server = await acquireDevServer();
      page = await browser.newPage({
        viewport: { width: 1280, height: 900 },
        deviceScaleFactor: 1,
      });
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Phrases' }).click();
      await page.locator('#phrase-tab-host .phrase-staff').waitFor();

      // 1. Desktop 1280x900: Studio Header -> Deck (Play above the fold!) -> Docked Tablature, all inside #phrase-practice.
      const desktopLayout = await page.evaluate(() => {
        const headerBottom =
          document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const practice = document.querySelector('#phrase-practice');
        const host = document.querySelector('#phrase-tab-host');
        const heading = document.querySelector('.phrase-heading');
        const deck = document.querySelector('.phrase-deck');
        const play = document.querySelector('.deck-key-play');
        const staff = document.querySelector('.phrase-staff');
        const playRect = play?.getBoundingClientRect();
        return {
          headerBottom,
          headingCount: document.querySelectorAll('.phrase-heading').length,
          hostInsidePractice: Boolean(
            practice && host && practice.contains(host),
          ),
          headingBottom: heading?.getBoundingClientRect().bottom ?? 0,
          deckTop: deck?.getBoundingClientRect().top ?? 0,
          deckBottom: deck?.getBoundingClientRect().bottom ?? 0,
          staffTop: staff?.getBoundingClientRect().top ?? 0,
          playTop: playRect?.top ?? Number.POSITIVE_INFINITY,
          playBottom: playRect?.bottom ?? Number.POSITIVE_INFINITY,
          innerHeight: window.innerHeight,
        };
      });
      assert.equal(desktopLayout.headingCount, 1);
      assert.equal(desktopLayout.hostInsidePractice, true);
      assert.ok(desktopLayout.headingBottom <= desktopLayout.deckTop + 2);
      assert.ok(desktopLayout.deckBottom <= desktopLayout.staffTop + 2);
      assert.ok(
        desktopLayout.playTop >= desktopLayout.headerBottom &&
          desktopLayout.playBottom <= desktopLayout.innerHeight,
        `1280x900 Play (${desktopLayout.playTop}..${desktopLayout.playBottom}) not cleanly inside ${desktopLayout.headerBottom}..${desktopLayout.innerHeight}`,
      );

      // 2. Default 2-bar tab labels, legend items, and string-line contrast (Day & Night).
      const checkStringContrast = async () =>
        page!.evaluate(() => {
          const captions = Array.from(
            document.querySelectorAll('.phrase-staff-caption'),
            (node) => node.textContent?.trim() ?? '',
          );
          const legend =
            document.querySelector('.phrase-staff-legend')?.textContent ?? '';
          const stringLine = document.querySelector('.phrase-string-line');
          const probe = document.createElement('span');
          probe.style.background = 'var(--quiet)';
          stringLine?.parentElement?.appendChild(probe);
          const expectedQuiet = getComputedStyle(probe).backgroundColor;
          probe.remove();
          const lineStyle = stringLine ? getComputedStyle(stringLine) : null;
          return {
            captions,
            legend,
            expectedQuiet,
            actualLine: lineStyle?.backgroundColor ?? '',
            opacity: lineStyle?.opacity ?? '',
          };
        });
      const twoBarMeta = await checkStringContrast();
      assert.deepEqual(twoBarMeta.captions, ['Bar 1', 'Bar 2', 'Lands']);
      assert.match(twoBarMeta.legend, /Chord/);
      assert.match(twoBarMeta.legend, /Scale/);
      assert.match(twoBarMeta.legend, /1–4\s*finger/);
      assert.equal(twoBarMeta.actualLine, twoBarMeta.expectedQuiet);
      assert.equal(twoBarMeta.opacity, '1');

      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'day';
      });
      const dayMeta = await checkStringContrast();
      assert.equal(dayMeta.actualLine, dayMeta.expectedQuiet);
      assert.equal(dayMeta.opacity, '1');
      await page.evaluate(() => {
        document.documentElement.dataset.theme = 'night';
      });

      // Loop on labels the landing bar as skipped.
      await page.locator('.deck-key-loop').click();
      await page
        .locator('.phrase-staff-caption', { hasText: 'Lands · skipped' })
        .waitFor();
      await page.locator('.deck-key-loop').click();

      // 3. Switch to 4-bar + turnaround + chromatic via Build, verify labels, non-tautological legend, and breakpoints.
      await page.getByRole('button', { name: '4-bar' }).click();
      await page.locator('.phrase-staff[data-bars="4"]').waitFor();
      await page.locator('.deck-build > summary').click();
      const turnaroundButtons = page.locator(
        'fieldset[aria-label="Pin bar 3–4 turnaround"] button',
      );
      const turnaroundName = (
        await turnaroundButtons.first().innerText()
      ).trim();
      await turnaroundButtons.first().click();
      await page
        .locator('.phrase-staff-caption', {
          hasText: `Bar 3 · ${turnaroundName}`,
        })
        .waitFor();
      await page
        .locator('.phrase-staff-caption', {
          hasText: `Bar 4 · ${turnaroundName}`,
        })
        .waitFor();

      // Without Chromatic pinned, the Chromatic swatch is absent.
      assert.equal(
        (
          (await page.locator('.phrase-staff-legend').textContent()) ?? ''
        ).includes('Chromatic'),
        false,
      );

      // Pin Chromatic on (re-roll up to 5 times if needed) -> assert actual chromatic note AND legend swatch!
      await page
        .locator('fieldset[aria-label="Pin style"] button', {
          hasText: 'Chromatic',
        })
        .click();
      let hasChromaticPill = false;
      for (let attempt = 0; attempt < 6; attempt += 1) {
        hasChromaticPill =
          (await page
            .locator('.phrase-staff-fret[data-chromatic="true"]')
            .count()) > 0;
        if (hasChromaticPill) break;
        await page.locator('.deck-key-new').click();
        await page.waitForTimeout(40);
      }
      assert.equal(
        hasChromaticPill,
        true,
        'expected chromatic note on staff when Chromatic pin is active',
      );
      const legendAfterChr =
        (await page.locator('.phrase-staff-legend').textContent()) ?? '';
      assert.equal(
        legendAfterChr.includes('Chromatic'),
        true,
        'Chromatic legend swatch must appear when chromatic notes are present',
      );
      // Close Build fold so we measure real resting phone layout with 4 bars + turnaround.
      await page.locator('.deck-build > summary').click();

      // Breakpoint 1: 1440px desktop (4-bar sits on 1 horizontal row).
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(60);
      const wideRow = await page.evaluate(() => {
        const bars = ['1', '2', '3', '4'].map((id) =>
          document
            .querySelector(`[data-phrase-bar="${id}"]`)
            ?.getBoundingClientRect(),
        );
        return bars.map((rect) => Math.round(rect?.top ?? -1));
      });
      assert.ok(
        Math.max(...wideRow) - Math.min(...wideRow) <= 2,
        `1440px 4-bar should sit on one row, got tops ${wideRow.join(', ')}`,
      );

      // Breakpoint 2: 900px tablet (<=1120px container -> 2-column grid for 4-bar).
      await page.setViewportSize({ width: 900, height: 900 });
      await page.waitForTimeout(60);
      const tabletGrid = await page.evaluate(() => {
        const rect = (id: string) =>
          document
            .querySelector(`[data-phrase-bar="${id}"]`)
            ?.getBoundingClientRect();
        return {
          b1: rect('1'),
          b2: rect('2'),
          b3: rect('3'),
          b4: rect('4'),
        };
      });
      assert.ok(
        tabletGrid.b1 &&
          tabletGrid.b2 &&
          tabletGrid.b3 &&
          tabletGrid.b4 &&
          Math.abs(tabletGrid.b1.top - tabletGrid.b2.top) <= 2 &&
          Math.abs(tabletGrid.b3.top - tabletGrid.b4.top) <= 2 &&
          tabletGrid.b3.top >= tabletGrid.b1.bottom - 2,
        `900px 4-bar should wrap into 2x2 grid: ${JSON.stringify(tabletGrid)}`,
      );

      // Breakpoint 3 & Item 1: 390x844 phone with 4 bars + turnaround -> 1 bar/row AND Play stays right below practice-bar above the 844px fold!
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.practice-bar').scrollIntoViewIfNeeded();
      await page.waitForTimeout(80);
      const phoneLayout = await page.evaluate(() => {
        const headerBottom =
          document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const bar = document
          .querySelector('.practice-bar')
          ?.getBoundingClientRect();
        const rects = ['1', '2', '3', '4'].map((id) =>
          document
            .querySelector(`[data-phrase-bar="${id}"]`)
            ?.getBoundingClientRect(),
        );
        const play = document
          .querySelector('.deck-key-play')
          ?.getBoundingClientRect();
        const quickBtn = document
          .querySelector('.phrase-quick-btn')
          ?.getBoundingClientRect();
        return {
          headerBottom,
          barBottom: bar?.bottom ?? 0,
          barRects: rects.map((r) => ({
            top: Math.round(r?.top ?? 0),
            bottom: Math.round(r?.bottom ?? 0),
          })),
          playTop: play?.top ?? Number.POSITIVE_INFINITY,
          playBottom: play?.bottom ?? Number.POSITIVE_INFINITY,
          quickHeight: Math.round(quickBtn?.height ?? 0),
          innerHeight: window.innerHeight,
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      for (let i = 1; i < phoneLayout.barRects.length; i += 1) {
        assert.ok(
          phoneLayout.barRects[i].top >= phoneLayout.barRects[i - 1].bottom - 2,
          `390px phone bar ${i + 1} did not stack below bar ${i}: ${JSON.stringify(phoneLayout.barRects)}`,
        );
      }
      assert.ok(
        phoneLayout.quickHeight >= 32,
        `390px quick button height ${phoneLayout.quickHeight}px < 32px`,
      );
      assert.ok(
        phoneLayout.playTop - phoneLayout.barBottom <= 220,
        `390px 4-bar Play sat ${Math.round(phoneLayout.playTop - phoneLayout.barBottom)}px below practice bar`,
      );
      assert.ok(
        phoneLayout.playTop >= phoneLayout.headerBottom &&
          phoneLayout.playBottom <= phoneLayout.innerHeight,
        `390x844 phone Play (${phoneLayout.playTop}..${phoneLayout.playBottom}) not cleanly inside ${phoneLayout.headerBottom}..${phoneLayout.innerHeight}`,
      );
      assert.ok(
        phoneLayout.overflow <= 0,
        `390px overflow ${phoneLayout.overflow}px`,
      );

      // 4. Stash restore (BOTH warm AND cold reload when Phrases was closed!) keeps Play visible below header.
      await page.locator('.deck-key-rec').click();
      await page.waitForTimeout(80);
      await page.evaluate(() =>
        window.scrollTo(0, document.documentElement.scrollHeight),
      );
      await page.waitForTimeout(60);
      await page.locator('.tray-open').click();
      await page.locator('#practice-tray').waitFor({ state: 'visible' });
      await page
        .locator('#practice-tray .practice-tray-item')
        .first()
        .getByRole('button', { name: 'Open', exact: true })
        .click();
      await page.waitForTimeout(160);
      const afterWarmRestore = await page.evaluate(() => {
        const headerBottom =
          document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const play = document
          .querySelector('.deck-key-play')
          ?.getBoundingClientRect();
        return {
          headerBottom,
          top: play?.top ?? -1,
          bottom: play?.bottom ?? Number.POSITIVE_INFINITY,
          innerHeight: window.innerHeight,
        };
      });
      assert.ok(
        afterWarmRestore.top >= afterWarmRestore.headerBottom &&
          afterWarmRestore.bottom <= afterWarmRestore.innerHeight,
        `Warm Stash restore did not keep Play visible: ${JSON.stringify(afterWarmRestore)}`,
      );

      // Cold reload Stash restore (Phrases closed & PhrasePanel chunk not yet loaded).
      await page.reload({ waitUntil: 'networkidle' });
      await page.locator('.tray-open').click();
      await page.locator('#practice-tray').waitFor({ state: 'visible' });
      await page
        .locator('#practice-tray .practice-tray-item')
        .first()
        .getByRole('button', { name: 'Open', exact: true })
        .click();
      await page.locator('#phrase-practice .deck-key-play').waitFor({
        state: 'visible',
      });
      await page.waitForTimeout(160);
      const afterColdRestore = await page.evaluate(() => {
        const headerBottom =
          document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const play = document
          .querySelector('.deck-key-play')
          ?.getBoundingClientRect();
        return {
          headerBottom,
          top: play?.top ?? -1,
          bottom: play?.bottom ?? Number.POSITIVE_INFINITY,
          innerHeight: window.innerHeight,
        };
      });
      assert.ok(
        afterColdRestore.top >= afterColdRestore.headerBottom &&
          afterColdRestore.bottom <= afterColdRestore.innerHeight,
        `Cold Stash restore did not keep Play visible: ${JSON.stringify(afterColdRestore)}`,
      );

      // 5. Return to desktop: open-string & fretted a11y wording, no double SR announcement, click-to-audition, roving keyboard nav, zombie-highlight guard, mid-play audition, quick tempo sync.
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(60);

      // Pin Low register and ensure at least one open-string (fret 0) note is rendered so we verify real fret-0 wording.
      await page.locator('.deck-build > summary').click();
      await page
        .locator('fieldset[aria-label="Pin register"] button', {
          hasText: 'Low',
        })
        .click();
      let hasOpenFret = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        hasOpenFret = await page.evaluate(() =>
          Array.from(
            document.querySelectorAll('button.phrase-staff-fret'),
          ).some((btn) => btn.textContent?.trim() === '0'),
        );
        if (hasOpenFret) break;
        await page.locator('.deck-key-new').click();
        await page.waitForTimeout(40);
      }
      assert.equal(
        hasOpenFret,
        true,
        'expected at least one fret-0 (open string) button in Low register',
      );
      await page.locator('.deck-build > summary').click();

      // Accessibility checks: no double note list in a11y tree, one wording across buttons & fallback list, commas & "open" on fret 0, and fretboard tooltips never say "fret 0".
      assert.equal(
        await page
          .getByRole('list', { name: 'Phrase notes in order' })
          .count(),
        0,
        'sr-only note list should be aria-hidden while interactive tablature buttons are rendered',
      );
      const a11yAudit = await page.evaluate(() => {
        const buttons = Array.from(
          document.querySelectorAll<HTMLButtonElement>(
            'button.phrase-staff-fret',
          ),
        ).map((btn) => ({
          fret: btn.textContent?.trim() ?? '',
          aria: btn.getAttribute('aria-label') ?? '',
          title: btn.getAttribute('title') ?? '',
        }));
        const listItems = Array.from(
          document.querySelectorAll('.phrase-panel ol.sr-only li'),
        ).map((li) => li.textContent?.trim() ?? '');
        const neckFret0Titles = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.fret-column.open-string .note-dot[title]',
          ),
        ).map((dot) => dot.getAttribute('title') ?? '');
        const neckFret0PhraseMarks = document.querySelectorAll(
          '.fret-column.open-string .note-dot.phrase-mark[title]',
        ).length;
        return { buttons, listItems, neckFret0Titles, neckFret0PhraseMarks };
      });
      assert.equal(a11yAudit.buttons.length, a11yAudit.listItems.length);
      let openCount = 0;
      let frettedCount = 0;
      for (let i = 0; i < a11yAudit.buttons.length; i += 1) {
        const btn = a11yAudit.buttons[i];
        const li = a11yAudit.listItems[i];
        assert.equal(
          btn.aria,
          `Play ${li}`,
          `button ${i} aria-label should match hidden note list wording`,
        );
        assert.equal(
          /fret\s+(?:0|open)/i.test(btn.aria),
          false,
          `button ${i} should never say "fret 0" or "fret open": ${btn.aria}`,
        );
        if (btn.fret === '0') {
          openCount += 1;
          assert.match(
            btn.aria,
            /, string [1-6], open, (?:bar \d+|landing), beat /,
          );
          assert.match(btn.title, /· string [1-6], open · play note$/);
        } else {
          frettedCount += 1;
          assert.match(
            btn.aria,
            /, string [1-6], fret [1-9]\d*, finger [1-4], (?:bar \d+|landing), beat /,
          );
          assert.match(btn.title, /· string [1-6], fret [1-9]\d* · play note$/);
        }
      }
      assert.ok(openCount > 0, 'expected open-string tab buttons');
      assert.ok(frettedCount > 0, 'expected fretted tab buttons');
      assert.ok(a11yAudit.neckFret0Titles.length > 0);
      assert.ok(
        a11yAudit.neckFret0PhraseMarks > 0,
        'expected open-string phrase mark on the fretboard',
      );
      for (const title of a11yAudit.neckFret0Titles) {
        assert.match(title, /string [1-6], open/);
        assert.equal(/fret 0\b/i.test(title), false);
        assert.equal(/finger\s+(?:0|open)\b/i.test(title), false);
      }

      // Toggling Loop updates the landing button aria-label with ", landing, beat 1, skipped while looping,".
      await page.locator('.deck-key-loop').click();
      const landingLoopLabel = await page
        .locator('[data-phrase-bar="land"] button.phrase-staff-fret')
        .first()
        .getAttribute('aria-label');
      assert.match(
        landingLoopLabel ?? '',
        /, landing, beat 1, skipped while looping,/,
      );
      await page.locator('.deck-key-loop').click();

      const firstFret = page.locator('button.phrase-staff-fret').first();
      await firstFret.click();
      await page.waitForTimeout(60);
      const preview = await page.evaluate(() => ({
        frets: document.querySelectorAll('button.phrase-staff-fret.is-preview')
          .length,
        fingers: document.querySelectorAll('.phrase-staff-finger.is-preview')
          .length,
        neck: document.querySelectorAll('.note-dot.phrase-current').length,
        tabbable: document.querySelectorAll(
          'button.phrase-staff-fret[tabindex="0"]',
        ).length,
      }));
      assert.deepEqual(preview, {
        frets: 1,
        fingers: 1,
        neck: 1,
        tabbable: 1,
      });

      await page.keyboard.press('ArrowRight');
      assert.equal(
        await page.evaluate(() =>
          document.activeElement?.getAttribute('data-phrase-note'),
        ),
        '1',
      );
      await page.keyboard.press('Escape');
      await page.waitForTimeout(40);
      assert.equal(await page.locator('.note-dot.phrase-current').count(), 0);

      // Zombie highlight regression guard: preview -> Play -> Stop leaves no stuck highlight.
      await firstFret.click();
      await page.getByRole('button', { name: 'Play phrase' }).click();
      await page
        .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
        .waitFor({ timeout: 10_000 });
      await page.getByRole('button', { name: 'Stop phrase' }).click();
      await page.waitForTimeout(80);
      assert.equal(
        await page.locator('button.phrase-staff-fret.is-preview').count(),
        0,
      );
      assert.equal(await page.locator('.note-dot.phrase-current').count(), 0);

      // Audition during active playback stops playback cleanly and highlights clicked note.
      await page.getByRole('button', { name: 'Play phrase' }).click();
      await page
        .locator('#phrase-seed-help', { hasText: 'Playing this phrase.' })
        .waitFor({ timeout: 10_000 });
      await page.locator('button.phrase-staff-fret').nth(2).click();
      await page.waitForTimeout(100);
      assert.equal(
        await page.locator('.deck-key-play').getAttribute('aria-label'),
        'Play phrase',
      );
      assert.equal(
        await page.locator('button.phrase-staff-fret.is-preview').count(),
        1,
      );
      assert.equal(await page.locator('.note-dot.phrase-current').count(), 1);

      // Inline quick tempo stepper syncs with Feel? and rapid clicks do not drop.
      const faster = page.getByRole('button', { name: /Faster tempo/ });
      await faster.click();
      await faster.click();
      await page
        .locator('.phrase-quick-bpm', { hasText: '112 BPM' })
        .waitFor();
      const feelSummary = (
        await page.locator('.deck-feel > summary').innerText()
      ).replace(/\s+/g, ' ');
      assert.ok(
        feelSummary.includes('4-bar') && feelSummary.includes('112 BPM'),
        `Feel? did not sync: ${feelSummary}`,
      );

      // 6. Every form field across Explore, Phrase Feel?/Seed, Display, Drone, Stash rename, and Match Chords has an id or name and unique ids.
      const assertNamedAndUnique = async (label: string) => {
        const audit = await page!.evaluate(() => {
          const unnamed = Array.from(
            document.querySelectorAll<HTMLElement>('input, select, textarea'),
          )
            .filter((el) => !el.getAttribute('id') && !el.getAttribute('name'))
            .map((el) => el.outerHTML.slice(0, 120));
          const ids = new Map<string, number>();
          for (const el of document.querySelectorAll<HTMLElement>('[id]')) {
            const id = el.getAttribute('id');
            if (!id) continue;
            ids.set(id, (ids.get(id) ?? 0) + 1);
          }
          const duplicates = [...ids.entries()]
            .filter(([, count]) => count > 1)
            .map(([id]) => id);
          return { unnamed, duplicates };
        });
        assert.deepEqual(
          audit.unnamed,
          [],
          `${label}: form fields missing id or name: ${audit.unnamed.join('; ')}`,
        );
        assert.deepEqual(
          audit.duplicates,
          [],
          `${label}: duplicate ids: ${audit.duplicates.join(', ')}`,
        );
      };

      await page.locator('.deck-feel > summary').click();
      await page.locator('.deck-seed > summary').click();
      await assertNamedAndUnique('Explore + Feel?/Seed');

      await page.getByRole('button', { name: 'Display' }).click();
      await assertNamedAndUnique('Display popover');
      await page.keyboard.press('Escape');

      await page.locator('#drone-volume-trigger').click();
      await assertNamedAndUnique('Drone popover');
      await page.keyboard.press('Escape');

      await page.locator('.tray-open').click();
      await page.locator('#practice-tray').waitFor({ state: 'visible' });
      await page
        .locator('#practice-tray .practice-tray-item')
        .first()
        .getByRole('button', { name: /Rename/ })
        .click();
      await page.locator('.practice-tray-rename').waitFor({ state: 'visible' });
      await assertNamedAndUnique('Stash rename');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');

      // 320px narrow phone check: zero horizontal overflow and focus ring renders visibly.
      await page.setViewportSize({ width: 320, height: 844 });
      await page.waitForTimeout(60);
      assert.ok(
        (await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        )) <= 0,
        '320px overflow',
      );
      await page.locator('.phrase-open').focus();
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return {
          text: el?.textContent?.trim() ?? '',
          outlineStyle: el ? getComputedStyle(el).outlineStyle : 'none',
        };
      });
      assert.equal(focused.text, '2-bar');
      assert.notEqual(focused.outlineStyle, 'none');

      // Also check Match chords form fields.
      await page.getByRole('link', { name: 'Match chords' }).click();
      await page.locator('#chord-progression').waitFor({ state: 'visible' });
      await assertNamedAndUnique('Match chords');
    } finally {
      await page?.close();
      await browser?.close();
      await server?.release();
    }
  },
);
