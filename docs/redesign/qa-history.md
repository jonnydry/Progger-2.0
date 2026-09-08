# Quiet Cabinet redesign QA

final result: passed

## Evidence and scope

Source visual truth: `docs/redesign/selected-direction.png`, the first displayed concept selected by the user. Source is 1487 × 1058 pixels. Implementation: local `http://localhost:3000`, C Major, full neck, Notes, right-handed, theory collapsed. Desktop browser CSS viewport was 1487 × 1058; captured content image `docs/redesign/desktop-final.jpg` is 1472 × 1047 because the browser capture excludes its scrollbar and scales the visible content. Comparison uses the same composition and proportional coordinates; there is no density doubling or artificial image stretching. No pixel-perfect identity claim is made.

The source and desktop capture were opened together in a single comparison tool response by the implementation owner and independently by the design reviewer. Final desktop capture visually agrees with the earlier `desktop.jpg` comparison after the responsive fixes. Header, title/selection, note strip, controls, neck, and disclosure details are readable at full image size; no separate cropped comparison was needed.

Additional evidence: `mobile-before.jpg` (305 × 660 captured content), `mobile.jpg` (305 × 804) at 320px CSS width, `match.jpg` (785 × 981) at 800 × 1000 CSS viewport, and `match-mobile.jpg` (415 × 869) at 430 × 900. Browser capture scaling varied during resizing; DOM widths and settled captures were used together. Intermediate stale resize frames were excluded from acceptance evidence.

## Findings and iteration history

- Resolved P2: Jazz melodic minor truncated at 320px. The first phone capture showed only part of the selected scale name. Responsive long-name typography was adjusted; the post-fix capture shows the complete F♯ Jazz melodic minor selection. Note dots remain 14px and fret cells remain at least 46px wide.
- Resolved P2: tablet Display disclosure lost its accessible name when the visible label was hidden. Added explicit `aria-label="Display"`; the 650px browser accessibility tree confirms the name remains available.
- No remaining actionable P0/P1/P2 visual or behavior findings from independent design and musical reviews.

## Required fidelity surfaces

- **Typography:** Geist stays legible for musical/UI content; [Silkscreen](https://github.com/googlefonts/silkscreen) supplies the pixel wordmark. The main editable title is 64px on wide desktop, deliberately smaller than the generated mock to allow long real scale names. Body/reference data use readable product sizes; compact metadata is secondary. Smallest-screen long names reduce to 18px; no truncation in the tested F♯ case.
- **Layout:** one continuous workspace, no enclosing app card or theory-card grid. Root and scale selection double as the visible title. Notes/degrees form a plain aligned row. Hairlines establish major boundaries. The neck remains dominant, with controls and 0–24 navigation adjacent. Match uses a broad entry followed by a single ranked result list.
- **Colors:** warm charcoal base, ivory type, olive note surface, lime selection accents, amber roots. Root rings and explicit legends retain a non-color signal. Avoided the generated mock's texture and glow on musical data.
- **Images/icons:** reused the original transparent pixel frog at a compact masthead size. No new fabricated illustration or decorative placeholder. The textual brand uses an actual pixel font. Existing [Lucide](https://lucide.dev/) chevrons/sliders/arrows fit the reference's simple UI strokes. The unexplained mock corner icon was intentionally omitted.
- **Copy/content:** removed repetitive headings, marketing eyebrows, formula repetition, and competing advice cards. Retained spelled notes, degrees, root identity, real pattern labels, and optional teaching content. Generated mock fret coordinates and 3/4/5 notes-per-string controls were replaced by the existing deterministic engine and real Full neck/3NPS/2NPS choices. Chord-reference legend now says Chord note. Slash bass is explicitly identified, included in outside-palette notices, and not implied to appear in a base-chord voicing drilldown.

## Verification

- Production build, TypeScript, lint, and all six authored musical test groups pass. Theory engine unchanged.
- Independent reviewer checked spelling, exact 3NPS fixtures, harmonic-minor triads, ambiguous matching, blues exceptions, and slash bass coverage.
- Browser: F♯ spelling; complete Jazz melodic minor title at 320px; no page overflow at 320/390/430/800 CSS widths; 0 and 24 accessible at 320px in both orientations; C Major 3NPS starting fret 8 shows exactly 18 notes and range 8–13; blues selection resets to Full neck.
- Matching: Am–D offers A Dorian and A Jazz melodic minor among its collections; malformed Cwat suppresses stale result cards; A7–D7–E7 shows no exact shared collection with per-chord details open and separate blues guidance; A minor blues exposes outside C♯; chord drilldown shows A C♯ E G and Chord note legend; back navigation retains A7 D7 E7.
- Final browser console error check returned no errors. Preview was restarted after build, and the final local tab was verified to render the redesigned screen.
- Manual keyboard/screen-reader listening, 200% browser zoom, physical-device tests, and measured mobile performance were not completed in this design pass. Earlier release limitations still apply; no claim of full accessibility certification.

## Implementation checklist

- [x] Apply selected visual hierarchy to existing Explore and Match workflows.
- [x] Preserve deterministic music and real guitar navigation.
- [x] Resolve adversarial review findings and verify regressions.
- [x] Compare desktop target and phone layouts; save evidence.
- [x] Build and leave a working local preview for review.
- [ ] Update the private hosted site when publishing is requested.

## Follow-up polish

Optional: further musician feedback on contrast/spacing while practicing, plus physical-phone and screen-reader sessions. These are follow-up validation gaps rather than known release blockers.

## Dropdown and alignment polish — 2026-09-06

- Replaced visible native selectors with a shared Base UI select, styled in the existing olive palette. Preserved option labels, grouped scale families, selected checks, keyboard navigation, and focus return.
- Builder Root, Quality, and Add chord have matching 44px heights and aligned bottom edges. At narrower widths, the action moves below Quality. Verified 1101px, 1100px, and 320px widths without page overflow.
- Browser checks: Home A → Not sure yet clears the optional home; Escape returns focus; Arrow Down + Enter changes Minor to Dominant 7 and adding yields D7; F♯ minor yields F#m; long Jazz melodic minor remains within a 320px viewport; fret jumps 24 → Open → 24 show ranges 19–24 → 0–5 → 19–24.
- Independent music review checked all 323 builder root/quality combinations, spelling, optional home behavior, and six existing test groups. Independent interface review inspected source and desktop/mobile screenshots; no blocking findings remained.
- Typecheck, lint, and production build pass. Final browser error log was empty. Physical touch and screen-reader audio remain untested.
- Evidence: `docs/redesign/progger-dropdown-desktop.jpg`, `docs/redesign/progger-dropdown-mobile.jpg`, and `docs/redesign/progger-explore-mobile.jpg`.

## Chord shapes on the main neck — 2026-09-06

- Removed the separate mini-diagram gallery from the active UI. Chord mode defaults to one selected fingering on the main 24-fret neck; shape buttons include their starting fret, and All chord tones remains available.
- Only the selected string/fret pairs render. Muted and open strings have persistent side indicators and an equivalent per-string text description. Notes/degrees and left-handed views retain the same musical indexing.
- Added Back to the named scale. Drilldowns preserve scale root, family, pattern, pattern index, progression context, active landing chord, source focus, page scroll, and full-neck fret region.
- Browser fixtures: C major x35553 = five dots; E major 022100 = six dots including three open strings in left-handed degree view. C major shape at fret 15 automatically reveals frets 14–18 at 320px; Back restores prior scale frets 12–17 and original focus. C major 3NPS starting fret 8 restores its 18 notes and range 8–13 with theory disclosure open. Am–D → A Dorian → D shape → Back retains the progression and active D landing chord.
- Independent musical review passed five authored fingering fixtures (including E5 mute handling, F♯ major, and Cdim7 B𝄫) and the six existing theory groups. Independent UX review found and prompted fixes for full-neck scroll restoration and no-shape fallback state; no blockers remained after review and browser verification.
- Typecheck, lint, existing tests, and production build pass. Browser error log empty. Physical-device touch and screen-reader audio remain untested; the existing fingering library is intentionally limited, not exhaustive.
- Evidence: `docs/redesign/progger-chord-neck.jpg` and `docs/redesign/progger-chord-mobile.jpg`.

## Quiet Cabinet finish — 2026-09-06

final result: passed

Source visual: `docs/redesign/progger-finish-before.jpg`, the existing accepted Quiet Cabinet UI. Implementation: `docs/redesign/progger-finish-after.jpg`. Both show C Major, Full neck, Notes, collapsed theory, scroll 0 at a 1223×828 CSS viewport; returned captures are both 1208×818 pixels. They were opened together in one comparison input without resizing. This is an authorized finish refinement, so the following differences are intentional rather than fidelity defects.

- Typography: retained Geist and Silkscreen, legible musical type sizes, and existing heading hierarchy. Added proportional long-title sizing at 501–750px; F♯ Jazz melodic minor is fully visible at 320px and 501px.
- Spacing/layout: aligned masthead edges with the workspace, placed navigation opposite the brand, moved the open note palette to the right on desktop, and brought the neck about 30px higher. No hero, new content, or additional route. Navigation and segmented controls have distinct selected treatments.
- Colors/tokens: quieter charcoal/olive surfaces with existing lime selection and amber roots. Computed note-text contrast is 8.68:1, root text 8.99:1, and muted metadata 8.14:1. Note dimensions, root rings, target outlines, and fret coordinates remain unchanged.
- Assets: retained the real transparent frog and pixel wordmark. A brief hover hop applies only for a hover-capable pointer with no reduced-motion preference. No new image assets or fake decorations.
- Copy/content: unchanged musical, explanatory, and navigation copy. Chevron rotation and small directional arrow movement reinforce existing affordances. Segmented keyboard focus now uses a visible 2px inset outline.

Comparison history: desktop comparison passed with no substantive mismatch. Responsive review found a 501px toolbar overflow and truncated long title (P2). Natural toolbar wrapping, nonshrinking root selection, and proportional title sizing resolved both. Final `progger-finish-tablet.jpg` shows the complete title and controls without page overflow; `progger-finish-mobile.jpg` shows the 320px layout. Full captures are sufficiently readable to compare labels, borders, and controls without separate crops. Match evidence is `progger-finish-match.jpg` (1223×828 CSS, 1208×818 pixels); mobile and tablet captures are 305×743 and 486×803 pixels for 320×780 and 501×828 CSS viewports, respectively, reflecting the browser capture scaling rather than density normalization.

Verification: reviewed 320/501/600/750/800px widths, complete long titles, mobile builder alignment, selected menu rotation, actual keyboard-visible focus, and fret 24 → Open navigation (19–24 → 0–5). Browser error log empty. Lint and production build pass. Independent musical reviewer verified unchanged theory/component hashes and six passing fixture groups. Independent visual reviewer inspected both desktop captures and phone/tablet/Match screenshots; no actionable findings remain. Physical touch, screen-reader audio, and full motion-preference emulation remain follow-up validation gaps.

- [x] Preserve selected art direction and immediate musical utility.
- [x] Resolve responsive and focus findings.
- [x] Compare source and implementation; verify interactions and build.
