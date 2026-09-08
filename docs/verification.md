Latest scale expansion: [28-scale coverage and verification](scale-coverage.md).

## Advanced extensions — 7 September 2026

See [advanced chord coverage and verification](advanced-chords.md) for 11ths, 13ths, altered tensions, explicit omissions and rootless shapes.

## Expanded chord voicings — 7 September 2026

See [voicing coverage, behavior and verification](voicings.md) for the expanded library, inversion labels and browser evidence.

## On-neck position selection — 7 September 2026

Replaced the practice-start dropdown with fret-number buttons aligned to the neck. Exact valid low-E starts select existing deterministic patterns; Full neck can enter a pattern directly. Pan controls remain separate.

Verified in the browser: fret 7 selects A Dorian frets 7–12; keyboard arrows move focus without changing selection, Enter selects; Full neck clears selection; open-string selection works; left-handed arrows follow physical order. At 320px, targets are 48×44px, document widths remain 305px, and the pan control reaches frets 19–24. Independent musical review checked 2,067 patterns, including pentatonic start/min differences and octave repeats. Independent interface review corrected the hint alignment breakpoint. Typecheck, lint, existing musical tests, and production build pass. Physical-device and screen-reader listening remain untested.

# Current project verification

The [7 September 2026 project audit](audit-2026-09-07/report.md) is the current verification report, with fixed issues, production-browser checks, performance measurements, and remaining limits. The original release verification below is historical and is also preserved in `verification-initial.md`.

# Initial release verification (historical)

Independent music and UX subagents reviewed initial code, challenged the expanded implementation, and verified fixes. A release reviewer also checked input handling and deployment configuration. No unresolved source-level release blocker remained in their final reviews.

## Musical checks

Six authored test groups cover theoretical spelling, independently specified 3NPS/2NPS grids, all-root pattern invariants, chord parsing, ambiguous/chromatic matching, and every transposed voicing. They pass with Node's built-in test runner. The music reviewer separately checked 755 returned voicings across 17 root spellings and 19 qualities.

Corrections from review: major-seventh delta notation, double-accidental chord round-trips, literal prose formatting, consistent full-map state after selecting blues, preserved scale context across chord drill-down, quality-aware Roman numerals, left-handed nut/navigation, full-neck text equivalents, and access to chord tones outside a color palette.

## Browser journeys

Verified through the connected in-app browser:

- F-sharp major displays E-sharp.
- C-major 3NPS starting fret 8 has 18 visible positions and the independently specified fret span 8–13.
- Switching a pattern to blues selects Full neck correctly.
- C major → related D minor chord → Scales & modes preserves C major.
- Am–D exposes both A Dorian and A jazz melodic minor.
- Am–G–F–E7 provides no false shared seven-note collection and offers per-chord choices.
- Invalid Cwat preserves text, explains the unsupported quality, and removes stale match cards.
- A7–D7–E7 → A minor blues explicitly names C-sharp outside the palette, opens A7 chord tones, and preserves progression input on return.
- Viewports 320, 390, 430 and 1440 CSS pixels have no document horizontal overflow. On phone, fret 24 and open strings are reachable; mirrored view preserves the same musical range.
- WebMCP explore_scale registration/schema verified; valid F-sharp major updates visible UI and returns its notes, invalid H root fails without corrupting selection.

Browser zoom to 200%, physical-device touch behavior, and screen-reader listening have not been independently verified. Keyboard-focusable controls and per-string text alternatives are implemented; broader assistive-technology testing remains useful.

## Performance

The final patched build emits eight client JavaScript files totaling 164,304 gzip bytes, below the proposed 200KB budget. The local theory matcher measured about 0.22ms p95 on this development host across mixed fixtures; this is not a mobile end-to-end latency measurement. The production build, type check, lint, and six musical test groups pass. Core theory modules have no network dependencies.

## Tooling

The initial Sites scaffold contained outdated dependencies. React/RSC, Vinext, Vite, and compatible Cloudflare tooling were updated to patched versions before publication; the resulting dependency audit reports zero vulnerabilities. The generated component library remains intact; lint excludes untouched starter components and has documented exceptions for intentional ARIA groups/graphics and the focusable scrolling region. Type checking covers the full codebase.
