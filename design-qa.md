# Golden-hour theme — design QA

final result: passed

## Follow-up: continuous daytime water (2026-09-08)

User review supersedes the earlier cream-water treatment: use night mode's seamless pond-to-underwater continuity as the visual direction. New source asset: `public/progger-day-water-v2.png`; generated with the built-in image tool using the approved day hero and night underwater references. Prompt/provenance: `docs/day-theme/water-v2-asset-notes.md`.

- [P2, resolved] Cream seam and disconnected side reeds in the daytime reference. Replaced the continuation with jade water and amber shafts, increased overlap to112px (76px phone), anchored image at center top for all reference sections, and shortened the top mask ramp to60px. The new quiet center is visible at0.76 opacity (0.7 phone). Secondary copy was darkened locally for contrast.
- Before/after: `docs/day-theme/continuity-comparison.jpg`, left previous/right revised, matching1193×828 CSS viewport; provider captures1178×818px with equal density. Both captures inspected together. This comparison targets the requested blend, not replication of the earlier rejected cream area.
- Mobile evidence: `continuity-mobile.jpg` at390×844 CSS; expanded Match controls: `continuity-match-mobile.jpg`. Explore, chord reference, and Match all inspected. No document overflow; underwater styling stops before the neck. Main header artwork and musical functions unchanged.
- Independent review found no material remaining desktop continuity or readability issue. Root notes, degrees, tabs, and captions remain distinct. Parent verified mobile Chords and Match with both disclosures expanded. Browser error log empty.
- Scope is artwork/CSS plus preload URL; no new musical behavior or regression tests introduced. Existing checks rerun as appropriate.

## Visual truth and evidence

- Selected direction: `docs/day-theme/selected-direction.png` (option 2), 1487 × 1058 pixels.
- Implemented page: http://localhost:3000/#explore, A Dorian, full neck, day theme.
- Desktop capture: `docs/day-theme/desktop.jpg`. CSS viewport 1487 × 1058; browser screenshot output 1472 × 1047. The provider slightly scales screenshot output. The source was normalized to 1472 × 1047 for comparison; no app geometry was altered for normalization.
- Combined comparison: `docs/day-theme/comparison.jpg`, source left and implementation right. Both were opened together before accepting the result.
- Supporting captures: `mobile.jpg` (320px CSS viewport), `medium.jpg` (641px), `mobile-fret24.jpg`, `night.jpg`, `chord.jpg`, `match-error.jpg` in the same directory.
- Focused review used full-resolution source/art and individual screenshots of chord menus, error/builder controls, the mobile header, and end-of-neck navigation. These readable individual views supplement the combined full-page comparison.

## Findings and iteration history

1. [P2, resolved] Initial cover crop cut the guitar headstock at wide desktop sizes. Increased the shared day/night header height, capped at 430px, and moved the day crop toward the top. Desktop evidence now contains the full pose/headstock. Shared dimensions keep musical controls stationary during theme changes.
2. [P2, resolved] Inherited night fade dissolved Proggy’s planted foot and pad too early. Day artwork now remains opaque through 78%, with the last portion fading into the underwater scene. The revised combined comparison shows an anchored pose and a soft water edge.
3. [P2, resolved] Artwork could sit behind the theme switch and reduce its contrast (especially the night moon). Added a nearly opaque themed control background; medium widths place the scene below navigation. Keyboard focus remains visibly outlined.
4. [P2, resolved] Native disabling during asynchronous image loading could lose focus. The switch uses aria-disabled and a guarded handler. Space activation was checked in-browser; focus remains on Day theme.
5. [P2, resolved] A pond-only view-transition snapshot could cover live navigation. The entire header transitions as one layer, while musical controls remain outside the snapshot.

No actionable P0/P1/P2 findings remain in the verified scope.

## Required fidelity surfaces

- **Typography:** retains the established Silkscreen display face for PROGGER/key/mode and Maple Mono for interface text. Real glyphs, accidental spelling, font weights, control labels, and phone wrapping are preserved. The mock’s enlarged masthead is intentionally not substituted for the established navigation scale.
- **Layout:** centered reference selectors, open spacing, low visual density, and the full-width pond follow the selected composition. Existing fretboard row height, controls below the neck, clickable fret navigation, and voicing interfaces remain functional; the mock’s inaccurate note positions and decorative control layout are not recreated. Those intentional utility constraints account for the taller live neck and lower controls.
- **Colors:** warm cream/apricot atmosphere, dark pine ink, emerald notes, dark amber roots. Root double rings and chord-target distinctions remain distinct. Flat-surface contrast review found primary ink 12.15:1, emerald 6.58:1, amber 5.81:1, quiet text 5.87:1 against cream. Rendered small labels sit on calm backgrounds.
- **Images:** actual generated raster assets, lossless WebP delivery, playful right-side Proggy with bassist/drummer behind, and quiet underwater continuation. Responsive 320px crop prioritizes Proggy; the full band is visible on wider screens. The source and actual artwork have intentional generative detail differences, but maintain pose, palette, scale hierarchy, and mood.
- **Copy:** existing product copy preserved. No design-prompt language or fabricated musical information enters the app.

## Behavior and verification

- Desktop and 320px phone visual checks; measured 501/640/641px navigation clearance without horizontal document overflow.
- Day/night Space activation retains keyboard focus and A Dorian selection. Day preference survives reload.
- Chord quality menu, C/E first-inversion filter, Match parsing error, chord-builder alignment, and restored Am F C G progression checked.
- Mobile Jump to fret 24 reaches frets 19–24; open-string navigation remains available.
- Browser error log empty during the verified flows.
- Production build, typecheck, lint, and complete test suite pass. Four focused theme tests cover prepaint preference, blocked storage/artwork, cross-tab/system behavior, and reduced-motion bypass with the transition API present.
- Independent reviewers checked interface contrast/behavior, transition layering/focus, and musical preservation. Music/harmony sources and existing theory tests match pre-theme hashes.

## Remaining limits / follow-up polish

- The 400ms header crossfade uses native View Transitions. Unsupported browsers and reduced-motion users receive an immediate change. No water-ripple animation is implemented.
- Reduced-motion and system/cross-tab behavior are verified with deterministic browser-environment tests, not physical-device settings. No real-device Safari pass was performed.
- Default follows the device until a manual choice is saved. No in-app reset-to-system control in this slice.
- P3: a dedicated narrow-screen artwork could include more of the background band without shrinking Proggy.

## Implementation checklist

- [x] Selected direction implemented across Explore, Chords, and Match.
- [x] Palette and artwork switch together; preference persists.
- [x] Actionable adversarial findings resolved.
- [x] Source/implementation comparison repeated after visual fixes.
- [x] Build and behavioral verification complete.
- [x] Local preview retained; no deployment or GitHub push performed.
