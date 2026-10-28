/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * plate: the four settings pair up and the Build pins drop to one column.
 * phone: the transport stacks, and every plate setting takes its own row.
 * pins: a four-option pin row becomes a 2x2 block; one line would clip
 *   "long–short" beside its legend.
 */
export const DECK_BREAKPOINT_PX = {
  plate: 1080,
  phone: 640,
  pins: 480,
} as const;

export const DECK_BREAKPOINT_QUERY = {
  plate: `(max-width: ${DECK_BREAKPOINT_PX.plate}px)`,
  phone: `(max-width: ${DECK_BREAKPOINT_PX.phone}px)`,
  pins: `(max-width: ${DECK_BREAKPOINT_PX.pins}px)`,
} as const;
