/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * mid: seed sits beside swing, under bars and tempo.
 * phone: the transport stacks, and every plate setting takes its own row.
 * stacked: Half speed takes the full width under the tempo slider.
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
