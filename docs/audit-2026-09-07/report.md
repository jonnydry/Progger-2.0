# Project audit — 7 September 2026

Result: targeted fixes implemented; automated checks and production-browser journeys passed. The approved Night Swim design and deterministic musical calculations are preserved.

## Review coverage and fixes

Three independent reviewers examined musical correctness; UX/accessibility; and architecture, performance, input handling, and security. The primary agent reproduced findings, integrated fixes, and tested the production build.

| Finding | Fix and verification |
| --- | --- |
| Skip link changed Match into Explore. | Client skip link focuses main without changing the route. Keyboard Enter preserves #match and focuses main-content. |
| Return from a matched scale lost result focus and scroll. | Capture the origin and restore after Match becomes visible; history.pushState avoids a later native fragment jump. Keyboard return restored Show on neck and scrollY exactly 677.5. Nested scale/chord returns and browser Back passed. |
| Opening Explore after a direct Match visit misplaced the practice pattern. | Ignore hidden dimensions during initialization and preserve the last visible fret range. Production verification: direct #match → Explore positions A Dorian at frets 3–12; panning to 15–24 then switching pages preserves 15–24. Independent review confirms notes and pattern data are unchanged. |
| Generated theoretical chord roots could crash pitch decoding. | Support homogeneous internal accidental sequences while input syntax remains bounded. Regression coverage includes 143 previously rejected derived roots. |
| Inferred matches used needlessly complex names. | Choose simpler inferred scale spellings; retain explicit roots/home notes. Fixtures cover Cm → E♭ major, Gm7 → B♭ major, and explicit D♯. A 539-case comparison preserved pitch collections, scale IDs, center pitch classes, and scores. |
| Oversized errors overflowed the page and repeated input unnecessarily. | Explicit limits: 2,048 progression characters, 32 symbol characters, 32 chords; compact wrapping, deduplicated errors. A 201-character bad token previously expanded 1,265px to 1,959px; patched width remains 1,265px. A 2,052-character paste stays editable and returns no false prefix matches. |
| Per-chord choices were computed twice; new spelling logic briefly regressed CPU cost. | Memoize local choices and cache at most 312 inferred root strings. Fresh note arrays prevent mutable cache leakage; mutation tests and independent benchmarks pass. |
| Large PNGs and full-resolution favicon dominated downloads. | Lossless WebP copies retain identical decoded RGBA pixels, independently rechecked by the primary agent. A 64px favicon is 6,331 bytes. Referenced scene/icon bytes fall about 46%; see ../asset-delivery.md. |
| Production preview bypassed project-local runtime settings. | Portable Node preload applies defaults while preserving overrides. Plain npm start now uses local state/log settings. Production startup succeeds with the environment's localhost permission. |
| Documentation described superseded visuals. | README, product direction, and verification now reflect the approved panorama, typography, input limits, and current evidence. Initial verification is archived. |

## Verification

- TypeScript, lint, all 10 named musical test groups, production build, and diff whitespace checks pass.
- Independent fixtures cover 13 scale formulas, 19 qualities, 17 root spellings, voicings, and fret/pattern invariants.
- Production browser: keyboard skip, invalid/oversized input, shared/chromatic progressions, nested return navigation, browser Back, and optional WebMCP. F♯ major correctly displays E♯. Am–G–F–E7 yields no false exact collection and shows four per-chord sections.
- At 320px, Home/End reaches frets 0–5 and 19–24 in both handedness modes. Document client/scroll widths both equal 305px. A screenshot is saved as mobile-fret24.jpg. Recent long-title, menu, and expanded Match evidence remains in the design QA folders; affected paths were retested.
- Production requests successfully serve WebP scenes, the small favicon, self-hosted fonts, and client bundles. Final browser console check has no application errors.
- Full and production-only dependency advisory scans reported zero known vulnerabilities on the audit date. Source review found no application network-based theory calculation, credentials, persistence, or unsafe HTML rendering. This is not a penetration test.

## Performance

Final emitted JavaScript totals 203,125 gzip bytes across 9 files (about 198 KiB), close to the original near-200KB target. CSS totals 36,796 gzip bytes. These are file-size measurements, not browser transfer timings.

Independent local Node benchmark (20 warmups, 100 samples), including matching, color choices, and one per-chord calculation:

| Input | Median | p95 |
| --- | ---: | ---: |
| Four chords | 0.960ms | 1.109ms |
| 32 repeated chords | 5.817ms | 7.126ms |
| 32 mixed chords | 5.688ms | 6.068ms |

The uncached inference change briefly reached 19.5ms p95 and was fixed before completion. These are unthrottled host measurements, not mobile end-to-end latency claims.

## Remaining limits

- Header, one underwater image, and icon still total roughly 1.9–2.0MB. Responsive derivatives or reviewed lossy encoding could reduce this further.
- Real-device touch, screen-reader listening, and slow-network/mobile CPU measurements were not performed. The browser tool did not support the attempted zoom shortcut, so actual 200% zoom remains unverified; 320px reflow passed.
- Vinext reports its known static route-classification limitation and Node emits a dependency deprecation notice during build. A renderer-context warning also appeared during development hot reload. Build and production runtime succeed; the production browser checks found no application errors.
- AI Progression Lab, audio, alternate tunings, accounts, and offline installation remain deferred scope.
- No deployment was performed. Prior uncommitted design work was preserved.
