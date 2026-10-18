import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { CHUNK_RELOAD_KEY, chunkReloadBootstrap } from '../lib/chunk-reload.ts';

const DEPLOY_A = 'https://progger.studio/_next/static/chunks/index-aaa.js';
const DEPLOY_B = 'https://progger.studio/_next/static/chunks/index-bbb.js';

function browser({
  blocked = false,
  onLine = true,
  deploy = DEPLOY_A,
  store = new Map<string, string>(),
  marker = 'link',
}: {
  blocked?: boolean;
  onLine?: boolean;
  deploy?: string;
  store?: Map<string, string>;
  marker?: 'link' | 'script' | 'none';
} = {}) {
  const reloads: number[] = [];
  const listeners = new Map<string, (event: Event) => void>();
  let current = deploy;
  const link = {
    get href() {
      return current;
    },
  };
  const script = {
    get src() {
      return current;
    },
  };
  const sessionStorage = {
    getItem(key: string) {
      if (blocked) throw new Error('Storage blocked');
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (blocked) throw new Error('Storage blocked');
      store.set(key, value);
    },
  };
  const navigator = { onLine };
  const globals = {
    addEventListener(type: string, listener: (event: Event) => void) {
      listeners.set(type, listener);
    },
    sessionStorage,
    location: {
      reload() {
        reloads.push(reloads.length + 1);
      },
    },
    document: {
      querySelector(selector: string) {
        if (!selector.includes('/chunks/index-')) return null;
        if (selector.includes('modulepreload'))
          return marker === 'link' ? link : null;
        if (selector.includes('script'))
          return marker === 'script' ? script : null;
        return null;
      },
    },
    navigator,
  };
  runInNewContext(chunkReloadBootstrap, globals);
  return {
    reloads,
    store,
    stored: () => store.get(CHUNK_RELOAD_KEY) ?? null,
    setDeploy(next: string) {
      current = next;
    },
    failChunk() {
      let prevented = false;
      const event = {
        preventDefault() {
          prevented = true;
        },
      };
      listeners.get('vite:preloadError')?.(event as unknown as Event);
      return prevented;
    },
  };
}

void test('the same deploy does not reload twice', () => {
  const page = browser();
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1]);
  assert.equal(page.stored(), DEPLOY_A);

  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1]);
});

void test('a new deploy reloads again', () => {
  const page = browser();
  page.failChunk();
  page.setDeploy(DEPLOY_B);
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1, 2]);
  assert.equal(page.stored(), DEPLOY_B);
});

void test('a duplicated tab does not inherit suppression for a later deploy', () => {
  const original = browser();
  original.failChunk();
  const duplicate = browser({ store: original.store, deploy: DEPLOY_A });
  assert.equal(duplicate.failChunk(), false);
  assert.deepEqual(duplicate.reloads, []);

  duplicate.setDeploy(DEPLOY_B);
  assert.equal(duplicate.failChunk(), false);
  assert.deepEqual(duplicate.reloads, [1]);
  assert.equal(duplicate.stored(), DEPLOY_B);
});

void test('a page with no index chunk does not reload', () => {
  const page = browser({ marker: 'none' });
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, []);
  assert.equal(page.stored(), null);
});

void test('a script tag supplies the deploy address when no modulepreload exists', () => {
  const page = browser({ marker: 'script' });
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1]);
  assert.equal(page.stored(), DEPLOY_A);

  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1]);
});

void test('an offline chunk failure does not reload', () => {
  const page = browser({ onLine: false });
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, []);
  assert.equal(page.stored(), null);
});

void test('blocked session storage does not reload or swallow the chunk error', () => {
  const page = browser({ blocked: true });
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, []);
  assert.equal(page.stored(), null);
});

void test('the document installs the chunk reload before paint', () => {
  const layout = readFileSync(
    new URL('../app/layout.tsx', import.meta.url),
    'utf8',
  );
  assert.match(layout, /__html:\s*chunkReloadBootstrap/);
  assert.match(chunkReloadBootstrap, /vite:preloadError/);
  assert.match(chunkReloadBootstrap, /navigator\.onLine === false/);
  assert.match(chunkReloadBootstrap, /\/chunks\/index-/);
  assert.match(chunkReloadBootstrap, /location\.reload\(\)/);
  assert.equal(chunkReloadBootstrap.includes('preventDefault'), false);
  assert.equal(chunkReloadBootstrap.includes(CHUNK_RELOAD_KEY), true);
  assert.equal(chunkReloadBootstrap.includes(", '1'"), false);
});
