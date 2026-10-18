// A deploy replaces hashed chunks. A page that still has the previous
// script asks for a phrase-panel file the new deployment does not have.
// Vite reports that failed dynamic import as `vite:preloadError`. Reload
// once: the document is served `max-age=0, must-revalidate`, so the next
// HTML points at the new chunk. A missing `/_next/static` file is cached
// as immutable, so retrying the same URL cannot succeed. A second failure
// inside the gap is left alone so a real error cannot reload forever.
export const CHUNK_RELOAD_KEY = 'progger-chunk-reload';
export const CHUNK_RELOAD_GAP_MS = 10_000;

export const chunkReloadBootstrap = `(() => {
  const key = ${JSON.stringify(CHUNK_RELOAD_KEY)};
  const gap = ${CHUNK_RELOAD_GAP_MS};
  addEventListener('vite:preloadError', (event) => {
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(key) || 0);
    } catch {
      return;
    }
    if (Number.isFinite(last) && Date.now() - last < gap) return;
    try {
      sessionStorage.setItem(key, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    location.reload();
  });
})();`;
