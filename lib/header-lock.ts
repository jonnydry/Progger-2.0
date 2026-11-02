// The bar and the pond scene are siblings. The scene is pulled up under the
// bar with a negative margin of --site-bar, and the bar is only as tall as
// that same variable. Before the header was pinned, the bar itself was the
// scene: position relative and clamp(210px, 26vw, 360px) tall, with the art
// inside it.
//
// Firefox caches the hashed stylesheet as immutable for a year. When that
// older sheet is the one that wins against this document, the short bar grows
// back into an empty scene-sized band and the art starts underneath it. That
// is the stacked double header. These rules travel with the HTML, which
// revalidates, and they outrank `.night-swim .site-header` even when an older
// sheet is appended later. Practice view sets --site-bar to the same pixels
// as its own bar height, so reading the variable keeps that bar.
//
// `position` stays out of print. The print sheet sets the bar back to static
// at the same specificity a later rule would lose to.
export const headerLockCss = `@media not print {
  html:has(.night-swim) .night-swim > .site-header {
    position: sticky;
    top: 0;
    z-index: 20;
    height: var(--site-bar, 76px);
  }
}
html:has(.night-swim) .night-swim > .header-scene {
  margin-top: calc(-1 * var(--site-bar, 76px));
}`;
