/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * wide: the transport keys stack their icon over their label. The six keys
 *   share one line above and below this band, but inside it the shorter keys
 *   would keep icon and label inline while "New phrase" and "Save to stash"
 *   wrapped, so the row came out ragged at different heights.
 * plate: the four settings pair up and the Build pins drop to one column.
 * phone: the transport folds to 3x2 and every plate setting takes its own row.
 * pins: a four-option pin row becomes an even 2x2 block. Four across clips
 *   "long–short" below this, and a plain wrap leaves a lone orphan.
 */
export const DECK_BREAKPOINT_PX = {
  wide: 860,
  plate: 1080,
  phone: 640,
  pins: 470,
} as const;

export const DECK_BREAKPOINT_QUERY = {
  wide: `(max-width: ${DECK_BREAKPOINT_PX.wide}px)`,
  plate: `(max-width: ${DECK_BREAKPOINT_PX.plate}px)`,
  phone: `(max-width: ${DECK_BREAKPOINT_PX.phone}px)`,
  pins: `(max-width: ${DECK_BREAKPOINT_PX.pins}px)`,
} as const;
