# UI/UX audit follow-up

Implemented September 10, 2026. Addresses the seven approved improvements in the preceding audit. Existing scene-art revisions are preserved. No commit, push, or deployment was performed in this pass.

## Completed

| Improvement | Result and verification |
| --- | --- |
| Keep scale selection when returning from Chords | Selectors now get distinct option registries when their domain changes. Ordinary UI: G♭ harmonic minor → Chords → Scales retained G♭ harmonic minor and its fret-5 pattern. B♭♭ Major → root C retained C Major and returned keyboard focus to Root note. |
| Preserve progression context | Comparing Am–D with jazz melodic minor retains both chord buttons and Back to your chords. A local D Major choice retains Am–D, starts with D selected, and reports C outside the palette when Am is highlighted. Explicit Clear context still works. Scale changes choose the nearest valid pattern start. |
| Repair voicing rows | An intrinsic grid inside the fieldset sizes rows to their complete content. All 61 C13 rows had zero child overflow at desktop, 390px, and 320px. Sample row heights increased to 91.5px desktop and 86.5px mobile. |
| Compact Practice view | Optional toggle removes the large scene, reduces reference spacing, and places view/label controls before the neck. Chord browsing follows the neck in Practice view. Musical choices and browsing filters survive layout switches. Full scenery remains the default. |
| Navigate voicings by position and strings | Near fret orders all available shapes by proximity, covering 0–24; Show nearest selects explicitly. Exact sounding-string sets combine with bass filtering. C13 near 24 selected a shape at frets 21–24. Cmaj13 root bass plus G–B–e produced an honest empty state and working Reset browsing. |
| Explain scale differences | Matching cards separate chord tones from optional melody notes and compare to a named first-result reference. Am–D shows G → G♯ for jazz melodic minor and B → B♭ for Dorian ♭2. No key certainty or consonance ranking is inferred. |
| Search long musical menus | Explore and the chord builder search names, supported aliases, and quality symbols. Aeolian selected Natural minor with keyboard focus returning to the selector. C13 found Dominant 13; m7b5 found Half-diminished and added Dm7b5 in the builder. Empty results, Escape, and route popup cleanup worked. |

The full extended-chord formula also now labels each note **played** or **omitted** for the selected grip. C13's first grip showed C, E, B♭, A played and G, D, F omitted. The full formula remains available when viewing all chord tones. Omission styling uses text and a dashed underline, not color alone.

## Independent review and checks

Three agents implemented bounded pieces and challenged each other's musical and interface assumptions. Review resolved filter resets on Practice toggles, touch keyboard autofocus, same-value focus restoration, stale Base UI popup cleanup overriding focus, and blank live-region padding. An independent musical review checked 134 exact candidates and two authored MIDI grips; no remaining material musical defect was found in the additions.

- `npm test`: all 11 test files passed, including new search, comparison, position, and voicing navigation fixtures.
- `npm run typecheck`, `npm run lint`, and `git diff --check`: passed.
- `npm run build:vercel`: static homepage and hydration payload verified after the final selector changes.
- Browser journeys ran in local Chromium at 1193/980px desktop and 390/320px mobile widths. Mobile fret navigation reached frets 18–24. No horizontal page overflow appeared in the tested layouts.
- Pond night and Twilight day received visual checks; new styles use the existing theme variables. The preview was restored to Pond night with the normal scene and A Dorian at fret 5.
- Transient missing-import errors during parallel file creation were cleared by restarting the dev server. No later browser errors appeared during the completed verification journeys.

Local screenshots are under `outputs/ux-improvements-2026-09-10/` (ignored generated artifacts). The desktop override exceeded the physical browser capture width, so its screenshot is cropped; full desktop width was checked with DOM geometry. Mobile captures show complete viewport content.

## Remaining limits

Sharing/restoring musical choices through URLs was the audit's later item and remains future work. Practice and voicing-browse settings currently last for the mounted session. This pass did not perform a complete accessibility conformance audit, physical touch/screen-reader testing, cross-browser testing, or new audio-quality evaluation. At narrow widths, the 24-fret instrument still uses intentional horizontal navigation and some vertical scrolling.
