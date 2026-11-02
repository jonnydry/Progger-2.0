/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * plate: above this the transport is one strip and the pins sit in two
 *   columns. Below it Play and New phrase take a row of their own, the
 *   quiet keys follow four across, and each pin row fills the full width.
 * wide: the quiet keys drop from four across to two rows of two, because
 *   four across would squeeze "Save to stash".
 * phone: Half speed leaves the tempo line for its own row under the
 *   slider, so the fader keeps a usable length. The panel also reads
 *   this width to hold off seed autofocus, so no keyboard opens over
 *   the deck.
 * pins: a four-option pin row becomes an even 2x2 block. Four across clips
 *   "long–short" below this, and a plain wrap leaves a lone orphan.
 */
export const DECK_BREAKPOINT_PX = {
  wide: 860,
  plate: 1210,
  phone: 640,
  pins: 470,
} as const;

export const DECK_BREAKPOINT_QUERY = {
  wide: `(max-width: ${DECK_BREAKPOINT_PX.wide}px)`,
  plate: `(max-width: ${DECK_BREAKPOINT_PX.plate}px)`,
  phone: `(max-width: ${DECK_BREAKPOINT_PX.phone}px)`,
  pins: `(max-width: ${DECK_BREAKPOINT_PX.pins}px)`,
} as const;
