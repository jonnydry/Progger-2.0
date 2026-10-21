/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * mid: the plate wraps seed beside swing.
 * phone: the transport stacks and the plate becomes two columns.
 * stacked: each plate setting takes its own row.
 */
export const DECK_BREAKPOINT_PX = {
  mid: 960,
  phone: 640,
  stacked: 420,
} as const;

export const DECK_BREAKPOINT_QUERY = {
  mid: `(max-width: ${DECK_BREAKPOINT_PX.mid}px)`,
  phone: `(max-width: ${DECK_BREAKPOINT_PX.phone}px)`,
  stacked: `(max-width: ${DECK_BREAKPOINT_PX.stacked}px)`,
} as const;
