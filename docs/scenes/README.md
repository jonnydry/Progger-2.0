# Progger scenes

Implemented 2026-09-09. Scenes describe where Proggy plays; day/night describes
the lighting. These are independent preferences, not musical modes.

## Interaction

- The compact text-only scene picker sits beside the existing sun/moon control.
- The Pond, Tidepool, and Twilight each provide light and dark treatments.
- Choosing a scene preserves the mode, musical input, reference selection,
  voicing, neck position, and expanded controls. No reload or Apply action.
- Existing `progger.theme.v1` storage remains compatible; new
  `progger.scene.v1` defaults to `pond`. Bootstrap restores both before paint.
- With no explicit day/night preference, system light/dark changes still work.
- Storage failures retain a working visit-only preference. Cross-tab updates
  and storage clears reconcile the two independent choices.

## Implementation

`lib/theme.ts` owns the small scene manifest, validation, bootstrap, shared
subscription lifecycle, and bounded image prewarming. Pending changes compose
across both controls, with newer intentions superseding older work.

`components/scene-picker.tsx` uses the existing Base UI Select for arrow-key
navigation, Home/End, selection, Escape dismissal, and focus return. The trigger
shows the scene name on desktop and a visible “Scene” label on small screens.
The picker has no thumbnails; artwork warms on option hover/focus or selection.

`scene-palettes.css` defines musical color roles across the new palettes. Roots
retain an extra ring, chord targets retain a distinct outer ring, and omissions
and validation feedback retain their own emphasis. The original Pond palette,
typography, layout, and musical engine are preserved.

`PondScene` listens to a before-change event and briefly fades a local previous
artwork layer. It copies the prior computed image geometry, clears after 400ms
(500ms safety timeout), handles rapid changes and unmounts, and skips/clears the
layer for reduced motion. Browser View Transition snapshots were removed because
they either intercepted fast header interactions or covered live navigation.

Header artwork keeps its intrinsic proportions inside a shared, centered frame
capped at 1280px. Tidepool and Twilight scale by width with automatic height;
small screens use a minimum 460px illustration width and a Proggy-focused crop.
Wider screens feather the frame edges into the palette instead of enlarging the
band indefinitely. The shared frame also keeps scene dissolves from rescaling.

The background beneath references and chord entry uses only a quiet water tail
at its natural aspect ratio, with a bounded height and no repeating tiles.
Long chord-entry forms therefore fade into the page instead of stretching art.
Water layers cap at 1600px and feather horizontally on larger screens.

## Art direction and delivery

Four images were generated with the original Proggy artwork as the character
and pixel-style reference. Each night image was derived from its matching day
scene to preserve the band's positions. Each is 1774 × 887 pixels, delivered as
quality-86 WebP; original generation files remain in the generation archive.

| Scene    | Light direction                                                    | Dark direction                                    | Files                                      |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------- | ------------------------------------------ |
| Tidepool | Sea-glass water, pale sand, coral accents; band on shoreline rocks | Deep blue, lavender moon, teal plankton           | `public/progger-tidepool-{day,night}.webp` |
| Twilight | Rose water, pale lilac, plum reeds, pink lilies                    | Aubergine, violet water, glowing pink reflections | `public/progger-twilight-{day,night}.webp` |

Composition brief: recognizable green Proggy, red bandana and cream/orange
flying-V guitar at right; smaller bassist and drummer at left; authentic pixel
clusters with restrained CRT-style light blending; quiet navigation area and
lower water tail; no text or UI baked into the artwork.

## Verification

Final result: passed for this scene feature.

- `npm test`: music, scale coverage, and theme suites pass. Theme fixtures cover
  22 cases including bootstrap, failed storage, cross-tab updates/clear, system
  changes during a pending scene, rapid independent changes, before-change event
  ordering, relevant image requests, and slow-image timeout.
- `npm run typecheck`, `npm run lint`, production build, and `git diff --check`
  pass.
- In-app browser inspected all six visual combinations. Final desktop matrix
  retained A Dorian, selected pattern fret 5, and a 430px header in every look.
- Checked 320, 390, 640, 900, 901, 1024, and 1440px widths. No page overflow or
  header-control collision. The 320px scene popup stayed within the viewport.
- Keyboard selection and Escape returned focus. Expanded chord tools retained
  `Am F C G` across scenes/modes; invalid input feedback used the scene error
  color and recovered after correction.
- C13 preserved its full formula separately from played C/B-flat/E/A and
  explicit G/D/F omissions. Mobile navigation reached frets 19–24 at 320px.
- Computed active-fret/notes contrast was checked after a specificity fix;
  Tidepool light note labels measured 5.82:1 and roots 5.80:1. Independent token
  calculations checked text and control boundaries in the four new palettes.
- Independent subagents challenged persistence, interface behavior, musical
  color semantics, image loading, and animation cleanup. Findings about early
  thumbnail loading, art tiling/stretching, header movement, active-fret color,
  and transition layering were resolved and rechecked.

Limits: palette ratios do not prove contrast against every illustration pixel;
composited backgrounds were visually inspected in the in-app Chromium browser.
No physical-device or separate Safari/Firefox pass was performed. Artwork is
static; only scene changes animate. No musical logic was modified.

### Proportional artwork follow-up

- Removed independent width/height stretching from Tidepool and Twilight.
- Browser checked framing at 320, 390, 500, 501, 900, 901, 1193, 1440,
  1920, and 2560px; no page overflow. Visually inspected Twilight night,
  Tidepool day, and Pond day at representative small/boundary/wide widths.
- Independent CSS review caught and resolved inconsistent frame caps during
  dissolves and missing horizontal water feathering. Existing mobile Pond and
  newer-scene frame offsets differ, so their mobile dissolve may shift slightly.
