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

void test('production minify keeps an unprefixed tray blur and a 99.9% fallback', () => {
  const source = readFileSync(
    new URL('../app/practice-tray.css', import.meta.url),
    'utf8',
  );
  const built = minify(source);
  assert.deepEqual(trayFrostProblems(built), []);
  assert.match(built, /--tray-tint-solid:99\.9%/);
  assert.match(built, /--tray-tint:68%/);
  assert.match(built, /--tray-blur:72px/);
  assert.doesNotMatch(built, /--tray-tint-solid:100%/);
  assert.doesNotMatch(built, /--tray-tint:90%/);
  const frostSource = source.match(
    /dialog\.practice-tray-panel::before\s*\{[^}]*\}/,
  );
  assert.ok(frostSource, 'source frost rule');
  const decls = frostSource[0]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.includes('backdrop-filter'));
  assert.equal(decls[0]?.startsWith('-webkit-backdrop-filter'), true);
  assert.equal(decls[1]?.startsWith('backdrop-filter'), true);

  const dropped = built.replace(/(?<!-)backdrop-filter:[^;}]+;?/g, '');
  const missing = trayFrostProblems(dropped);
  assert.equal(
    missing.some((problem) => problem.includes('unprefixed')),
    true,
  );

  const thin = built.replace(
    '--tray-tint-solid:99.9%',
    '--tray-tint-solid:99%',
  );
  const tooThin = trayFrostProblems(thin);
  assert.equal(
    tooThin.some((problem) => problem.includes('99%')),
    true,
  );

  const opaque = built.replace(
    '--tray-tint-solid:99.9%',
    '--tray-tint-solid:100%',
  );
  const solid = trayFrostProblems(opaque);
  assert.equal(
    solid.some((problem) => problem.includes('99.9%')),
    true,
  );
});
