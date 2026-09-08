# Night Swim design QA

final result: passed

## Selected direction and evidence

The user selected option 2, Night Swim. The visual reference is `docs/night-swim/selected-direction.png` (1487 × 1058). The final desktop capture, `docs/night-swim/desktop-final.jpg`, uses the same browser dimensions and A Dorian / starting fret 5 / Notes / right-handed state. Both images were opened together in one comparison input after implementation. Browser captures exclude the scrollbar and proportionally scale the visible content; no pixel-perfect identity is claimed.

The midnight palette, centered mint serif title, spelled note row, sparse neck, upper-right pond, and horizontal control dock follow the selected composition. A new generated raster asset supplies the frog guitarist, moon, reeds, and reflections. Instrument Serif is bundled as WOFF2 through the existing font loader; the browser reports that family and the screenshots visibly use it. Geist remains the musical/UI font, and Silkscreen remains the wordmark.

Intentional adaptations keep the prototype useful: direct root and scale dropdowns replace the mock's pencil action; Scales & modes / Chords remain visible; a real range slider and fret jump replace the illustrative ruler; the keyboard-readable string breakdown remains available. The mock's misleading open-string circles and arbitrary grid boundaries were removed. All musical markers, inlays, and viewport labels come from deterministic data.

## Resolved review findings

- Continuous ruler movement now tracks physical scroll position instead of rounded fret labels. Keyboard arrows move one fret, Page keys five, and Home/End reach both ends.
- Resizing preserves a panned musical range. Returning from a chord restores the previous scale range before considering pattern recentering. Hidden zero-width measurements are ignored.
- Essential fret/string lines meet at least 3:1 contrast against the navy surface. Amber root rings preserve a non-color distinction.
- The entire control dock fits in a 1440 × 828 desktop view (top 700, bottom 796). Short-height styling reduces spacing and string height without shrinking controls.
- Display and starting-fret controls have 44px targets. The 320px dock and its upward-opening Display popup fit within the viewport.
- Long names and roots resize together. F♯ Jazz melodic minor remains complete at 320px.
- Removed 10px of tablet overflow caused by the decorative scene's negative right offset.

Independent musical and product/interface reviewers found no remaining actionable blockers. Their agreement was supplemented by authored musical fixtures, rendered marker checks, a viewport lifecycle harness, and browser interaction checks.

## Verification

- `npm run build`, `npm run typecheck`, `npm run lint`, `npm test`, and `git diff --check` pass. Build retains the existing Vinext route-classification and Node deprecation notices.
- Independent fixture: A Dorian starting at fret 5 has exactly 18 positions; full map has 90. Both orientations retain all 25 fret columns and identical musical positions. E major has six sounding strings / three open indicators; A minor has five / two open indicators / muted low E. Theory code is unchanged.
- Browser: initial desktop range 3–12, mobile range 5–11; selecting start 12 recenters to 10–19 with 18 notes; Degrees changes labels; Full neck shows 0–24 and disables its already-complete range slider.
- Browser keyboard: ArrowRight advances 3–12 to 4–13. Mobile End reaches 18–24. Left-handed Home reaches 18–24 and End reaches 0–6. A manual pan survives handedness switching. Chord Back preserves the prior range and scale.
- Browser journeys: Am D produces three shared collections including A Dorian and A Jazz melodic minor. Show on neck carries chord context, Am shape shows the correct five positions, and Back restores the context plus focus on the initiating action. Custom root selectors and builder alignment work in the new styling.
- Responsive visual checks at 320, 390, 501, 800, 1440, and 1487px. Final DOM overflow checks at 320/501/800 report equal document client and scroll widths. Evidence includes `desktop-828.jpg`, `mobile.jpg`, `mobile-dock.jpg`, `320-dock.jpg`, `match-mobile.jpg`, and `chord-mobile.jpg` in `docs/night-swim/`.

- The restarted final preview rendered the selected default; final browser console error check returned no errors. Temporary viewport overrides were reset.

## Limits and handoff

This is a local redesign of the working reference tool, not a new AI feature or a deployment. Physical-device tests, screen-reader listening, 200% browser zoom, and measured mobile performance remain unverified in this pass. On narrow screens the neck intentionally scrolls horizontally; frets 0–24 remain accessible.

Earlier Quiet Cabinet QA and follow-up history are preserved in `docs/redesign/qa-history.md`.
