# Maple Mono for Progger

Unmodified font files extracted from the official **Maple Mono v7.9** stable release.

- Project: https://github.com/subframe7536/maple-font
- Release: https://github.com/subframe7536/maple-font/releases/tag/v7.9
- Published: 2025-12-05T12:40:29Z
- Release source revision: `4d84772` (tag `v7.9`).
- Original archive: https://github.com/subframe7536/maple-font/releases/download/v7.9/MapleMono-Woff2.zip
- Original archive SHA-256: `5e38e83b007e7157c253c3f57c0a6f80415378f4859d43eb3cf4b1d858001681`
- Retrieved: 2026-09-06.
- License: SIL Open Font License 1.1; the archive's original `LICENSE.txt` is included unchanged.

These are the standard Maple Mono WOFF2 files, not the alternative Normal preset, Nerd Font, or CJK builds. Upright and italic use one coordinated Maple Mono family. The chosen static WOFF2 weights provide compact, unmodified official assets; the release's variable bundle contains TTF files.

| File | CSS weight | CSS style | Bytes | SHA-256 |
| --- | --- | --- | --- | --- |
| `MapleMono-Regular.ttf.woff2` | 400 | normal | 74,756 | `cc92b4284346c9ef924eaaa9f457d558c3dc68d132911403e94f8f498d529e9f` |
| `MapleMono-Medium.ttf.woff2` | 500 | normal | 76,892 | `5b22636988b551d37a8b9c0a94be22cbc22f4dbc439bed279896d76a627bc69a` |
| `MapleMono-SemiBold.ttf.woff2` | 600 | normal | 77,528 | `210f48c8a748c59e3cc4fc982642469b62b49b060f40cc6695e546046d79e868` |
| `MapleMono-Italic.ttf.woff2` | 400 | italic | 84,096 | `6017607745733b64b023105ea593b5d0b9f7a98743694e79b6ab674210634e6d` |

Total webfont bytes: **313,272** (approximately 306 KiB), before HTTP transfer compression. Browsers request only faces used by the page. Declare `font-display: swap` and preload only the default regular face when appropriate.

## Verified character coverage

The WOFF2 files were decompressed with `woff2_decompress` and their Unicode cmap tables inspected using FontTools. All four include Basic Latin letters and digits, plus `♯` (U+266F), `♭` (U+266D), `°` (U+00B0), `ø` (U+00F8), `×` (U+00D7), `○` (U+25CB), `↑` (U+2191), `↓` (U+2193), and `→` (U+2192).

The natural sign `♮` (U+266E) is absent. Keep a system monospace fallback for unsupported characters. Do not substitute ASCII accidentals or change musical spelling. Silkscreen lacks sharp and flat glyphs, so Maple Mono should be the next explicit family in arcade title/selector font stacks.

Programming ligatures are included in the original files. Disable optional/contextual ligatures in musical notation, chord input, and compact controls so adjacent characters retain independent forms; ordinary font kerning is unaffected.
