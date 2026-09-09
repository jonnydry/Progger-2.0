# Progger pre-domain audit — 9 September 2026

## Result

Completed independent music, interface/lifecycle and production-delivery reviews,
then verified the patched production build locally with Wrangler. Three confirmed
issues were fixed. No remaining release blocker was found in this audited scope.
No domain change, deployment, commit or push was performed.

## Fixed findings

1. **Equivalent chord inversions changed scale rankings.** `Cdim7 Cdim7/C`
   preferred a different collection from `Cdim7` despite identical harmonic
   content. Repeated harmony now compares root, quality and complete pitch set.
   Chord-tone inversions retain the same ranking; an external slash bass still
   changes the required collection. Regression examples include diminished,
   half-diminished, augmented and altered dominant chords.
2. **Browser history left a dropdown over the wrong workspace.** Explore and
   Match remain mounted to retain state, while selector popups render through a
   portal. Back/Forward could hide the owner without closing its popup. Music
   selectors now close on hash navigation or hidden triggers. Focus returns to
   the visible main content when the original trigger is hidden; normal Escape
   still returns focus to its trigger.
3. **A vulnerable image dependency remained in the build toolchain.** Miniflare
   pinned Sharp 0.35.2, affected by
   [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c).
   A targeted override installs Sharp 0.35.4 without downgrading Wrangler or the
   Vite plugin. Native decode/resize/encode succeeded with libheif 1.23.2.
   The app has no user image-upload/transform flow; the affected dependency was
   in build tooling. Full and production-only npm audits now report zero known
   vulnerabilities as of this audit.

README release scope and the verification index were updated to include chord
voicing audition and this report.

## Evidence

- 68 named tests across six test files pass (Node 26's `--test` summary reports
  files). New independent fixtures cover 4,992 root/quality/slash-bass cases
  against authored chord and scale interval sets, plus diatonic spelling and
  inversion-priority regressions. Existing pattern, voicing, parser, theme and
  audio lifecycle suites pass.
- Full typecheck, lint, whitespace check and patched production build pass.
- Final client JavaScript: nine files, 197,532 aggregate gzip bytes. This is a
  build-size measurement, not a cold mobile network/performance benchmark.
- Homepage plus 24 referenced script/style/font/image assets returned 200 with
  appropriate MIME types. Hashed assets receive immutable cache headers.
- Unknown routes, scaffold sign-in route, `.env`, `.git/config`, hosting config
  and source paths return 404. No Sites development instrumentation or client
  source maps were found in the production bundle.

## Browser acceptance

Checked the actual production output at a separate local port, including after
all fixes and the dependency patch:

- Direct `#match` entry hydrates the correct workspace.
- Am–D offers A Dorian and jazz melodic minor; Show on neck retains the chord
  context. Back to your chords preserves input and restores focus to the
  originating Show on neck button.
- Invalid Cwat clears result cards. A 33-chord progression remains editable,
  reports the 32-chord limit and displays no stale match cards.
- Patched Cdim7–Cdim7/C recommends C whole–half diminished.
- Open scale selector → browser Back to Match leaves no visible listbox or
  focus in hidden content. Independent reviewer also verified the reverse
  builder-menu journey, Forward, normal selection and Escape focus restoration.
- Mobile neck navigation reaches open strings and fret 24; the visible musical
  range survives switching between Explore and Match. Mirrored neck reaches
  fret 24. No page overflow at the checked 320/390px widths.
- All six scene/light combinations preserve A Dorian and stay within a 390px
  page. This is a state/layout check, not a pixel-by-pixel contrast audit.

## Remaining limits and publication handoff

- Physical touch devices, real Safari/Firefox and screen-reader listening have
  not been independently tested. Automated Chromium and source checks do not
  establish compatibility with every device or assistive technology.
- The catalog is finite; exact pitch coverage is not a musical guarantee and
  physically valid fret positions do not guarantee comfortable fingerings.
- About 12.9 MB of documented original/obsolete artwork is still packaged in
  public assets. It is not automatically fetched by the UI. Originals were
  retained rather than deleting design provenance during this bughunt.
- The existing Vinext route-classification warning and Node module-registration
  deprecation remain; build and local production runtime succeed.
- Domain binding, HTTPS and a final smoke test at the real published origin
  remain deployment steps. No hosted-origin behavior is claimed from localhost.
