import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { headerLockCss } from '../lib/header-lock.ts';

const layout = readFileSync(
  new URL('../app/layout.tsx', import.meta.url),
  'utf8',
);
const practice = readFileSync(
  new URL('../app/practice-view.css', import.meta.url),
  'utf8',
);

void test('the document pins the bar over the scene ahead of a cached sheet', () => {
  assert.match(layout, /__html:\s*headerLockCss/);
  assert.match(
    headerLockCss,
    /html:has\(\.night-swim\) \.night-swim > \.site-header/,
  );
  assert.match(headerLockCss, /position:\s*sticky/);
  assert.match(headerLockCss, /top:\s*0/);
  assert.match(headerLockCss, /z-index:\s*20/);
  assert.match(headerLockCss, /height:\s*var\(--site-bar,\s*76px\)/);
  assert.match(
    headerLockCss,
    /html:has\(\.night-swim\) \.night-swim > \.header-scene[\s\S]*margin-top:\s*calc\(-1 \* var\(--site-bar,\s*76px\)\)/,
  );
  assert.equal(headerLockCss.includes('!important'), false);
  const screen = headerLockCss.slice(0, headerLockCss.indexOf('}'));
  assert.match(screen, /@media not print/);
  assert.match(screen, /position:\s*sticky/);
  assert.equal(
    headerLockCss.slice(headerLockCss.indexOf('}')).includes('position:'),
    false,
  );
});

void test('practice view keeps the bar height and --site-bar on the same pixels', () => {
  const heights = [
    ...practice.matchAll(
      /\.night-swim\.practice-view \.site-header\s*\{[^}]*height:\s*(\d+)px/g,
    ),
  ].map((match) => match[1]);
  const bars = [...practice.matchAll(/--site-bar:\s*(\d+)px/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(heights, ['94', '124', '108']);
  assert.deepEqual(bars, heights);
});
