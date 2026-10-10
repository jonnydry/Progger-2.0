import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
const homepage = readFileSync(html, 'utf8');
if (homepage.includes('/lab/drone')) {
  throw new Error('The public homepage links the unlisted drone preview.');
}

// A non-OK prerender fails vinext's entire static export, so production
// removes the already-built route instead of calling notFound().
const droneFiles = [
  'lab/drone.html',
  'lab/drone.txt',
  'lab/drone/index.html',
  'lab/drone/index.txt',
];
const droneUrl = (relative) => new URL(`../dist/client/${relative}`, import.meta.url);
if (process.env.VERCEL_ENV === 'production') {
  for (const relative of droneFiles) {
    const file = droneUrl(relative);
    if (existsSync(file)) rmSync(file);
  }
  for (const relative of droneFiles) {
    if (existsSync(droneUrl(relative))) {
      throw new Error(`Production export still contains ${relative}.`);
    }
  }
  console.log('Removed /lab/drone from the production static export.');
} else {
  const previewHtml = existsSync(droneUrl('lab/drone.html'))
    ? droneUrl('lab/drone.html')
    : droneUrl('lab/drone/index.html');
  const previewRsc = existsSync(droneUrl('lab/drone.txt'))
    ? droneUrl('lab/drone.txt')
    : droneUrl('lab/drone/index.txt');
  if (!existsSync(previewHtml) || !existsSync(previewRsc)) {
    throw new Error('Static export did not produce the drone preview route.');
  }
  if (!/noindex/i.test(readFileSync(previewHtml, 'utf8'))) {
    throw new Error('The drone preview is missing a noindex robots tag.');
  }
  console.log('Verified the unlisted drone preview is noindex.');
}

console.log('Verified static homepage and hydration payload for Vercel.');
