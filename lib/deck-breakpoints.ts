/**
 * Cassette deck widths. `app/phrase-deck.css` repeats these pixels because
 * stylesheets cannot import TypeScript; `tests/phrase-deck-breakpoints.test.ts`
 * reads the stylesheet and fails if the two copies drift.
 *
 * wide: Play and New phrase sit beside the quiet transport pad. Below this
 *   they stack, because the pad would otherwise squeeze "Save to stash".
 * plate: Bars, Tempo, Swing, and Seed pair into two lines, and the Build pins
 *   drop to one column. Half speed stays inside the Tempo cell, so it cannot
 *   land on a line below Swing.
 * phone: each of those tempo controls takes its own row. Half speed keeps the
 *   ½ mark so the slider still has room.
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
