# Connected neck — 1 October 2026

The neck is a continuous 0–24 fret surface. Selecting a form adds a connected-form layer: all scale notes remain visible, the active form is emphasized, one optional neighboring form uses a dashed outline, and positions shared by the two have an underline. Shared means the same string and fret, not merely the same pitch class. Roots retain their distinct ring and theme colors.

## Interaction

- Drag the neck, use its position slider, arrow/page/home/end keys, span arrows, or Jump to fret. All move the same viewport and advance the active form without snapping the viewport back.
- The active-form selector names its starting fret and note on low E. The caption separately states its full fret span; these differ for some pentatonic forms.
- Compare the lower or higher complete neighboring form, or turn overlap off. Only one neighbor is shown at a time so shared positions remain useful. Each individual form has three notes per string for supported seven-note scales, or two for pentatonic scales; the combined display can show more.
- Close, Balanced, and Wide adjust the visible span. All notes and Connected forms switch the emphasis in place. Resizing and handedness changes preserve musical progress.
- The optional whole-neck map shows the same active, neighbor, shared, and context layers. Dragging its viewport band preserves the grab offset; clicking outside it seeks to that part of the neck. It also supports keyboard navigation.
- The fret-number ruler is a ruler, replacing the former second set of pattern-selecting buttons. Scale families without generated forms retain the all-note map, width controls, and overview.
- The expanded text reference lists active notes and exact shared/neighbor string positions. Range sliders expose the visible fret span without announcing every scroll update in a live region.

## Position model

The pattern generator and spelling engine are unchanged. `lib/connected-neck.ts` provides deterministic display coordination. Available scroll travel maps to the centers of the first through last complete form, with a small hysteresis interval at boundaries. This lets Wide view reach every form even though its physical viewport cannot center an open-string or final form. Explicit form selection uses the inverse mapping. Automatic following updates emphasis only; it never scrolls back to the newly active form.

Close view can show only part of a wide form, particularly on a phone. Panning keeps every note accessible, and the optional overview supplies the whole-neck context. The display is not a claim about finger assignments or ease of playing a stretch.

## Verification

- Unit fixtures independently specify A Dorian low-E starts 5/7 with 18 notes per form and 12 shared positions; A minor pentatonic start 3 spans frets 2–5 and shares six positions with start 5.
- Actual viewport travel is exercised across phone, Balanced, Wide, Close, and mirrored cases; every complete Dorian form is visited in order, and a one-pixel movement after selecting a form keeps it selected.
- Independent adversarial music review additionally traversed 2,346 combinations of root, supported scale, width, and handedness. Independent interface review found and prompted fixes for boundary reachability, returning from All notes, same-cell-width resizing, overview grab offsets, root contrast, and text equivalents.
- Browser checks: a 340px neck drag moves exactly 340px while advancing the form; slider Home/End reaches open and final forms at Balanced/Wide widths; All notes → pan → Connected forms preserves the viewport; mirrored navigation reaches both ends; overlap text matches the exact string/fret intersection.
- A 320px phone layout has no document overflow and reaches frets 0–24. Resizing from 320 to 448 while cells stay 48px preserves the active form; subsequent movement does not jump to a stale form. Phone-to-desktop and desktop-to-phone resizing also preserve progress, ignoring the browser's temporary clamping against the old grid. A subsequent 340px drag was verified to move exactly 340px. Overview band dragging moves proportionally with no initial recentering.
- Pentatonic view shows 12 active positions and six shared positions. Whole tone has no form picker. Chord voicing navigation remains selective and returning to scales restores the viewport. Day-theme root foreground/background contrast was inspected in the browser.
- All 94 tests, `npm run typecheck`, `npm run lint`, production build, and `git diff --check` pass.

Physical-device touch gestures and screen-reader listening remain unverified. Touch panning uses native horizontal scrolling; the keyboard controls and text equivalents were inspected through the browser.
