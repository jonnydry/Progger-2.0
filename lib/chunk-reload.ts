// A deploy replaces hashed chunks. A page that still has the previous
// script asks for a phrase-panel file the new deployment does not have.
// Vite reports that failed dynamic import as `vite:preloadError`. Reload
// once: the document is served `max-age=0, must-revalidate`, so the next
// HTML points at the new chunk. A missing `/_next/static` file is cached
// as immutable, so retrying the same URL cannot succeed. Leave the event
// alone so Vite still rejects the import. Canceling it fulfills the
// preload, and the panel would stay on "Loading phrases…". A later failure
// in this tab is the panel's own message, which stops a reload loop when
// the reloaded document is still stale.
export const CHUNK_RELOAD_KEY = 'progger-chunk-reload';

export const chunkReloadBootstrap = `(() => {
  const key = ${JSON.stringify(CHUNK_RELOAD_KEY)};
  addEventListener('vite:preloadError', () => {
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      return;
    }
    location.reload();
  });
})();`;
