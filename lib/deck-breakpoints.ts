/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * The deck is one cassette bay at every width: the window on top, the
 * transport keys under it, then the Build and Feel? folds.
 *
 * plate: above this the pins sit in two columns. Below it each pin row
 *   fills the full width.
 * wide: below this the six transport keys stop sharing one row. Play and
 *   New phrase take the first row under the window and the quiet keys
 *   (history, loop, save) the second.
 * phone: the history keys show only their transport glyphs so loop and
 *   save still fit on the quiet row, and Half speed leaves the tempo line
 *   for its own row under the slider. The panel also reads this width to
 *   hold off seed autofocus, so no keyboard opens over the deck.
 * pins: a four-option pin row becomes an even 2x2 block. Four across clips
 *   "long–short" below this, and a plain wrap leaves a lone orphan.
 * narrow: "Save to stash" no longer fits beside history and loop, so it
 *   takes its own full line under them.
 */
export const DECK_BREAKPOINT_PX = {
  wide: 860,
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
