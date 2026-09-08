# Progger typography

Two font families carry distinct roles across Night Swim.

| Role | Family | Styles |
| --- | --- | --- |
| PROGGER wordmark; selected root, scale/mode, and chord-quality values | Silkscreen | Regular 400 |
| Navigation, dropdown options, headings, buttons, musical labels, input, supporting text | Maple Mono | Regular 400, Medium 500, Semibold 600 |
| Short descriptive captions | Maple Mono | GenuineItalic 400 |

Maple Mono v7.9 is self-hosted from the unchanged official WOFF2 release. Four faces total 313,272bytes; only Regular is explicitly preloaded. License, release details, archive checksum, individual checksums, and glyph coverage are recorded in `public/fonts/maple-mono/README.md` and `LICENSE.txt`.

`--font-ui` defines the Maple stack globally, including portal menus and Tailwind sans/mono utilities. Silkscreen disables its automatically synthesized fallback, so its unsupported sharp/flat glyphs fall through to Maple Mono. The music engine retains the underlying Unicode spelling. Programming/contextual ligatures are disabled; case remains unchanged, including high e and low E.

Main title sizes and minimum heights use shared CSS variables. Narrow selected names wrap on word boundaries; they never lose meaningful suffixes to ellipsis. Dropdown options can wrap and use a 224px minimum popup width bounded by the viewport. At 370px and below, pattern selection and label/display controls occupy separate dock rows.

Normal fret labels retain the established circular markers. Rare spellings longer than three characters use 44px pill markers at 12px, preserving note text within 48px fret columns. This is overflow protection for typed edge cases, not a new default spelling scheme. Keep the shared preview on a normal reference view after testing.

No music-theory functions or defaults changed in this typography pass.
