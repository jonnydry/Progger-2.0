# Scale coverage expansion

Implemented September 7, 2026. The catalog now contains 28 scales and modes across all 17 selectable root spellings.

## Added families

- Harmonic minor: Locrian natural 6, Ionian sharp 5, Dorian sharp 4, Phrygian dominant, Lydian sharp 2, Ultralocrian. Together with harmonic minor, these cover all seven modes.
- Jazz melodic minor: Dorian flat 2, Lydian augmented, Lydian dominant, Mixolydian flat 6, Locrian natural 2, Altered. Together with jazz melodic minor, these cover all seven modes.
- Symmetric: whole tone, half–whole diminished, whole–half diminished.

Every scale has an explicit interval formula, spelled notes, descriptive text and a full guitar-neck map through fret 24. New seven-note modes also use the bounded, complete 3NPS generator. Six- and eight-note collections use the full map; their interface explains that dedicated practice patterns are not included.

## Resolved reference cases

| Chord | Preferred exact same-root choice |
| --- | --- |
| C7♯9 | C half–whole diminished |
| C7♭9 | C Phrygian dominant; also half–whole diminished |
| C7♯11 / C9♯11 | C Lydian dominant |
| C7♭13 | C Mixolydian ♭6; also Phrygian dominant |
| Cdim7 | C whole–half diminished |
| Cm7♭5 | C Locrian ♮2; also Locrian and Locrian ♮6 |

Single-chord result ranking and the per-chord shortlist share explicit quality preferences. These are reference defaults, not a determination of tonal center. Multi-chord coverage and cadence logic continue to use complete symbolic chord tones, including slash basses.

## Spelling and interpretation

Altered uses functional dominant spelling: 1, ♭9, ♯9, 3, ♯11, ♭13, ♭7. This preserves its pitch collection while showing the major third and named tensions rather than a theoretical flat fourth. Half–whole diminished follows the same dominant convention and includes 5 and 13. Whole–half diminished uses 6 in the scale; its text explains the enharmonic relationship with a diminished chord’s double-flat seventh. Ultralocrian retains its theoretical double-flat seventh. Explicit roots are preserved; inferred roots retain readable-spelling selection.

Altered does not contain a perfect fifth. It therefore does not become an exact same-root match for a complete C7♯9 formula just because a selected guitar grip omits G. Whole tone likewise does not cover an unaltered perfect fifth. Contextual altered-scale substitutions and arbitrary combined altered chord symbols remain outside this change.

Symmetric collections and the functionally spelled Altered scale do not receive inferred seven-degree triad rows. All other heptatonic catalog entries retain correct ordered triad rows. Match empty-state wording now describes a catalog limit, and extension-bearing chords are labelled “Chord tones” rather than implying every extension is a settled landing note.

Primary references checked:

- [Berklee / Gary Burton: jazz improvisation scales](https://online.berklee.edu/takenote/jazz-improvisation-10-scales/): functional altered tensions and the diminished step orders.
- [University of Puget Sound: jazz scales](https://musictheory.pugetsound.edu/mt21c/JazzScales.html): chord-scale vocabulary and enharmonic conventions.
- [Open Music Theory: chord-scale theory](https://viva.pressbooks.pub/openmusictheory/chapter/chord-scale-theory/): scale collections and contextual harmonic choices.

## Verification

- Independent music reviewer authored seven new tests, supplementing the existing 18. All 25 pass.
- Authored spelling and pitch-set fixtures, parent-mode relationships, symmetric cycles and transposition counts, and complete bounded 3NPS patterns checked across all 17 roots.
- All 544 combinations of selectable root and supported chord quality have at least one exact same-root option. This does not imply every progression or slash-bass addition fits one collection.
- Independent UI sweep checked all 476 root/scale combinations for pattern availability and related-chord ordering.
- Typecheck, lint and production build pass. Build retains existing Vinext static-classification and Node deprecation notices.
- Live browser: C7♯9 → C half–whole diminished → eight-note full map → frets 19–24 at 320px → return preserves chord input. Dynamic catalog visible; no 3NPS control offered for the eight-note scale. Mobile evidence: scale-coverage-mobile.jpg.
- Live browser after build: C9♯11 selects C Lydian dominant; clicking fret 8 enters a complete 3NPS pattern spanning frets 8–14.
- Reviewed matching plus color/per-chord computation: median 2.35ms / p95 2.60ms for a typical four-chord progression on this host; mobile performance is unmeasured.

No deployment was performed. Physical fingering comfort, listening judgments and exhaustive scale vocabulary are not established by deterministic pitch tests.
