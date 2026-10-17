import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vinextShareDir } from './dev-server.ts';

void test('the vinext lock directory is unique to the checkout', () => {
  const here = vinextShareDir('/workspace');
  const there = vinextShareDir('/other/checkout');
  assert.notEqual(here, there);
  assert.match(here, /^\/tmp\/progger-vinext-share-[0-9a-f]{16}$/);
  assert.equal(vinextShareDir('/workspace'), here);
});
