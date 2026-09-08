# Progger system audit — 8 September 2026

## Result

Completed source review, independent musical sweeps, behavioral regression tests, development-browser journeys, dependency advisory checks, and production-browser smoke tests. All confirmed actionable findings below were fixed. No remaining release blocker was found in the reviewed scope; this is not a claim that every browser/device combination is bug-free.

Existing uncommitted daytime artwork and styling were preserved. No deployment or GitHub push was performed.

## Fixed findings

### Music matching

- **Repeated harmony changed the first scale suggestion.** `Cdim7` preferred whole–half diminished, but `Cdim7 Cdim7` fell back to a different ranking solely because the input had two tokens. The same root/quality/slash-bass harmony now retains the reviewed preference across repeated bars. Different progressions still use existing contextual ranking; exact pitch coverage is unchanged.
- **Dominant 13ths lost the established blues color.** `A7 D7 E7` offered A minor blues while `A13 D13 E13` did not. Plain 13ths now participate in the existing dominant I/IV/V stylistic rule. Major, minor, altered, and unrelated-root chords do not gain this shortcut. The app still distinguishes color from exact coverage; C♯, B, and F♯ are explicitly outside the A minor blues palette over A13.

### Interface state

- **Clicking an active reference tab reset state.** In Am chord shapes, the second E-shape voicing reverted to the first A-shape on clicking Chords again, also resetting the bass filter/context. Active tabs now preserve their current state. Clicking active Scales no longer triggers a focus/scroll restoration.
- **New scale sessions retained obsolete chord-return targets.** Match-result and WebMCP handoffs now discard the previous chord-preview return position, so it cannot affect a later unrelated scale session.

### Theme lifecycle and artwork loading

- **An old asynchronous theme intent overwrote a newer choice.** Newer manual or cross-tab choices now invalidate pending image waits and delayed View Transition callbacks.
- **Changes between prepaint bootstrap and hydration could be missed.** Subscribing now reconciles current storage and device theme before relying on future events.
- **Session-storage events could interfere with the local-storage theme.** Storage-area filtering prevents unrelated session preferences from changing the persistent theme.
- **Artwork warmup cached failures and the wrong responsive asset.** Failed requests can retry; successful warmups are keyed by asset URL so resizing can warm the appropriate night-water image.

## Independent review and fixtures

Three reviewers challenged musical correctness, product/interface state, and theme/runtime behavior. The parent reviewed their patches and verified user-visible repros.

The musical reviewer independently swept:

- 9,248 slash-chord parses, checking bass inclusion and pitch content.
- 22,002 generated voicings, checking actual sounding-MIDI basses, exact omissions, rootless labels, unique grips, and frets 0–24.
- 2,380 tertian triads, checking diatonic membership and correct pitch sets.

All passed. No additional wrong-pitch or bass-label defect was found.

## Verification

- 37 named Node tests pass: 18 musical tests, 9 coverage tests, 10 theme tests. `npm test` on Node 26 summarizes the three test files; direct runs confirm the individual counts.
- Full TypeScript check, lint, whitespace check, and production build pass.
- Full `npm audit` and production-only audit report zero known vulnerabilities at audit time. This is an advisory check, not a penetration test.
- Production client output: 9 JavaScript files, 194,081 gzip bytes in aggregate. This excludes artwork/fonts and is not a measured mobile network transfer.
- Optional WebMCP action validates inputs and changes only local reference state. Installed runtime config review found no application database binding, account flow, or app server-action surface.

## Browser journeys

Verified in the connected in-app browser, including a production build served by Wrangler:

- Am–D Match result→A Dorian retains progression context; native Back and Forward preserve the entered chords.
- Chord preview→second Am voicing→active Chords retains the same second voicing after the fix (first voicing before the fix).
- WebMCP F♯ major produces F♯ G♯ A♯ B C♯ D♯ E♯ and updates the visible reference.
- At 320px, left-handed F♯ major reaches fret 24 and open strings through the pan controls, without document overflow. Evidence: `mobile-left-fret24.jpg`.
- Day/night keyboard activation preserves switch focus and A Dorian selection; saved daytime choice is reconciled after production reload.
- Production A13–D13–E13 offers A minor blues as a color, shows zero exact shared collections, and names C♯/B/F♯ outside that palette over A13.
- A 33-chord input remains editable, shows the 32-chord limit, and removes all stale result cards.
- Browser error logs were empty during stable development and production verification.

The initial browser checks overlapped HMR reloads while reviewers were editing; affected navigation checks were repeated after edits stopped. Alt+Left did not trigger native navigation through the automation interface, so the supported tab Back/Forward APIs were used for actual history verification.

## Remaining limitations

- No physical-device touch pass, screen-reader listening, or real Safari/Firefox test in this audit. Reduced-motion, storage failures, and asynchronous theme races are covered by deterministic browser-environment fixtures.
- Musical voicing validity does not guarantee physical comfort for every hand; wide stretches and barre requirements remain described product limitations.
- Display options such as handedness survive in-app navigation but do not persist after reload. This remains existing scope rather than a newly added persistence feature.
- The instrument and matching catalogs remain finite. Absence of an exact catalog match is not a claim that no musical solution exists.
- Production build reports the existing Vinext static route-classification limitation and Node module-registration deprecation; build and runtime verification succeed.
