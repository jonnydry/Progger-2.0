/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * At every width the keys come in two rows (Play and New phrase, then
 * history, Loop and Save) and the tape window follows them, so nothing the
 * window says can move a key.
 *
 * plate: above this the pins sit in two columns; below it each pin row
 *   fills the full width.
 * wide: above this the tape window sits beside a fixed-width key cluster,
 *   top-aligned. Below it a window beside the cluster is too narrow for its
 *   two plan lines, so it drops under the keys.
 * phone: Previous and Next become icon keys so the quiet row stays one
 *   line, the fold summaries drop the Edit word, and Half speed leaves the
 *   tempo line for its own row under the slider so the fader keeps a usable
 *   length. The panel also reads this width to hold off seed autofocus, so
 *   no keyboard opens over the deck.
 * pins: a four-option pin row becomes an even 2x2 block. Four across clips
 *   "long–short" below this, and a plain wrap leaves a lone orphan.
 * narrow: two icon keys, Loop and "Save to stash" no longer fit one line,
 *   so Save takes the quiet row's second line at full width.
 */
export const DECK_BREAKPOINT_PX = {
  wide: 940,
  plate: 1210,
  phone: 640,
  pins: 470,
  narrow: 380,
} as const;

export const DECK_BREAKPOINT_QUERY = {
  wide: `(max-width: ${DECK_BREAKPOINT_PX.wide}px)`,
  plate: `(max-width: ${DECK_BREAKPOINT_PX.plate}px)`,
  phone: `(max-width: ${DECK_BREAKPOINT_PX.phone}px)`,
  pins: `(max-width: ${DECK_BREAKPOINT_PX.pins}px)`,
  narrow: `(max-width: ${DECK_BREAKPOINT_PX.narrow}px)`,
} as const;
