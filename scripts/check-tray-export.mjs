import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../dist/client/', import.meta.url));
const shots = '/opt/cursor/artifacts/screenshots';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

function start() {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const safe = relative.endsWith('/') ? `${relative}index.html` : relative;
      if (safe.split('/').includes('..')) {
        response.writeHead(403);
        response.end();
        return;
      }
      const path = normalize(join(root, safe || 'index.html'));
      if (!path.startsWith(root)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const body = await readFile(path);
      response.writeHead(200, {
        'content-type': types[extname(path)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('static export server has no port');
      }
      resolve({ server, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

const { server, origin } = await start();
const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--use-angle=swiftshader'],
});
let shotDir = null;
try {
  await mkdir(shots, { recursive: true });
  shotDir = shots;
} catch {
  shotDir = null;
}
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/`, { waitUntil: 'networkidle' });
    await page.locator('.tray-open').waitFor();
    const toggle = page.getByRole('switch', { name: 'Day theme' });
    if ((await toggle.getAttribute('aria-checked')) !== 'true') {
      await toggle.click();
      await page.waitForFunction(
        () => document.documentElement.dataset.theme === 'day',
      );
    }
    await page.locator('.tray-open').click();
    await page.locator('#practice-tray').waitFor();
    await page.waitForFunction((viewport) => {
      const panel = document.querySelector('#practice-tray');
      if (!(panel instanceof HTMLElement)) return false;
      const rect = panel.getBoundingClientRect();
      return rect.left >= -1 && rect.right <= viewport + 1;
    }, width);
    const filter = await page.evaluate(() => {
      const panel = document.querySelector('dialog.practice-tray-panel');
      if (!(panel instanceof HTMLElement)) return '';
      return getComputedStyle(panel, '::before').backdropFilter;
    });
    if (!filter.includes('blur')) {
      throw new Error(
        `production tray backdrop-filter at ${width}px is "${filter}"`,
      );
    }
    if (shotDir) {
      await page.screenshot({
        path: `${shotDir}/tray-${width}-day-open-frost.png`,
      });
    }
    await page.keyboard.press('Escape');
    await page.locator('#practice-tray').waitFor({ state: 'detached' });
  }
  console.log(
    'Verified computed tray blur on the static export at 1280 and 390.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
