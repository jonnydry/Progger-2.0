# Progger — product and scaffolding plan

Status: first reference release implemented and verified; Explore and Match Chords are complete, with AI Progression Lab deferred. Application source is in app/. This document combines independent product/UX, music-theory, and architecture proposals, followed by a critique round. The original repository is a reference, not the implementation baseline.

## Product direction

Progger should feel like a fast, dependable musical instrument with a playful personality. A guitarist can look up a sound, see where to play it, or enter chords and discover useful melodic choices without first knowing their key or the vocabulary of modes.

Open directly into an editable reference and its fretboard. The frog guitarist, pixel wordmark, and small musical animations establish the personality; precise diagrams, clear labels, and quick navigation establish trust.

The first release has two destinations:

- **Explore:** scales, modes, and chords, their formulas and notes, and playable guitar diagrams.
- **Match Chords:** enter chords, understand the available note collections, and take a useful choice straight to the neck.

**Progression Lab** follows as an optional composition feature. It should not appear as a disabled tab in the first release.

## What the original establishes

The [original README](https://github.com/jonnydry/Progger/blob/main/README.md) describes curated chord/scale data with AI progression inspiration, React/TypeScript/Vite, Express, PostgreSQL, and Replit authentication. That separation of reliable musical data and creative AI is worth preserving.

The inspected [application entry](https://github.com/jonnydry/Progger/blob/main/client/src/App.tsx) defaults to generation. The new concept makes reference and chord matching the primary entry points. The inspected [scale diagram](https://github.com/jonnydry/Progger/blob/main/client/src/components/ScaleDiagram.tsx) distinguishes pattern/all/map views and defines separate mobile and desktop fret counts. The new design keeps one 0–24 fret model and changes only its viewport.

This was targeted source inspection, not a complete code audit or a visual review of a running deployment. Existing tests and data can supply research examples; their expectations must be independently checked before reuse.

## Visual and interaction design

Current visual direction (user-approved, September 2026): Night Swim replaces
the initial compact header proposal below. A full-width pixel-art frog/pond
scene continues underwater behind the reference information and Match chord
entry, ending before the neck or results. Silkscreen handles the brand and main
selectors; Maple Mono handles the rest. The original compact-layout notes are
historical guidance, not a reason to remove the requested panorama. Preserve
readability, responsive framing, and quick local calculations within this
direction.

Use an ink-dark studio palette: warm near-black background, clearly separated charcoal surfaces, saturated pond-green controls, amber root emphasis, and ivory note labels. A pixel-art frog carrying a guitar is the signature mascot. Keep pixel typography to the wordmark and short accents; controls and theory use a legible sans serif.

Desktop composition: compact brand/navigation bar, adjacent selection controls and useful musical facts, then a broad fretboard as the main working surface. Match results retain access to the entered chord sequence and open the selected palette in the same neck component. Avoid repeated diagrams for modal aliases, an oversized marketing hero, decorative effects over notes, and interaction-blocking mascot animation.

The Frogger influence can appear in the position selector as small stepping markers and in a brief optional frog hop when changing a practice position. Core commands retain literal names such as “Next position” and “Show on neck.” Motion respects reduced-motion preferences.

### Explore

1. Choose Scales & Modes or Chords.
2. Choose a root and named scale, mode, or chord quality; show a useful initial selection immediately.
3. Read spelled notes and an interval formula beside the diagram.
4. Switch between note names and degrees, the full scale map and a practice pattern.
5. Move between positions without losing the selected musical context.

For chords, provide both chord-tone locations across the neck and reviewed playable voicing diagrams. Highlighting every chord tone on six strings is not itself a playable chord shape. Voicings show open/muted strings, fret position, and fingers where reviewed data supports them.

For modes, explain the characteristic interval relative to the parallel major/minor sound. A pattern beginning on D is not automatically D Dorian; the selected tonal center and interval labels must remain explicit.

### Mobile neck

Keep all six strings and all frets 0–24 in the data model. On a phone, show approximately 5–7 readable frets at once, adapting to available width. Use horizontal panning within the neck, stable string labels, visible fret numbers, and a text indicator such as “Frets 5–11.”

Use a compact position ruler with a viewport indicator, without microscopic note dots. Previous/next-span controls and a jump-to-fret selector provide alternatives to dragging. Selecting a 3NPS pattern moves to its location. A wide pattern remains pannable rather than shrinking its labels. Frets 0 and 24 must both be reachable in portrait; rotation or fullscreen is optional.

On wide desktop screens the full neck can be visible. Smaller desktop/tablet windows use the same readable viewport behavior. Do not force all 24 frets into every available width.

Root identity uses a ring/shape and text as well as color. Touch controls target at least 44 CSS pixels where practical; diagram navigation supports keyboard input and a text summary of notes/positions. Verify text enlargement, focus visibility, and contrast rather than assuming the palette is accessible.

## Musical scope and correctness

Initial instrument assumption: six-string guitar in standard tuning, 24 frets plus open strings. Keep tuning explicit in the domain model so alternate tunings can be added without replacing the engine; alternate tunings and additional string counts are follow-up scope. Include a left-handed display option without changing musical coordinates.

The initial scale catalog covers all roots for the seven major-system modes, major/minor pentatonic, major/minor blues, harmonic minor, and jazz melodic minor. Label jazz melodic minor explicitly as the same collection ascending and descending. Add the complete harmonic/melodic minor mode families and symmetric scales through the same catalog after their names, formulas, recommendations, and patterns have been reviewed. Disclose catalog coverage; “all relevant” cannot mean every conceivable scale or mathematical superset.

Initial chord vocabulary: major/minor/diminished/augmented triads, power chords, sus2/sus4, 6/m6, dominant 7/maj7/m7, half-diminished and diminished 7, add9, and common 9th qualities. Support slash basses. Keep the catalog extensible for further extensions and alterations. Unsupported symbols receive an explicit, editable error instead of silently becoming a different chord. Parsing support and available curated voicings must be shown honestly when their coverage differs.

Represent three separate things:

- Pitch class for set comparison, normalized to 0–11.
- MIDI pitch for register and string/fret projection.
- Spelled pitch and interval degrees for notation, including distinctions such as F-sharp/G-flat and sharp 4/flat 5.

Store interval degree and alteration alongside semitone distance. A semitone list alone cannot preserve every theoretical spelling. F-sharp major should retain E-sharp; an enharmonic simplification may be explanatory but must not silently replace the correct formula.

### Chord-to-scale matching

Entry supports pasted chord symbols and a root/quality builder for beginners. Display recognized chord tokens before analysis and preserve the user's original text. Unknown keys are allowed. An optional “Home note / key” setting refines interpretation without blocking a result.

Compute and display separately:

1. **Contains all chord tones:** supported collections containing the union of the entered chord tones. Include explicit slash-bass notes in the sounding-tone analysis, distinguishing non-chord pedal/bass notes in explanations.
2. **Possible tonal centers:** contextual hypotheses using the user's chosen center, chord order, repetition, and cadential evidence. Do not treat a first or final chord as proof. Duration matters when available; otherwise use and disclose a simple equal-duration assumption.
3. **Per-chord options:** useful choices and note changes when one shared collection does not cover the sequence.
4. **Pentatonic/blues colors:** reviewed stylistic suggestions that may omit chord tones or deliberately introduce tension. These require explicit rules and explanations, separate from exact set coverage.

Group equivalent pitch sets into one result with possible tonal-center interpretations. Let users inspect every supported match, but initially show a short ranked selection with reasons, not an unexplained percentage. Grouping must not erase the different root/degree labeling needed when a user chooses a particular mode. Mode identity depends on tonal emphasis, not only collection membership. [Open Music Theory](https://openmusictheory.github.io/scales2.html)

Prefer precise wording such as “Contains all chord tones” over “Every note always works.” Show the active chord's tones as useful landing notes. Tensions and passing notes can still be musical; avoid presenting them as forbidden notes. This teaching approach follows the distinction between chord tones and wider melodic choices discussed in [Berklee's improvisation guidance](https://www.berklee.edu/berklee-today/spring-2016/focus-on-the-framework).

### 3-notes-per-string

Keep the full-neck note map separate from an actual practice pattern. Begin with reviewed standard-tuning 3NPS patterns for seven-note scales, checked against a deterministic generator. Handle the G–B string interval explicitly. Label positions by location/starting degree rather than automatically naming them as modes.

A complete 3NPS pattern has exactly three distinct ascending scale notes per string, remains within frets 0–24, and obeys declared stretch/shift constraints. Rank alternatives by neck location and span. If a pattern does not fit near a boundary, offer another valid position; do not truncate it and still call it complete. Reviewed finger assignments are distinct from generated note positions. Pentatonic scales get conventional reviewed shapes instead of forced 3NPS stretches.

## Architecture and proposed scaffold

Recommend React + strict TypeScript + Vite with SVG fretboards and CSS design tokens. Vite supports a React/TypeScript starter and static production assets. Select compatible current package versions at scaffolding time and retain a lockfile. [Vite documentation](https://vite.dev/guide/)

Keep the reference and matching path entirely in the browser. No server, authentication, database, AI request, or external music API is necessary for those computations. Browser-local computation after assets load is not a promise of cold-load offline support; installation/service-worker caching is separate follow-up scope.

```text
src/
  app/                   navigation and composition
  music/                 pitch, spelling, chords, scales, matching, harmony
  guitar/                tuning, fret projection, patterns, voicings
  content/               reviewed catalogs and explanation templates
  features/
    explore/
    match-chords/
  components/            fretboard, voicing diagram, common controls
  styles/                tokens and responsive styling
tests/
  fixtures/              independently authored musical expectations
  music/
  guitar/
  browser/
docs/                    catalog conventions and architectural decisions
```

Use plain feature state first; add a global state library or worker only when a measured need appears. URL serialization may preserve navigation state but does not require a separate sharing feature. Keep domain modules independent of React and browser globals so a future server can import the same engine.

Minimum contracts:

| Contract | Required information |
| --- | --- |
| SpelledNote | Letter, accidental, pitch class |
| Interval | Degree, alteration, semitones |
| ChordSpec | Original token, spelled root, quality ID, intervals, optional bass |
| ScaleDefinition | Stable ID, aliases, family, ordered intervals, supported pattern kinds |
| ScaleInstance | Definition ID, spelled tonic, spelled notes, pitch-set key |
| AnalysisResult | Exact collection groups, center hypotheses, per-chord guidance, reason codes, catalog version |
| Pattern | Explicit string/fret/MIDI/degree positions, kind, constraints, review provenance |
| Voicing | Fretted/open/muted strings, bass, optional reviewed fingers and barre information |
| ExplorationState | Schema version, selected reference, labels, handedness, pattern and fret window |

## AI progression generation

Viable as a constrained composition feature. The user could ask for “a wistful four-chord loop in E, with one surprising change” or use simpler controls for key, length, mood, and harmonic adventurousness.

The model proposes structured chord events and compositional intent. The server parses and validates the response, then the deterministic engine recomputes chord pitches, candidate harmonic interpretations, scale options, and diagrams. The model never supplies authoritative fret coordinates. Schema-constrained responses help enforce format; they do not establish musical quality. [OpenAI structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs)

Add a provider boundary and one server endpoint when Lab is implemented. Keep provider keys server-side; bound request size, response size, retries, timeouts, and usage. Validate before displaying results. Failed generation leaves the reference tool usable. A reviewed recipe can be offered as an explicitly labeled fallback, not silently represented as AI output.

Musical validation has limits: pitch correctness and compliance with a chosen key can be tested, while groove, melody, voice-leading quality, and interesting surprise require listening and musician judgment. Borrowed chords and modulation are allowed when intentional and explained as interpretations. Compare model/provider choices against a small curated prompt and listening set before choosing a vendor; do not inherit the old model choice automatically.

## Debate outcomes

| Question | Resolved choice and reason |
| --- | --- |
| AI-first application or reference-first? | Reference first; speed and reliable diagrams are the central promise. |
| Fullstack immediately or client-first? | Client-first; add the AI server when there is a server requirement. |
| Light field-guide or dark studio/arcade aesthetic? | Dark studio/arcade, preserving the field-guide proposal's readable data and restrained decoration. |
| Entire neck squeezed into a phone? | Readable moving window with all 24 frets accessible and explicit position controls. |
| Every relative mode shown as another result? | Group pitch collections, retain distinct tonal-center interpretations. |
| Exact pitch membership means a universally safe scale? | Report coverage separately from musical guidance and tension. |
| 3NPS for every scale? | Reviewed 3NPS for suitable scales; conventional pentatonic shapes and a universal note map. |
| Add playback, favorites, accounts, and sharing immediately? | Defer; they expand the build without fulfilling the core reference/matching request. |

The review also caught and corrected an erroneous proposed test: Am–F–E7 does fit A harmonic minor. Am–G–F–E7 is the intended example containing both G and G-sharp. This illustrates why fixture expectations need independent review rather than unquestioned model output.

## Implementation sequence and completion criteria

1. **Foundation:** initialize the client, strict types, scripts for lint/typecheck/tests/build, tokens, contracts, and a small independently checked fixture corpus. Confirm musical conventions before multiplying catalog data.
2. **First complete slice:** root/mode selection → spelled notes/formula → neck across frets 0–24 → actual 3NPS position navigation. Use C major and A Dorian as the first examples. Make the desktop and phone interaction work within this slice.
3. **Reference coverage:** fill the initial catalog, reviewed patterns and chord voicings, left-handed display, formulas, and clear unsupported states.
4. **Match Chords:** parser and beginner builder → grouped exact collections → center hypotheses → per-chord guidance and curated pentatonic/blues choices → show selection on neck.
5. **Release verification:** musical fixtures, real browser journeys, accessibility, mobile fret navigation, measured performance, and coherent mascot/visual polish.
6. **Progression Lab:** implement the server/provider boundary, validation, clear failure states, prompt evaluations, and musician listening review.

During implementation, music-engine and interface work can run in parallel after contracts agree; one integration owner should manage shared configuration and final assembly. Give a separate reviewer the fixture expectations and the implemented result so it can challenge both.

### Musical acceptance examples

| Input | Expected assertion |
| --- | --- |
| C–F–G | Union C D E F G A B; C-major collection covers it. |
| Am–F–C–G | Same collection; A/C center interpretations remain contextual. |
| Dm–G7–Cmaj7 | Same collection, with cadence evidence for C; do not force three scale changes. |
| Am–D | Union A C D E F-sharp; both A Dorian and A jazz melodic minor cover it. G versus G-sharp is unspecified. |
| Am–Dm–E7 or Am–F–E7 | Union A B C D E F G-sharp; A harmonic minor covers it. |
| Am–G–F–E7 | Eight notes A B C D E F G G-sharp; no seven-note exact collection. Offer per-chord guidance. |
| A7–D7–E7 | Nine-note union; no single seven-note exact match. Reviewed blues guidance remains possible. |
| C5–F5–G5 | Missing thirds leave major/minor context unresolved. |
| D/F-sharp versus C/F | First is a triad inversion; second adds an explicit non-triad bass note. |

Also test C7 versus Cmaj7, minor versus major, Unicode accidentals, malformed symbols, diminished-seventh spelling, transposition, and every catalog alias. Every fret must satisfy `(openMidi + fret) % 12`; fret 24 repeats the open-string pitch class. Test 3NPS completeness, scalar continuity, tuning transitions, bounds, and stretch rules. Use authored expectations and independent mathematical invariants, not tests that merely recalculate the implementation.

### Experience and performance acceptance

Verify complete Explore and Match Chords journeys on a desktop and phone layout, including edits, errors, ambiguous results, back navigation, keyboard use, zoom, and frets 0 and 24. Check 320, 390, and 430 CSS-pixel phone widths and a wide desktop; scrolling should stay inside the intended neck viewport.

Measure, rather than assume, an initial target of at most 100ms p95 for local selection-to-result on a recorded mobile test profile and an initial reference JavaScript budget near 200KB gzip. These are proposed budgets, not achieved results. Confirm that reference and matching actions make no theory-network request. Add optimization only where measurement shows a problem.

The foundation, Explore, chord reference, and Match Chords have now been implemented. See app/docs/verification.md for checks and remaining validation limits. The next optional product phase is AI Progression Lab.
