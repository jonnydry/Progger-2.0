import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { transform } from 'lightningcss';
import { trayFrostProblems } from '../scripts/tray-frost-css.mjs';

const targets = {
  chrome: 111 << 16,
  edge: 111 << 16,
  firefox: 114 << 16,
  safari: (16 << 16) | (4 << 8),
  ios_saf: (16 << 16) | (4 << 8),
};

function minify(css: string): string {
  const { code } = transform({
    filename: 'practice-tray.css',
    code: Buffer.from(css),
    minify: true,
    targets,
  });
  return code.toString();
}

void test('production minify keeps an unprefixed tray blur and a 99% fallback', () => {
  const source = readFileSync(
    new URL('../app/practice-tray.css', import.meta.url),
    'utf8',
  );
  const built = minify(source);
  assert.deepEqual(trayFrostProblems(built), []);
  assert.match(built, /--tray-tint-solid:99%/);
  assert.doesNotMatch(built, /--tray-tint-solid:100%/);

  const dropped = built.replace(/(?<!-)backdrop-filter:[^;}]+;?/g, '');
  const missing = trayFrostProblems(dropped);
  assert.equal(
    missing.some((problem) => problem.includes('unprefixed')),
    true,
  );

  const opaque = built.replace(
    '--tray-tint-solid:99%',
    '--tray-tint-solid:100%',
  );
  const solid = trayFrostProblems(opaque);
  assert.equal(
    solid.some((problem) => problem.includes('99%')),
    true,
  );
});
