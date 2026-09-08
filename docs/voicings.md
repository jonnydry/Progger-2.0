# Chord voicings and inversions

Historical record of the first expansion. The later [advanced-chord expansion](advanced-chords.md) adds 11ths, 13ths, altered tensions and explicitly labeled reduced/rootless ninth shapes, superseding the coverage limits below.

The chord reference keeps a single playable shape on the full 0–24 neck. Bass-note buttons filter the library, Previous/Next moves through the filtered shapes, and Browse exposes the full filtered list. Selecting a list item collapses it and returns keyboard focus to its summary. Root and quality changes reset the filter; switching to Any preserves the current shape.

Each voicing carries its sounding bass, correctly spelled as a chord member. Bass means the lowest absolute pitch, not the lowest fret or the first displayed string. Conventional triads and seventh chords have numbered inversion labels; suspended and extended structures use plain bass-degree descriptions where an inversion ordinal would be misleading. Chord previews opened from a slash-chord context select the requested bass when a complete shape exists.

The library combines validated full grips and compact shapes on adjacent strings. Compact shapes contain each required chord tone once, use at most four strings, stay within a three-fret difference between pressed notes, and a four-fret total difference including open strings. Standard tuning and frets 0–24 are mandatory. Duplicate fret arrays are removed.

Five-note ninth chords keep complete full-grip templates. They do not silently become rootless or fifth-less shapes. Compact enumeration is not exhaustive of every playable guitar voicing: spread voicings, omitted-tone jazz grips and finger assignments are outside this pass. A complete pitch set and a limited fret span do not establish comfort for every player's hand; full grips may require a barre.

## Verification — 7 September 2026

- Independent musical review: 14 authored grip fixtures, including C/E, C/G, seventh inversions and open D/F♯; a crossed-register fixture verifies minimum-MIDI bass detection.
- Across 17 root spellings × 19 qualities, all 7,227 shapes preserve exact pitch coverage, bass spelling, inversion labels, fret bounds and deduplication. Compact enumeration was independently checked for six qualities. C major has 33 shapes; C major seventh has 36.
- Independent interface review corrected excess vertical space, catalog focus restoration, and unsupported slash-bass labels.
- Browser journeys: C/E first inversion, C7/B♭ third inversion, bass-filter reset on quality change, selection from the catalog, high-fret selection, and nested Match → D/F♯ → scale → Match returns. C9/E explicitly reports no complete shape and labels its fallback as C9.
- At 320px the document client/scroll widths both equal 305px. Selecting the C/E shape at 22–24 collapses the catalog, restores focus to Browse, and displays frets 20–24. Screenshot: inversions-mobile.jpg.
- Typecheck, lint, musical tests, production build and diff whitespace checks pass. Browser journeys used the development preview; physical-device and screen-reader listening tests remain outstanding.
- Independent unthrottled Node sample: generation median 0.197ms, p95 0.388ms. These are local calculation timings, not measured mobile end-to-end latency.
