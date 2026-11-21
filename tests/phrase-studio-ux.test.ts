import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

void test(
  'Phrase Studio promotes header into #phrase-practice, supports click-to-audition, and syncs inline quick controls',
  { timeout: 120_000 },
  async (t) => {
    let browser: Browser | undefined;
    let page: Page | undefined;
    let server: Awaited<ReturnType<typeof acquireDevServer>> | undefined;
    try {
      browser = await launchNamed('chromium', t);
      server = await acquireDevServer();
      page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      });
      await page.goto(server.origin, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Phrases' }).click();
      await page.locator('#phrase-tab-host .phrase-staff').waitFor();

      // 1. Top Studio Header is inside #phrase-practice, above tablature, never duplicated.
      const structure = await page.evaluate(() => {
        const practice = document.querySelector('#phrase-practice');
        const host = document.querySelector('#phrase-tab-host');
        const heading = document.querySelector('.phrase-heading');
        const staff = document.querySelector('.phrase-staff');
        const deck = document.querySelector('.phrase-deck');
        return {
          headingCount: document.querySelectorAll('.phrase-heading').length,
          hostInsidePractice: Boolean(practice && host && practice.contains(host)),
          headingInsideHost: Boolean(host && heading && host.contains(heading)),
          headingInsidePanel: Boolean(
            document.querySelector('.phrase-panel .phrase-heading'),
          ),
          headingBottom: heading?.getBoundingClientRect().bottom ?? 0,
          staffTop: staff?.getBoundingClientRect().top ?? 0,
          staffBottom: staff?.getBoundingClientRect().bottom ?? 0,
          deckTop: deck?.getBoundingClientRect().top ?? 0,
        };
      });
      assert.equal(structure.headingCount, 1);
      assert.equal(structure.hostInsidePractice, true);
      assert.equal(structure.headingInsideHost, true);
      assert.equal(structure.headingInsidePanel, false);
      assert.ok(structure.headingBottom <= structure.staffTop + 2);
      assert.ok(structure.staffBottom <= structure.deckTop + 2);

      // 2. Click-to-audition highlights tablature pill, finger badge, and fretboard cell.
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

      // Keyboard roving tabindex + Escape clears preview.
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

      // 3. Inline quick controls sync with Feel? and rapid clicks do not drop.
      await page.getByRole('button', { name: '4-bar' }).click();
      await page.locator('.phrase-staff[data-bars="4"]').waitFor();
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

      // Focus ring renders visibly via Progger's --focus-ring token.
      await page.keyboard.press('Tab');
      await page.getByRole('button', { name: '2-bar' }).focus();
      const outlineStyle = await page
        .getByRole('button', { name: '2-bar' })
        .evaluate((node) => getComputedStyle(node).outlineStyle);
      assert.notEqual(outlineStyle, 'none');

      // 4. Mobile 390px and 320px: heading stays flush inside #phrase-tab-host with zero overflow.
      for (const width of [860, 390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await page.waitForTimeout(60);
        const box = await page.evaluate(() => {
          const host = document
            .querySelector('#phrase-tab-host')
            ?.getBoundingClientRect();
          const heading = document
            .querySelector('#phrase-tab-host .phrase-heading')
            ?.getBoundingClientRect();
          return {
            overflow:
              document.documentElement.scrollWidth -
              document.documentElement.clientWidth,
            leftBleed: host && heading ? host.left - heading.left : 0,
            rightBleed: host && heading ? heading.right - host.right : 0,
            topBleed: host && heading ? host.top - heading.top : 0,
          };
        });
        assert.ok(box.overflow <= 0, `${width}px overflow ${box.overflow}px`);
        assert.ok(
          box.leftBleed <= 1 && box.rightBleed <= 1 && box.topBleed <= 1,
          `${width}px heading bled outside #phrase-tab-host: ${JSON.stringify(box)}`,
        );
      }
    } finally {
      await page?.close();
      await browser?.close();
      await server?.release();
    }
  },
);
