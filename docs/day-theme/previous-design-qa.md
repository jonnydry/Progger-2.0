# Full project audit — 7 September 2026

final result: passed with documented validation limits

See `docs/audit-2026-09-07/report.md` for the current audit, fixes, production-browser evidence, measured performance, and remaining limits. The approved design is preserved. Historical visual QA follows below.

# Chord-section underwater consistency QA

final result: passed

Applied the shared underwater scene to Match chords through the entry form, builder, and home-note options, ending before results. Extracted decorative responsive imagery into `components/underwater-scene.tsx`, reused by Explore (scales and chords) and Match. No additional assets or dependencies.

- Match overlap accounts for its 36px desktop/26px mobile top gap. Its scene follows disclosure height; right-aligned framing retains underwater details in the tall mobile form. Mobile opacity 0.35 and a broader upper fade resolve the art review's finding of distracting surface fragments behind heading/copy.
- Verified collapsed and expanded desktop Match, 320px with both disclosures open (1036px entry height), opaque quality menu, clear result section, and Explore chord/return navigation. Mobile document clientWidth and scrollWidth are both 305px. Evidence in `docs/chord-water/`; menu image documents the earlier, brighter treatment before the final mobile dimming.
- Independent art and product/music audits passed. Music/harmony/fretboard hashes unchanged; Match parsing and handlers preserved. TypeScript, lint, formatting, and diff checks pass. Browser viewport reset; preview left on Match chords with options collapsed and original Am F C G progression. No deployment requested.

# Underwater reference extension QA

final result: passed

Extended the scene through the reference tabs, selected root/style, caption, and note palette, ending at a subtle divider before the fretboard. The approved frog/header asset is unchanged. New desktop and mobile underwater continuation assets preserve an open dark center with edge reeds and moonlight; prompts/provenance are in `docs/underwater/asset-notes.md`.

- Added a content-sized reference-water wrapper and decorative responsive picture. Full-bleed width uses the app's inline-size container (100cqw), avoiding scrollbar overflow. Artwork overlaps the preceding scene by 60px with a soft alpha transition and follows wrapped content height.
- Mobile square recomposition retains aquatic edge details that disappeared in a simple crop of the desktop asset. At 320px clientWidth equals scrollWidth (305px), and the art bottom aligns with the note-section divider.
- Removed a stale wide/short-screen 72px header override that cropped the panorama. Verified the full frog scene at 1440 × 900.
- Independent product review identified artwork potentially painting above a preceding return banner; raised the positioned banner to z-index 1 and verified readable Back to A Dorian in the browser. Art and product/music reviewers accepted final desktop, mobile, wrapped title, and chord-return screenshots.
- TypeScript, lint, CSS/JSX formatting, and diff whitespace checks pass. Music, harmony, and fretboard hashes are unchanged. No music engine changes or new dependencies. Screenshots in `docs/underwater/`.
- Normal A Dorian/fret-five pattern and default browser viewport restored. Added raster downloads are a tradeoff for the scene extension; no throttled-network or physical-device measurements were performed. No deployment requested.

# Arcade character and panoramic header QA

Follow-up: broadened the artwork's lower alpha fade into a smooth multi-stop transition, removing the abrupt visual band while retaining the frog silhouette and subdued water reflections. Mobile's upper fade, layout, crop, and music controls remain unchanged. Desktop and 320px browser screenshots are `docs/arcade-header/blend-desktop.jpg` and `blend-mobile.jpg`. CSS formatting and diff checks pass.

final result: passed

User requested a redesigned frog with more playful attitude and a scene spanning the entire header. Generated a new character with an exaggerated rock stance, mischievous expression, magenta bandana, and angular amber guitar in a continuous moonlit pond landscape. Integrated `public/progger-arcade-pond.png` inside the header; replaced corner-art sizing with responsive full-width framing. Source prompt and provenance: `docs/arcade-header/asset-notes.md`.

- Independent art and product/music reviewers accepted the actual desktop, 600px, and 320px Explore/Match screenshots. Frog silhouette, guitar, both feet, pad, and reflections remain visible. Primary agent additionally verified the 501px breakpoint. Screenshots are in `docs/arcade-header/`.
- Resolved initial mobile crop collision with Match chords navigation by placing the 145px scene below the links in a 210px header. Desktop uses a 210–360px header. This intentionally adds vertical space for the requested panorama; music controls stay on a quiet background below it.
- TypeScript, lint, and diff whitespace checks pass. Browser console has no errors. At 320px document clientWidth and scrollWidth both equal 305px. Shared Match heading and input remain clear.
- Music, harmony, and fretboard hashes match the start of the pass. Decorative semantics, non-interactive image behavior, and deterministic music engine preserved. No new dependencies or UI-wide visual filters.
- Asset is 2172 × 724, 1,429,430 bytes; larger than the prior corner image to support full-width use. Physical-device and throttled-network measurements were not performed. Pixel detail softens at small sizes, but character silhouette remains readable. CRT effect is artistic rather than physical emulation.
- Viewport reset, normal A Dorian restored, no deployment requested.

# Frog artwork refinement QA

final result: passed

Replaced the pond illustration with a larger, deliberately coarse pixel-art frog and amber guitar. The lily pad, broken water reflections, midnight palette, and subtle emitted-light blending remain. The final built-in image-generation edit is `public/night-pond-crt.png`; prompts and provenance are recorded in `docs/frog-crt/asset-notes.md`. Only the decorative Image source changed in this pass; layout, dimensions, and accessibility behavior are preserved.

The first redraw still looked smoothly illustrated at actual page size. A second pass simplified the color clusters and increased their size. Independent art and product/music reviewers accepted the final in-page result. No blocking findings remain; on 320px screens the pond sits close to navigation but does not obscure its text. CRT treatment is an artistic approximation, not physical monitor emulation.

- Checked normal A Dorian at desktop, 600px, and 320px. Screenshots: `docs/frog-crt/desktop.jpg`, `tablet.jpg`, and `mobile.jpg`. No document overflow at 320px, no artwork collision with musical labels, and no browser console errors.
- TypeScript and `git diff --check` pass. Music, harmony, and fretboard source hashes match the start of this pass. Independent reviewer fixtures for A Dorian spelling/18-note pattern, Am–D matching, and fret 24 reachability pass.
- Raster dimensions remain 1448 × 1086. Final PNG is 1,063,144 bytes versus 1,141,080 previously (6.8% smaller). The original asset is retained. No new runtime rendering filters or dependencies.
- Browser viewport reset and normal A Dorian preview restored. Physical-device and network-throttling tests were not performed. No deployment requested.

# Unified typography QA

final result: passed

## Scope and direction

User requested the PROGGER font on the main key/type selectors and a coordinated monospace family elsewhere, preferring Maple Mono. The implemented system has two families: Silkscreen for the wordmark and selected root/type, and self-hosted Maple Mono v7.9 for all other text. Maple Regular 400, Medium 500, Semibold 600, and genuineItalic 400 provide hierarchy without additional families. Geist and Instrument Serif imports and style references were removed.

The font assets remain unmodified, retain their SIL Open Font License, and total 313,272bytes. Only Regular is explicitly preloaded. Exact provenance/checksums live in `public/fonts/maple-mono/README.md`; design roles live in `docs/TYPOGRAPHY.md`.

## Adversarial findings resolved

- Silkscreen's automatically generated Arial fallback intercepted its missing accidental glyphs. Disabled that fallback; browser computed styles now show Silkscreen followed directly by Maple Mono. Maple cmap includes sharp/flat glyphs.
- Monospace metrics widened long selectors. Selected style names wrap fully on narrow screens; 320px F♯ Jazz melodic minor remains complete over two lines. Root and style retain consistent font size. Portal options use Maple, can wrap, and have a 224px minimum menu width bounded by the viewport.
- The Fret placeholder was truncated at 64px. Expanded selector and wrapper to 80px; narrow mobile labels adapt to fit.
- Smallest dock rows became crowded. At 370px and below, pattern selection and Notes/Degrees/Display use separate rows; buttons remain readable with 44px targets.
- Independent fixtures include rare four/five-character accidental labels. A scoped 44px pill at 12px preserves the exact text without crossing the 48px column model. The extreme test was restored to normal A Dorian after user feedback about seeing it in the shared preview; defaults and engine spelling rules were not changed.

Independent musical and interface reviewers accepted the landed source and inspected desktop,320px title, dock, chord, and Match screenshots. No actionable findings remain in those reviewed states.

## Verification and evidence

- Production build, TypeScript, lint, existing musical tests, and `git diff --check` pass. Existing Vinext classification/Node deprecation notices remain.
- Browser computed styles confirm Maple on body, note markers, and popup menus; wordmark and root/type share the Silkscreen→Maple stack. Contextual/programming ligatures are off.
- Independent font cmap/advance checks confirm sharp/flat coverage and 0.6em note-symbol advances. Existing authored fixtures cover F♯/G♭ spelling, diminished degrees, A Dorian 18positions, open voicings, and frets 0/24. Music engine files have no diff.
- Browser: 320px F♯ Jazz melodic minor, E♯ palette/fret labels, complete option text, matching form and builder alignment, chord drilldown, visible Notes/Degrees/Fret controls. At 320px, Home reaches 0–5 and End reaches 19–24. Document client and scroll widths agree at 305px. Long-label marker clientWidth equals scrollWidth 42px.
- Final preview is back on A Dorian. Temporary viewport overrides are reset; final console error check is empty.
- Screenshots: `docs/typography/before.jpg`, `final.jpg`, `desktop.jpg`, `mobile-long.jpg`, `mobile-dock.jpg`, `match-mobile.jpg`, and `exotic-chord.jpg`. The desktop image includes an open selector to document menu typography; final shows the restored normal reference. User-requested type changes supersede the previous serif visual target.

Physical-device testing, screen-reader listening, and measured network performance were not repeated in this pass. Maple lacks the explicit natural sign, which the current engine does not emit; system fallback remains for future unsupported symbols. No deployment was requested.

Prior Night Swim QA is preserved in `docs/night-swim/qa-initial-theme.md`.
