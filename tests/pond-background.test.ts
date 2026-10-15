import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Browser, Page } from 'playwright';
import { launchNamed } from './browser-launch.ts';
import { acquireDevServer } from './dev-server.ts';

const VIEWPORTS = [
  { width: 820, height: 490 },
  { width: 820, height: 800 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1000, height: 800 },
  { width: 480, height: 844 },
  { width: 390, height: 844 },
  { width: 320, height: 568 },
] as const;

type Layer = {
  left: number;
  top: number;
  width: number;
  repeat: string;
  attachment: string;
  artBottom: number;
  mask: string;
};

async function readLayers(page: Page) {
  return page.evaluate(() => {
    const layer = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const [sizeX, sizeY] = style.backgroundSize.split(/\s+/);
      const width = sizeX.endsWith('%')
        ? (rect.width * Number.parseFloat(sizeX)) / 100
        : Number.parseFloat(sizeX);
      const height =
        !sizeY || sizeY === 'auto' ? width / 2 : Number.parseFloat(sizeY);
      const [positionX, positionY] = style.backgroundPosition.split(/\s+/);
      const offsetX = positionX.endsWith('%')
        ? ((rect.width - width) * Number.parseFloat(positionX)) / 100
        : Number.parseFloat(positionX);
      const offsetY = positionY.endsWith('%')
        ? ((rect.height - height) * Number.parseFloat(positionY)) / 100
        : Number.parseFloat(positionY);
      const mask = style.maskImage;
      return {
        left: rect.left + offsetX,
        top: rect.top + offsetY,
        width,
        repeat: style.backgroundRepeat,
        attachment: style.backgroundAttachment,
        display: style.display,
        artBottom: offsetY + width / 2,
        mask,
      };
    };
    const match = document.querySelector('.chord-entry .underwater-scene');
    return {
      pond: layer('.pond-scene'),
      water: layer('.explorer-panel .underwater-scene'),
      matchSize: match ? getComputedStyle(match).backgroundSize : '',
      scene: document.documentElement.dataset.scene,
      theme: document.documentElement.dataset.theme,
    };
  });
}

function assertFadeEndsAtArt(mask: string, artBottom: number, label: string) {
  const stops = [...mask.matchAll(/(-?\d+(?:\.\d+)?)px/g)].map((match) =>
    Number(match[1]),
  );
  const end = stops.at(-1);
  assert.ok(end !== undefined, `${label} mask has no length stop: ${mask}`);
  assert.ok(
    Math.abs(end - artBottom) <= 1,
    `${label} fade ends at ${end}px, art bottom is ${artBottom}px`,
  );
}

function assertOnePainting(pond: Layer, water: Layer, label: string) {
  assert.equal(pond.repeat, 'no-repeat', `${label} header repeat`);
  assert.equal(water.repeat, 'no-repeat', `${label} water repeat`);
  assert.equal(pond.attachment, 'scroll', `${label} header attachment`);
  assert.equal(water.attachment, 'scroll', `${label} water attachment`);
  assert.ok(
    Math.abs(pond.width - water.width) <= 1,
    `${label} scales differ: header ${pond.width}px, water ${water.width}px`,
  );
  assert.ok(
    Math.abs(pond.left - water.left) <= 1,
    `${label} horizontal origins differ by ${pond.left - water.left}px`,
  );
  assert.ok(
    Math.abs(pond.top - water.top) <= 1,
    `${label} vertical origins differ by ${pond.top - water.top}px`,
  );
}

void test(
  'Explore continues one pond illustration instead of painting it again',
  { timeout: 180_000 },
  async (t) => {
    const browser: Browser = await launchNamed('chromium', t);
    const server = await acquireDevServer();
    const { origin } = server;
    t.after(async () => {
      await browser.close();
      await server.release();
    });

    const page = await browser.newPage({
      viewport: { width: 820, height: 800 },
      deviceScaleFactor: 1,
    });
    for (const theme of ['night', 'day'] as const) {
      for (const scene of ['pond', 'tidepool', 'twilight'] as const) {
        await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' });
        await page.evaluate(
          ({ theme, scene }) => {
            localStorage.setItem('progger.theme.v1', theme);
            localStorage.setItem('progger.scene.v1', scene);
          },
          { theme, scene },
        );
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.explorer-panel .underwater-scene');
        for (const viewport of VIEWPORTS) {
          if (scene !== 'pond' && viewport.width !== 820) continue;
          await page.setViewportSize(viewport);
          await page.evaluate(() => window.scrollTo(0, 0));
          const top = await readLayers(page);
          assert.equal(top.theme, theme);
          assert.equal(top.scene, scene);
          assert.ok(top.pond && top.water);
          const label = `${theme} ${scene} ${viewport.width}x${viewport.height} top`;
          assertOnePainting(top.pond, top.water, label);
          assertFadeEndsAtArt(top.water.mask, top.water.artBottom, label);
          const matchWidth = Number.parseFloat(top.matchSize);
          assert.ok(
            matchWidth > top.water.width + 100,
            `${label} changed the Match water crop (${top.matchSize})`,
          );
          await page.evaluate(() => window.scrollTo(0, window.innerHeight));
          const scrolled = await readLayers(page);
          assert.ok(scrolled.pond && scrolled.water);
          assertOnePainting(
            scrolled.pond,
            scrolled.water,
            `${theme} ${scene} ${viewport.width}x${viewport.height} scrolled`,
          );
        }
      }
    }
    await page.close();
  },
);
