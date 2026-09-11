export type Theme = 'day' | 'night';
export type Scene = 'pond' | 'tidepool' | 'twilight';
export const THEME_KEY = 'progger.theme.v1';
export const SCENE_KEY = 'progger.scene.v1';
export const APPEARANCE_CHANGE_EVENT = 'progger-appearance-before-change';
export const SCENES = [
  {
    id: 'pond',
    label: 'The Pond',
    description: 'Our home among the lily pads.',
    artwork: {
      day: '/art/v2/pond-day.webp',
      night: '/art/v2/pond-night.webp',
    },
  },
  {
    id: 'tidepool',
    label: 'Tidepool',
    description: 'A little salt in the set list.',
    artwork: {
      day: '/art/v2/tidepool-day.webp',
      night: '/art/v2/tidepool-night.webp',
    },
  },
  {
    id: 'twilight',
    label: 'Twilight',
    description: 'Pink skies. Purple water. One more song.',
    artwork: {
      day: '/art/v2/twilight-day.webp',
      night: '/art/v2/twilight-night.webp',
    },
  },
] as const satisfies ReadonlyArray<{
  id: Scene;
  label: string;
  description: string;
  artwork: Record<Theme, string>;
}>;

function validScene(value: unknown): value is Scene {
  return SCENES.some((scene) => scene.id === value);
}

let intentVersion = 0;
// The controls are independent, including while artwork is loading. A quick
// mode change must retain a scene choice that has not reached the screen yet.
let pendingChoice: { theme?: Theme; scene?: Scene } = {};
let subscriberCount = 0;
let detachEnvironment: (() => void) | undefined;

// Runs before first paint so the correct palette and artwork load together.
// Storage is optional: private browsing must not prevent a usable theme.
export const themeBootstrap = `(()=>{let p='system',c='pond';try{const s=localStorage.getItem('${THEME_KEY}');if(s==='day'||s==='night')p=s;const v=localStorage.getItem('${SCENE_KEY}');if(${JSON.stringify(SCENES.map((scene) => scene.id))}.includes(v))c=v}catch{}const t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'night':'day'):p;const r=document.documentElement;r.dataset.theme=t;r.dataset.scene=c;r.dataset.themePreference=p;r.classList.toggle('dark',t==='night')})()`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'day' ? 'day' : 'night';
}
export function currentScene(): Scene {
  const value = document.documentElement.dataset.scene;
  return validScene(value) ? value : 'pond';
}
function applyAppearance(
  theme: Theme,
  scene: Scene,
  notifyTheme: boolean,
  notifyScene: boolean,
) {
  if (currentTheme() !== theme || currentScene() !== scene) {
    // The decorative layer snapshots its own old background before any visual
    // attributes change. Navigation stays live in the normal document layer.
    window.dispatchEvent(new Event(APPEARANCE_CHANGE_EVENT));
  }
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.dataset.scene = scene;
  root.classList.toggle('dark', theme === 'night');
  if (notifyTheme) window.dispatchEvent(new Event('progger-theme'));
  if (notifyScene) window.dispatchEvent(new Event('progger-scene'));
}
export function applyTheme(theme: Theme) {
  applyAppearance(theme, currentScene(), true, false);
}
function resumePendingChoice() {
  if (pendingChoice.theme || pendingChoice.scene) void commitChoice();
}
function attachEnvironment() {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const syncSystem = () => {
    if (document.documentElement.dataset.themePreference === 'system') {
      applyTheme(media.matches ? 'night' : 'day');
      // A loading scene needs artwork for the new system mode. An explicit
      // pending mode still wins when its artwork is ready.
      resumePendingChoice();
    }
  };
  const syncStorage = (event: StorageEvent) => {
    if (
      event.key !== THEME_KEY &&
      event.key !== SCENE_KEY &&
      event.key !== null
    )
      return;
    // Session storage uses the same event type but is not a preference.
    if (event.storageArea && event.storageArea !== localStorage) return;
    intentVersion++;
    let theme = currentTheme();
    let scene = currentScene();
    if (event.key === THEME_KEY || event.key === null) {
      delete pendingChoice.theme;
      const preference =
        event.newValue === 'day' || event.newValue === 'night'
          ? event.newValue
          : 'system';
      document.documentElement.dataset.themePreference = preference;
      theme =
        preference === 'system'
          ? media.matches
            ? 'night'
            : 'day'
          : preference;
    }
    if (event.key === SCENE_KEY || event.key === null) {
      delete pendingChoice.scene;
      scene = validScene(event.newValue) ? event.newValue : 'pond';
    }
    applyAppearance(
      theme,
      scene,
      event.key === THEME_KEY || event.key === null,
      event.key === SCENE_KEY || event.key === null,
    );
    // A change from another tab supersedes only its own preference. Preserve a
    // simultaneous local choice made with the other control.
    resumePendingChoice();
  };
  window.addEventListener('storage', syncStorage);
  media.addEventListener('change', syncSystem);
  // Reconcile changes made between bootstrap and hydration once per mounted
  // store. Additional React consumers must not install duplicate listeners.
  const root = document.documentElement;
  let scene = currentScene();
  try {
    const stored = localStorage.getItem(THEME_KEY);
    root.dataset.themePreference =
      stored === 'day' || stored === 'night' ? stored : 'system';
    const storedScene = localStorage.getItem(SCENE_KEY);
    scene = validScene(storedScene) ? storedScene : 'pond';
  } catch {
    /* Keep bootstrap or visit-only preferences when storage is unavailable. */
  }
  const preference = root.dataset.themePreference;
  const latest =
    preference === 'day' || preference === 'night'
      ? preference
      : media.matches
        ? 'night'
        : 'day';
  const themeChanged = currentTheme() !== latest;
  const sceneChanged = currentScene() !== scene;
  if (themeChanged || sceneChanged)
    applyAppearance(latest, scene, themeChanged, sceneChanged);
  return () => {
    window.removeEventListener('storage', syncStorage);
    media.removeEventListener('change', syncSystem);
  };
}
function subscribe(event: string, listener: () => void) {
  window.addEventListener(event, listener);
  if (subscriberCount++ === 0) detachEnvironment = attachEnvironment();
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    window.removeEventListener(event, listener);
    if (--subscriberCount === 0) {
      detachEnvironment?.();
      detachEnvironment = undefined;
    }
  };
}
export function subscribeTheme(listener: () => void) {
  return subscribe('progger-theme', listener);
}
export function subscribeScene(listener: () => void) {
  return subscribe('progger-scene', listener);
}

const warmed = new Map<string, Promise<void>>();
export function warmScene(scene: Scene, theme: Theme = currentTheme()) {
  const selected = SCENES.find((entry) => entry.id === scene) ?? SCENES[0];
  const urls: string[] = [selected.artwork[theme]];
  return Promise.allSettled(
    urls.map((src) => {
      let pending = warmed.get(src);
      if (!pending) {
        const image = new Image();
        image.src = src;
        pending = image.decode().catch((error: unknown) => {
          // A transient network failure must not permanently disable warmup.
          warmed.delete(src);
          throw error;
        });
        warmed.set(src, pending);
      }
      return pending;
    }),
  );
}
export function warmTheme(theme: Theme) {
  return warmScene(currentScene(), theme);
}
async function commitChoice() {
  const intent = ++intentVersion;
  const choice = { ...pendingChoice };
  const theme = choice.theme ?? currentTheme();
  const scene = choice.scene ?? currentScene();
  // Bound the wait for artwork. A slow or failed image never locks a control.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    warmScene(scene, theme),
    new Promise((resolve) => {
      timeout = setTimeout(resolve, 1200);
    }),
  ]);
  clearTimeout(timeout);
  if (intent !== intentVersion) return;
  const root = document.documentElement;
  if (choice.theme) {
    root.dataset.themePreference = choice.theme;
    try {
      localStorage.setItem(THEME_KEY, choice.theme);
    } catch {
      /* The choice still works for this visit. */
    }
  }
  if (choice.scene) {
    try {
      localStorage.setItem(SCENE_KEY, choice.scene);
    } catch {
      /* The choice still works for this visit. */
    }
  }
  pendingChoice = {};
  applyAppearance(
    theme,
    scene,
    Boolean(choice.theme) || currentTheme() !== theme,
    Boolean(choice.scene),
  );
}
export function chooseTheme(theme: Theme) {
  pendingChoice.theme = theme;
  return commitChoice();
}
export function chooseScene(scene: Scene) {
  pendingChoice.scene = scene;
  return commitChoice();
}
