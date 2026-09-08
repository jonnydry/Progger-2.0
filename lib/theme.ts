export type Theme = 'day' | 'night';
export const THEME_KEY = 'progger.theme.v1';
let intentVersion = 0;
let transition: ViewTransition | undefined;

// Runs before first paint so the correct palette and artwork load together.
// Storage is optional: private browsing must not prevent a usable theme.
export const themeBootstrap = `(()=>{let p='system';try{const s=localStorage.getItem('${THEME_KEY}');if(s==='day'||s==='night')p=s}catch{}const t=p==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'night':'day'):p;const r=document.documentElement;r.dataset.theme=t;r.dataset.themePreference=p;r.classList.toggle('dark',t==='night')})()`;

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'day' ? 'day' : 'night';
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle('dark', theme === 'night');
  window.dispatchEvent(new Event('progger-theme'));
}
export function subscribeTheme(listener: () => void) {
  const media = matchMedia('(prefers-color-scheme: dark)');
  const syncSystem = () => {
    if (document.documentElement.dataset.themePreference === 'system') {
      applyTheme(media.matches ? 'night' : 'day');
    }
  };
  const syncStorage = (event: StorageEvent) => {
    if (event.key !== THEME_KEY && event.key !== null) return;
    // Session storage uses the same event type but is not a theme preference.
    if (event.storageArea && event.storageArea !== localStorage) return;
    // A newer choice from another tab supersedes artwork still loading here,
    // including a view-transition callback that has not run yet.
    intentVersion++;
    transition?.skipTransition();
    const preference =
      event.newValue === 'day' || event.newValue === 'night'
        ? event.newValue
        : 'system';
    document.documentElement.dataset.themePreference = preference;
    applyTheme(
      preference === 'system' ? (media.matches ? 'night' : 'day') : preference,
    );
  };
  window.addEventListener('progger-theme', listener);
  window.addEventListener('storage', syncStorage);
  media.addEventListener('change', syncSystem);
  // Bootstrap can precede hydration by seconds. Reconcile changes that happened
  // before these listeners existed, while preserving a visit-only preference
  // when browser storage is unavailable.
  const root = document.documentElement;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    root.dataset.themePreference =
      stored === 'day' || stored === 'night' ? stored : 'system';
  } catch {
    /* Keep the preference established by bootstrap or this visit. */
  }
  const preference = root.dataset.themePreference;
  const latest =
    preference === 'day' || preference === 'night'
      ? preference
      : media.matches
        ? 'night'
        : 'day';
  if (currentTheme() !== latest) applyTheme(latest);
  return () => {
    window.removeEventListener('progger-theme', listener);
    window.removeEventListener('storage', syncStorage);
    media.removeEventListener('change', syncSystem);
  };
}
const artwork: Record<Theme, string[]> = {
  day: ['/progger-day-pond.webp', '/progger-day-water-v2.webp'],
  night: [
    '/progger-arcade-pond.webp',
    '/progger-underwater.webp',
    '/progger-underwater-mobile.webp',
  ],
};
const warmed = new Map<string, Promise<void>>();
export function warmTheme(theme: Theme) {
  const urls =
    theme === 'night'
      ? [
          artwork.night[0],
          artwork.night[matchMedia('(max-width: 600px)').matches ? 2 : 1],
        ]
      : artwork.day;
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
export async function chooseTheme(theme: Theme) {
  const intent = ++intentVersion;
  // Bound the wait for artwork. A slow or failed image never locks the control.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    warmTheme(theme),
    new Promise((resolve) => {
      timeout = setTimeout(resolve, 1200);
    }),
  ]);
  clearTimeout(timeout);
  if (intent !== intentVersion) return;
  const update = () => {
    if (intent !== intentVersion) return;
    document.documentElement.dataset.themePreference = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* The choice still works for this visit. */
    }
    applyTheme(theme);
  };
  transition?.skipTransition();
  if (
    document.startViewTransition &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    transition = document.startViewTransition(update);
    // Skipping a transition is normal, for example when switching tabs.
    void transition.ready.catch(() => {});
    await transition.updateCallbackDone;
  } else update();
}
