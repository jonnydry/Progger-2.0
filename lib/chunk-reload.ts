// A deploy replaces hashed chunks. A page that still has the previous
// script asks for a phrase-panel file the new deployment does not have.
// Vite reports that failed dynamic import as `vite:preloadError`. Reload
// once for this document's index chunk: the HTML is
// `max-age=0, must-revalidate`, so the next document points at the new
// chunk. The same index address means the reload is still the stale
// deploy, so do not reload again. A different index address is a new
// deploy, including in a duplicated tab, and may reload once. Leave the
// event alone so Vite still rejects the import. Canceling it fulfills
// the preload, and the panel would stay on "Loading phrases…". An
// offline failure is the same event; reloading then replaces the page
// with the browser's offline error. A stale CDN or a permanently missing
// chunk leaves the tab showing the error until the user reloads by hand.
// That is the trade-off for staying loop-safe.
export const CHUNK_RELOAD_KEY = 'progger-chunk-reload';

export const chunkReloadBootstrap = `(() => {
  const key = ${JSON.stringify(CHUNK_RELOAD_KEY)};
  const currentDeploy = () => {
    const link = document.querySelector(
      'link[rel="modulepreload"][href*="/chunks/index-"]',
    );
    if (link) return link.href;
    const script = document.querySelector('script[src*="/chunks/index-"]');
    return script ? script.src : '';
  };
  addEventListener('vite:preloadError', () => {
    if (navigator.onLine === false) return;
    const deploy = currentDeploy();
    if (!deploy) return;
    try {
      if (sessionStorage.getItem(key) === deploy) return;
      sessionStorage.setItem(key, deploy);
    } catch {
      return;
    }
    location.reload();
  });
})();`;
