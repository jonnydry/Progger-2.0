import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  themeBootstrap,
  THEME_KEY,
  currentTheme,
  subscribeTheme,
  chooseTheme,
} from '../lib/theme.ts';

function browser({
  stored = null,
  dark = false,
  blocked = false,
}: { stored?: string | null; dark?: boolean; blocked?: boolean } = {}) {
  const classes = new Set(['dark']);
  const root = {
    dataset: {} as Record<string, string>,
    classList: {
      toggle(name: string, enabled: boolean) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
  };
  const media = Object.assign(new EventTarget(), { matches: dark });
  const window = new EventTarget();
  let saved = stored;
  const localStorage = {
    getItem(key: string) {
      assert.equal(key, THEME_KEY);
      if (blocked) throw new Error('Storage blocked');
      return saved;
    },
    setItem(key: string, value: string) {
      assert.equal(key, THEME_KEY);
      if (blocked) throw new Error('Storage blocked');
      saved = value;
    },
  };
  const globals = {
    document: { documentElement: root },
    window,
    localStorage,
    matchMedia(query: string) {
      if (query === '(prefers-color-scheme: dark)') return media;
      return { matches: query === '(prefers-reduced-motion: reduce)' };
    },
    Image: class {
      src = '';
      decode() {
        return Promise.reject(new Error('Artwork unavailable'));
      }
    },
  };
  return {
    root,
    classes,
    media,
    window,
    globals,
    saved: () => saved,
    boot() {
      runInNewContext(themeBootstrap, globals);
    },
    system(dark: boolean) {
      media.matches = dark;
      media.dispatchEvent(new Event('change'));
    },
    storage(
      key: string | null,
      newValue: string | null,
      storageArea: unknown = localStorage,
    ) {
      if (storageArea === localStorage && (key === THEME_KEY || key === null))
        saved = newValue;
      window.dispatchEvent(
        Object.assign(new Event('storage'), { key, newValue, storageArea }),
      );
    },
  };
}
function install(globals: Record<string, unknown>) {
  const previous = new Map(
    Object.keys(globals).map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  for (const [key, value] of Object.entries(globals))
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  return () => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  };
}

void test('pre-paint bootstrap honors explicit choices and otherwise follows the device', () => {
  for (const fixture of [
    { stored: 'day', dark: true, expected: 'day', preference: 'day' },
    { stored: 'night', dark: false, expected: 'night', preference: 'night' },
    { stored: null, dark: true, expected: 'night', preference: 'system' },
    { stored: null, dark: false, expected: 'day', preference: 'system' },
    { stored: 'invalid', dark: true, expected: 'night', preference: 'system' },
    { stored: 'invalid', dark: false, expected: 'day', preference: 'system' },
  ]) {
    const page = browser(fixture);
    page.boot();
    assert.equal(page.root.dataset.theme, fixture.expected);
    assert.equal(page.root.dataset.themePreference, fixture.preference);
    assert.equal(page.classes.has('dark'), fixture.expected === 'night');
  }
});

let fixtureId = 0;
function freshTheme() {
  // Each browser fixture gets its own module-scoped artwork cache and intent.
  return import(
    new URL(`../lib/theme.ts?fixture=${fixtureId++}`, import.meta.url).href
  ) as Promise<typeof import('../lib/theme.ts')>;
}

void test('subscription reconciles system and storage changes between bootstrap and hydration', async () => {
  for (const source of ['system', 'storage']) {
    const theme = await freshTheme();
    const page = browser();
    page.boot();
    if (source === 'system') page.system(true);
    else page.storage(THEME_KEY, 'night');
    const restore = install(page.globals);
    const unsubscribe = theme.subscribeTheme(() => {});
    try {
      assert.equal(theme.currentTheme(), 'night');
      assert.equal(
        page.root.dataset.themePreference,
        source === 'system' ? 'system' : 'night',
      );
    } finally {
      unsubscribe();
      restore();
    }
  }
});

void test('a newer cross-tab preference supersedes a manual choice still loading artwork', async () => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  let finish!: () => void;
  const decoding = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const restore = install({
    ...page.globals,
    Image: class {
      decode() {
        return decoding;
      }
    },
  });
  const unsubscribe = theme.subscribeTheme(() => {});
  try {
    const pending = theme.chooseTheme('night');
    page.storage(THEME_KEY, 'day');
    finish();
    await pending;
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.saved(), 'day');
    assert.equal(page.root.dataset.themePreference, 'day');
  } finally {
    unsubscribe();
    restore();
  }
});

void test('clearing a cross-tab preference also cancels a queued transition callback', async () => {
  const theme = await freshTheme();
  const page = browser({ stored: 'day' });
  page.boot();
  let update!: () => void;
  let finish!: () => void;
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const callbackDone = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const restore = install({
    ...page.globals,
    matchMedia(query: string) {
      return query.includes('reduced-motion')
        ? { matches: false }
        : page.globals.matchMedia(query);
    },
    document: {
      ...page.globals.document,
      startViewTransition(callback: () => void) {
        update = callback;
        started();
        return {
          ready: Promise.resolve(),
          updateCallbackDone: callbackDone,
          skipTransition() {},
        };
      },
    },
  });
  const unsubscribe = theme.subscribeTheme(() => {});
  try {
    const pending = theme.chooseTheme('night');
    await ready;
    page.storage(THEME_KEY, null);
    update();
    finish();
    await pending;
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.saved(), null);
    assert.equal(page.root.dataset.themePreference, 'system');
    page.system(true);
    assert.equal(theme.currentTheme(), 'night');
  } finally {
    unsubscribe();
    restore();
  }
});

void test('the latest manual intent wins even when an earlier artwork load finishes last', async () => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  const finishers = new Map<string, () => void>();
  const restore = install({
    ...page.globals,
    Image: class {
      src = '';
      decode() {
        return new Promise<void>((resolve) => {
          finishers.set(this.src, resolve);
        });
      }
    },
  });
  try {
    const oldChoice = theme.chooseTheme('night');
    const latestChoice = theme.chooseTheme('day');
    for (const [src, finish] of finishers) if (src.includes('-day-')) finish();
    await latestChoice;
    for (const finish of finishers.values()) finish();
    await oldChoice;
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.saved(), 'day');
  } finally {
    restore();
  }
});

void test('session storage events cannot change the persistent theme', async () => {
  const theme = await freshTheme();
  const page = browser({ stored: 'day' });
  page.boot();
  const restore = install(page.globals);
  const unsubscribe = theme.subscribeTheme(() => {});
  try {
    page.storage(THEME_KEY, 'night', {});
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.saved(), 'day');
  } finally {
    unsubscribe();
    restore();
  }
});

void test('artwork warmup retries failed requests and loads the appropriate asset after a viewport change', async () => {
  const theme = await freshTheme();
  const page = browser();
  let mobile = false;
  let fail = true;
  const requests: string[] = [];
  const restore = install({
    ...page.globals,
    matchMedia(query: string) {
      return query.includes('max-width')
        ? { matches: mobile }
        : page.globals.matchMedia(query);
    },
    Image: class {
      src = '';
      decode() {
        requests.push(this.src);
        return fail ? Promise.reject(new Error('Offline')) : Promise.resolve();
      }
    },
  });
  try {
    await theme.warmTheme('night');
    fail = false;
    await theme.warmTheme('night');
    mobile = true;
    await theme.warmTheme('night');
    assert.deepEqual(requests, [
      '/progger-arcade-pond.webp',
      '/progger-underwater.webp',
      '/progger-arcade-pond.webp',
      '/progger-underwater.webp',
      '/progger-underwater-mobile.webp',
    ]);
  } finally {
    restore();
  }
});

void test('blocked storage does not prevent initial theme or an explicit manual change', async () => {
  const page = browser({ blocked: true, dark: false });
  page.boot();
  assert.equal(page.root.dataset.theme, 'day');
  assert.equal(page.root.dataset.themePreference, 'system');
  const restore = install(page.globals);
  try {
    // Rejected artwork decoding and rejected persistence must not lock the choice.
    await chooseTheme('night');
    assert.equal(currentTheme(), 'night');
    assert.equal(page.root.dataset.themePreference, 'night');
    assert.equal(page.classes.has('dark'), true);
  } finally {
    restore();
  }
});

void test('manual choices stop device changes while cross-tab reset restores them; cleanup detaches listeners', async () => {
  const page = browser({ dark: true });
  page.boot();
  const restore = install(page.globals),
    observed: string[] = [];
  const unsubscribe = subscribeTheme(() => observed.push(currentTheme()));
  try {
    page.system(false);
    assert.equal(currentTheme(), 'day');
    await chooseTheme('night');
    assert.equal(currentTheme(), 'night');
    assert.equal(page.saved(), 'night');
    page.system(true);
    page.system(false);
    assert.equal(currentTheme(), 'night');
    assert.equal(page.root.dataset.themePreference, 'night');
    page.storage('unrelated-setting', 'day');
    assert.equal(currentTheme(), 'night');
    page.storage(THEME_KEY, 'day');
    assert.equal(currentTheme(), 'day');
    assert.equal(page.root.dataset.themePreference, 'day');
    page.system(true);
    assert.equal(currentTheme(), 'day');
    page.storage(THEME_KEY, null);
    assert.equal(currentTheme(), 'night');
    assert.equal(page.root.dataset.themePreference, 'system');
    page.system(false);
    assert.equal(currentTheme(), 'day');
    page.storage(THEME_KEY, 'night');
    assert.equal(currentTheme(), 'night');
    page.storage(null, null);
    assert.equal(currentTheme(), 'day');
    assert.equal(page.root.dataset.themePreference, 'system');
    page.storage(THEME_KEY, 'malformed');
    assert.equal(currentTheme(), 'day');
    assert.equal(page.root.dataset.themePreference, 'system');
    assert.deepEqual(observed, [
      'day',
      'night',
      'day',
      'night',
      'day',
      'night',
      'day',
      'day',
    ]);
    unsubscribe();
    const count = observed.length;
    page.system(true);
    page.storage(THEME_KEY, 'night');
    assert.equal(currentTheme(), 'day');
    assert.equal(observed.length, count);
  } finally {
    unsubscribe();
    restore();
  }
});

void test('available view transitions run the theme callback unless reduced motion is requested', async () => {
  const page = browser({ dark: false });
  page.boot();
  let reducedMotion = false;
  let skipped = 0;
  const events: string[] = [];
  const restore = install({
    ...page.globals,
    document: {
      ...page.globals.document,
      startViewTransition(update: () => void) {
        events.push('transition started');
        const updateCallbackDone = Promise.resolve().then(() => {
          events.push(`before callback: ${currentTheme()}`);
          update();
          events.push(`after callback: ${currentTheme()}`);
        });
        return {
          ready: Promise.resolve(),
          updateCallbackDone,
          skipTransition() {
            skipped++;
          },
        };
      },
    },
    matchMedia(query: string) {
      return query === '(prefers-reduced-motion: reduce)'
        ? { matches: reducedMotion }
        : page.globals.matchMedia(query);
    },
  });
  try {
    await chooseTheme('night');
    assert.deepEqual(events, [
      'transition started',
      'before callback: day',
      'after callback: night',
    ]);
    assert.equal(currentTheme(), 'night');
    assert.equal(page.saved(), 'night');

    reducedMotion = true;
    await chooseTheme('day');
    assert.equal(
      events.length,
      3,
      'Reduced motion must bypass the available transition API',
    );
    assert.equal(skipped, 1, 'Any preceding transition is stopped');
    assert.equal(currentTheme(), 'day');
    assert.equal(page.saved(), 'day');
    assert.equal(page.root.dataset.themePreference, 'day');
    assert.equal(page.classes.has('dark'), false);
  } finally {
    restore();
  }
});
