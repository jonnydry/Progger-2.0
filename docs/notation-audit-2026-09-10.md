# Scale notation audit — 10 September 2026

Audited all 28 catalog scales across all 17 selectable root spellings (476 combinations), with independent musical and interface reviewers. All pitch formulas are correct. Multiple-accidental note names appeared in 129 combinations, including ordinary harmonic minor as well as advanced modes. The issue was presentation, not incorrect pitches.

## Readable note names

`lib/note-presentation.ts` provides display-only aliases for note names containing two or more accidentals. Naturals are preferred when possible; remaining aliases use a single accidental in the original sharp/flat direction. Ordinary single-accidental spellings, including E♯ and F♭, remain intact.

- G♭ harmonic minor: B♭♭ → A and E♭♭ → D.
- D♭ harmonic minor: B♭♭ → A.
- G♯ harmonic minor: F♯♯ → G.
- C Ultralocrian: B♭♭ → A, with degree ♭♭7 retained.
- E Altered: F♯♯ → G, with degree ♯9 retained.

The palette, fretboard, per-string reference, matched-scale notes and voicing bass labels use the shared helper. A keyboard/touch-accessible “Simplified note names” disclosure lists every changed spelling and its degree. Note tooltips and the neck’s accessible summary also disclose the original spelling. Explanatory chord text supplies both names where needed.

Canonical notes, explicit roots, chord symbols, interval labels, matching, generated patterns and audio remain unchanged. In particular, ♭♭7 is a valid diminished-seventh function, not an error to replace with degree 6. Chord symbols can still contain multiple accidentals in theoretical keys; the disclosure explicitly explains this distinction. No global notation setting was introduced.

## Verification

- All seven test files pass, including five new independently authored notation tests in `tests/scale-notation.test.ts`.
- New tests specify all 28 semitone collections independently, verify every selectable root, assert bounded readable names with identical pitches/degrees/fret patterns, preserve frozen canonical inputs, and cover double/triple-accidental roots.
- Typecheck, lint, `git diff --check` and `npm run build:vercel` pass. The static build prerenders both routes with zero skipped routes and verifies the homepage hydration payload.
- Browser: G♭, D♭ and G♯ harmonic minor; C/G♭ Ultralocrian; E Altered; F♯ major. F♯ major retains E♯ and shows no unnecessary spelling disclosure.
- Browser: at 320px, G♭ Ultralocrian’s six-alias explanation opens with Enter, has a 44px summary target and causes no document overflow (305px content / 305px client width). Changing scale/root resets the disclosure. Notes/degrees switching and the readable per-string table work; fret navigation still reaches the final range through fret 24.
- Browser: D♭m–A♭7 returns D♭ harmonic minor with A in place of B♭♭; Show on neck preserves those labels; Back to your chords preserves the progression.
- Browser: G♭ harmonic minor → B♭♭ augmented chord → return preserves canonical chord identity and scale selection, while the bass and note labels show the readable A.
- No browser console errors observed during the verified journeys. Desktop and 320px screenshots inspected. Physical-device and screen-reader listening were not tested.

These changes are verified locally and have not been deployed in this audit.

## Theory references

The independent musical reviewer checked the minor-mode families against the [Berklee PULSE scale and arpeggio collection](https://pulse.berklee.edu/content/practice/pdfs/PR_All_Scales_Arp_Bass_Clef.pdf), especially printed pages 178–225, and [Berklee’s jazz scale reference](https://online.berklee.edu/takenote/jazz-improvisation-10-scales/). Regression fixtures are authored independently of the implementation formulas.
