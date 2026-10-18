import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { CHUNK_RELOAD_KEY, chunkReloadBootstrap } from '../lib/chunk-reload.ts';

function browser({ blocked = false }: { blocked?: boolean } = {}) {
  const store = new Map<string, string>();
  const reloads: number[] = [];
  const listeners = new Map<string, (event: Event) => void>();
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
  };
  runInNewContext(chunkReloadBootstrap, globals);
  return {
    reloads,
    stored: () => store.get(CHUNK_RELOAD_KEY) ?? null,
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

void test('a failed chunk reloads once and still rejects the import', () => {
  const page = browser();
  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1]);
  assert.equal(page.stored(), '1');

  assert.equal(page.failChunk(), false);
  assert.deepEqual(page.reloads, [1]);
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
  assert.match(layout, /chunkReloadBootstrap/);
  assert.match(chunkReloadBootstrap, /vite:preloadError/);
  assert.match(chunkReloadBootstrap, /location\.reload\(\)/);
  assert.equal(chunkReloadBootstrap.includes('preventDefault'), false);
  assert.equal(chunkReloadBootstrap.includes(CHUNK_RELOAD_KEY), true);
});
