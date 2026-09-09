import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import {
  themeBootstrap,
  THEME_KEY,
  SCENE_KEY,
  currentTheme,
  subscribeTheme,
  chooseTheme,
} from '../lib/theme.ts';

function browser({
  stored = null,
  dark = false,
  scene = null,
  blocked = false,
}: {
  stored?: string | null;
  scene?: string | null;
  dark?: boolean;
  blocked?: boolean;
} = {}) {
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
  let savedScene = scene;
  const localStorage = {
    getItem(key: string) {
      assert.ok(key === THEME_KEY || key === SCENE_KEY);
      if (blocked) throw new Error('Storage blocked');
      return key === THEME_KEY ? saved : savedScene;
    },
    setItem(key: string, value: string) {
      assert.ok(key === THEME_KEY || key === SCENE_KEY);
      if (blocked) throw new Error('Storage blocked');
      if (key === THEME_KEY) saved = value;
      else savedScene = value;
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
    savedScene: () => savedScene,
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
      if (storageArea === localStorage) {
        if (key === THEME_KEY || key === null) saved = newValue;
        if (key === SCENE_KEY || key === null) savedScene = newValue;
      }
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

void test('decoration captures the old appearance once before the latest merged choice commits', async () => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  const finishers: (() => void)[] = [];
  const restore = install({
    ...page.globals,
    Image: class {
      decode() {
        return new Promise<void>((resolve) => finishers.push(resolve));
      }
    },
  });
  const events: string[] = [];
  const snapshot = () => `${theme.currentTheme()}/${theme.currentScene()}`;
  page.window.addEventListener(theme.APPEARANCE_CHANGE_EVENT, () =>
    events.push(`before: ${snapshot()}`),
  );
  const stopTheme = theme.subscribeTheme(() =>
    events.push(`theme: ${snapshot()}`),
  );
  const stopScene = theme.subscribeScene(() =>
    events.push(`scene: ${snapshot()}`),
  );
  try {
    const pending = [theme.chooseScene('twilight'), theme.chooseTheme('night')];
    assert.deepEqual(events, [], 'preloading leaves the existing scene intact');
    for (const finish of finishers) finish();
    await Promise.all(pending);
    assert.deepEqual(events, [
      'before: day/pond',
      'theme: night/twilight',
      'scene: night/twilight',
    ]);
  } finally {
    stopTheme();
    stopScene();
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

void test('appearance commits directly without capturing controls in browser view transitions', async () => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  let reducedMotion = false;
  const events: string[] = [];
  page.window.addEventListener(theme.APPEARANCE_CHANGE_EVENT, () =>
    events.push(`before: ${theme.currentTheme()}`),
  );
  const restore = install({
    ...page.globals,
    document: {
      ...page.globals.document,
      startViewTransition() {
        assert.fail(
          'Appearance changes must never capture live controls in a browser overlay',
        );
      },
    },
    matchMedia(query: string) {
      return query === '(prefers-reduced-motion: reduce)'
        ? { matches: reducedMotion }
        : page.globals.matchMedia(query);
    },
  });
  try {
    await theme.chooseTheme('night');
    assert.equal(theme.currentTheme(), 'night');
    assert.equal(page.saved(), 'night');
    reducedMotion = true;
    await theme.chooseTheme('day');
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.saved(), 'day');
    assert.deepEqual(events, ['before: day', 'before: night']);
    await theme.chooseTheme('day');
    assert.equal(
      events.length,
      2,
      'unchanged appearance does not start another fade',
    );
  } finally {
    restore();
  }
});

void test('bootstrap chooses all three scenes independently of the light/dark preference', () => {
  for (const scene of ['pond', 'tidepool', 'twilight', 'invalid', null]) {
    for (const dark of [true, false]) {
      const page = browser({ scene, dark });
      page.boot();
      assert.equal(
        page.root.dataset.scene,
        scene === 'tidepool' || scene === 'twilight' ? scene : 'pond',
      );
      assert.equal(page.root.dataset.theme, dark ? 'night' : 'day');
      assert.equal(page.root.dataset.themePreference, 'system');
    }
  }
  const page = browser({ scene: 'twilight', blocked: true });
  page.boot();
  assert.equal(page.root.dataset.scene, 'pond');
});

void test('scene selection preserves both explicit and system mode preferences through reload', async () => {
  for (const stored of [null, 'day', 'night']) {
    const theme = await freshTheme();
    const page = browser({ stored, dark: true });
    page.boot();
    const restore = install(page.globals);
    const unsubscribe = theme.subscribeScene(() => {});
    try {
      await theme.chooseScene('twilight');
      assert.equal(theme.currentScene(), 'twilight');
      assert.equal(theme.currentTheme(), stored ?? 'night');
      assert.equal(page.root.dataset.themePreference, stored ?? 'system');
      assert.equal(page.saved(), stored);
      assert.equal(page.savedScene(), 'twilight');
      page.boot();
      assert.equal(theme.currentScene(), 'twilight');
      assert.equal(theme.currentTheme(), stored ?? 'night');
      if (!stored) {
        page.system(false);
        assert.equal(theme.currentTheme(), 'day');
        assert.equal(theme.currentScene(), 'twilight');
      }
    } finally {
      unsubscribe();
      restore();
    }
  }
});

void test('rapid scene and mode selections compose in either order while images are loading', async () => {
  for (const first of ['scene', 'theme']) {
    const theme = await freshTheme();
    const page = browser();
    page.boot();
    const finishers: (() => void)[] = [];
    const restore = install({
      ...page.globals,
      Image: class {
        decode() {
          return new Promise<void>((resolve) => finishers.push(resolve));
        }
      },
    });
    try {
      const pending =
        first === 'scene'
          ? [theme.chooseScene('twilight'), theme.chooseTheme('night')]
          : [theme.chooseTheme('night'), theme.chooseScene('twilight')];
      for (const finish of finishers) finish();
      await Promise.all(pending);
      assert.equal(theme.currentScene(), 'twilight');
      assert.equal(theme.currentTheme(), 'night');
      assert.equal(page.savedScene(), 'twilight');
      assert.equal(page.saved(), 'night');
    } finally {
      restore();
    }
  }
});

void test('the latest scene choice wins when its image finishes before an earlier choice', async () => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  const finishers = new Map<string, () => void>();
  const restore = install({
    ...page.globals,
    Image: class {
      src = '';
      decode() {
        return new Promise<void>((resolve) => finishers.set(this.src, resolve));
      }
    },
  });
  try {
    const first = theme.chooseScene('tidepool');
    const last = theme.chooseScene('twilight');
    finishers.get('/progger-twilight-day.webp')!();
    await last;
    finishers.get('/progger-tidepool-day.webp')!();
    await first;
    assert.equal(theme.currentScene(), 'twilight');
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.savedScene(), 'twilight');
    assert.equal(page.saved(), null);
  } finally {
    restore();
  }
});

void test('scene and theme subscriptions share environment listeners and detach independently', async () => {
  const theme = await freshTheme();
  const page = browser({ scene: 'tidepool', stored: 'night' });
  page.boot();
  page.storage(SCENE_KEY, 'twilight');
  const restore = install(page.globals);
  let themeNotifications = 0;
  let sceneNotifications = 0;
  const stopTheme = theme.subscribeTheme(() => themeNotifications++);
  const stopScene = theme.subscribeScene(() => sceneNotifications++);
  try {
    assert.equal(
      theme.currentScene(),
      'twilight',
      'hydrate the latest saved scene',
    );
    page.storage(SCENE_KEY, 'tidepool');
    assert.equal(sceneNotifications, 1, 'one update despite two consumers');
    assert.equal(themeNotifications, 0);
    assert.equal(theme.currentTheme(), 'night');
    assert.equal(page.root.dataset.themePreference, 'night');
    page.storage(THEME_KEY, 'day');
    assert.equal(themeNotifications, 1);
    assert.equal(theme.currentScene(), 'tidepool');
    stopTheme();
    stopTheme();
    page.storage(SCENE_KEY, null);
    assert.equal(theme.currentScene(), 'pond');
    page.storage(THEME_KEY, 'night');
    assert.equal(
      theme.currentTheme(),
      'night',
      'scene consumer keeps environment alive',
    );
    assert.equal(themeNotifications, 1, 'removed consumer is not called');
    stopScene();
    page.storage(SCENE_KEY, 'twilight');
    assert.equal(
      theme.currentScene(),
      'pond',
      'last unmount detaches environment',
    );
  } finally {
    stopTheme();
    stopScene();
    restore();
  }
});

void test('cross-tab scene changes preserve pending local mode changes and vice versa', async () => {
  for (const otherPreference of ['scene', 'theme']) {
    const theme = await freshTheme();
    const page = browser();
    page.boot();
    const finishers: (() => void)[] = [];
    const restore = install({
      ...page.globals,
      Image: class {
        decode() {
          return new Promise<void>((resolve) => finishers.push(resolve));
        }
      },
    });
    const unsubscribe = theme.subscribeScene(() => {});
    try {
      const pending =
        otherPreference === 'scene'
          ? theme.chooseTheme('night')
          : theme.chooseScene('twilight');
      if (otherPreference === 'scene') page.storage(SCENE_KEY, 'twilight');
      else page.storage(THEME_KEY, 'night');
      for (const finish of finishers) finish();
      await pending;
      // The original intent was superseded by a merged commit from storage.
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(theme.currentScene(), 'twilight');
      assert.equal(theme.currentTheme(), 'night');
      assert.equal(page.savedScene(), 'twilight');
      assert.equal(page.saved(), 'night');
    } finally {
      unsubscribe();
      restore();
    }
  }
});

void test('clearing localStorage cancels both pending choices and restores pond with system mode', async () => {
  const theme = await freshTheme();
  const page = browser({ scene: 'tidepool', stored: 'night' });
  page.boot();
  const finishers: (() => void)[] = [];
  const restore = install({
    ...page.globals,
    Image: class {
      decode() {
        return new Promise<void>((resolve) => finishers.push(resolve));
      }
    },
  });
  const unsubscribe = theme.subscribeScene(() => {});
  try {
    const pending = [theme.chooseScene('twilight'), theme.chooseTheme('day')];
    page.storage(null, null);
    for (const finish of finishers) finish();
    await Promise.all(pending);
    assert.equal(theme.currentScene(), 'pond');
    assert.equal(theme.currentTheme(), 'day');
    assert.equal(page.savedScene(), null);
    assert.equal(page.saved(), null);
    assert.equal(page.root.dataset.themePreference, 'system');
    page.system(true);
    assert.equal(theme.currentTheme(), 'night');
  } finally {
    unsubscribe();
    restore();
  }
});

void test('system mode changes during a scene load use the latest matching artwork', async () => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  const finishers = new Map<string, () => void>();
  const restore = install({
    ...page.globals,
    Image: class {
      src = '';
      decode() {
        return new Promise<void>((resolve) => finishers.set(this.src, resolve));
      }
    },
  });
  const unsubscribe = theme.subscribeScene(() => {});
  try {
    const pending = theme.chooseScene('twilight');
    page.system(true);
    assert.ok(finishers.has('/progger-twilight-night.webp'));
    for (const finish of finishers.values()) finish();
    await pending;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(theme.currentScene(), 'twilight');
    assert.equal(theme.currentTheme(), 'night');
    assert.equal(page.root.dataset.themePreference, 'system');
    assert.equal(page.saved(), null);
  } finally {
    unsubscribe();
    restore();
  }
});

void test('scene warmup requests only that scene and mode and reuses decoded assets', async () => {
  const theme = await freshTheme();
  const page = browser({ scene: 'twilight', stored: 'night' });
  page.boot();
  const requests: string[] = [];
  const restore = install({
    ...page.globals,
    Image: class {
      src = '';
      decode() {
        requests.push(this.src);
        return Promise.resolve();
      }
    },
  });
  try {
    await theme.warmScene('tidepool');
    await theme.warmScene('tidepool');
    await theme.warmTheme('day');
    assert.deepEqual(requests, [
      '/progger-tidepool-night.webp',
      '/progger-twilight-day.webp',
    ]);
  } finally {
    restore();
  }
});

void test('blocked persistence and failed artwork still allow a visit-only scene choice', async () => {
  const theme = await freshTheme();
  const page = browser({ blocked: true });
  page.boot();
  const restore = install(page.globals);
  try {
    await theme.chooseScene('twilight');
    assert.equal(theme.currentScene(), 'twilight');
    const unsubscribe = theme.subscribeScene(() => {});
    assert.equal(
      theme.currentScene(),
      'twilight',
      'hydration retains visit-only choice',
    );
    unsubscribe();
    await theme.chooseTheme('night');
    assert.equal(theme.currentScene(), 'twilight');
    assert.equal(theme.currentTheme(), 'night');
  } finally {
    restore();
  }
});

void test('a stalled scene image cannot hold selection beyond the preload deadline', async (context) => {
  const theme = await freshTheme();
  const page = browser();
  page.boot();
  context.mock.timers.enable({ apis: ['setTimeout'] });
  const restore = install({
    ...page.globals,
    Image: class {
      decode() {
        return new Promise<void>(() => {});
      }
    },
  });
  try {
    const pending = theme.chooseScene('twilight');
    context.mock.timers.tick(1200);
    await pending;
    assert.equal(theme.currentScene(), 'twilight');
    assert.equal(page.savedScene(), 'twilight');
  } finally {
    context.mock.timers.reset();
    restore();
  }
});

void test('cross-tab reset captures the old appearance once and notifies the complete new pair', async () => {
  const theme = await freshTheme();
  const page = browser({ scene: 'twilight', stored: 'night' });
  page.boot();
  const restore = install(page.globals);
  const events: string[] = [];
  const snapshot = () => `${theme.currentTheme()}/${theme.currentScene()}`;
  page.window.addEventListener(theme.APPEARANCE_CHANGE_EVENT, () =>
    events.push(`before: ${snapshot()}`),
  );
  const stopTheme = theme.subscribeTheme(() =>
    events.push(`theme: ${snapshot()}`),
  );
  const stopScene = theme.subscribeScene(() =>
    events.push(`scene: ${snapshot()}`),
  );
  try {
    page.storage(null, null);
    assert.deepEqual(events, [
      'before: night/twilight',
      'theme: day/pond',
      'scene: day/pond',
    ]);
  } finally {
    stopTheme();
    stopScene();
    restore();
  }
});
