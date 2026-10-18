import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { trayFrostProblems } from './tray-frost-css.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(
  new URL('../node_modules/vinext/dist/cli.js', import.meta.url),
);
const result = spawnSync(process.execPath, [cli, 'build'], {
  cwd: root,
  env: { ...process.env, PROGGER_STATIC_EXPORT: '1' },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// A successful bundle alone is insufficient: static prerendering can skip a
// route. Fail the deployment rather than publishing assets without a homepage.
const html = new URL('../dist/client/index.html', import.meta.url);
const rsc = new URL('../dist/client/index.txt', import.meta.url);
if (
  !existsSync(html) ||
  !existsSync(rsc) ||
  !readFileSync(html, 'utf8').includes('main-content')
) {
  throw new Error('Static export did not produce a complete Progger homepage.');
}
console.log('Verified static homepage and hydration payload for Vercel.');

const client = fileURLToPath(new URL('../dist/client/', import.meta.url));
const css = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name.endsWith('.css')) css.push(readFileSync(path, 'utf8'));
  }
};
walk(client);
const frost = trayFrostProblems(css.join('\n'));
if (frost.length) {
  throw new Error(
    `Practice tray frost did not survive the build:\n${frost.join('\n')}`,
  );
}
console.log('Verified unprefixed tray backdrop-filter in the production CSS.');
