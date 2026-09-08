# Advanced chord reference

## Symbol and voicing are separate

The full chord formula remains the basis of scale matching. A selected guitar grip has its own sounding-note set. Missing formula tones are listed explicitly; the rootless label is derived from the actual notes, not a template name. Playing fewer tones does not silently change the chord symbol or make Match use a smaller pitch set.

The new catalog includes dominant, major and minor 11ths and 13ths, plus dominant ♭9, ♯9, ♯11 and ♭13, dominant 9♯11, major 7♯11 and major 9♯11. Existing ninth chords also gain practical reduced and rootless shapes.

Full formulas stack thirds through the named extension. For example, C13 contains C E G B♭ D F A; a practical rooted grip may play C E B♭ A, explicitly omitting G, D and F. Minor 13 uses a natural 13 with a minor third and minor seventh. It is not automatically a natural-minor scale chord.

Natural 11 and a major third can be a dense combination. The major-third 11th recipes omit the third explicitly; minor 11 retains its minor third. Altered recipes retain the specified altered tone. The 9♯11 recipes retain both named tensions.

## Guitar constraints

Compact recipes use adjacent strings, at most four distinct sounding tones, frets 0–24, at most a three-fret difference between pressed notes, and at most a four-fret total span including open strings. Complete reviewed templates remain available where the full formula fits. Six-string guitar cannot sound seven distinct C13 formula tones simultaneously.

Rootless shapes are contextual voicings: a bass player, another instrument, or the musical context can establish the root. They are labeled with their actual bass rather than numbered as complete-chord inversions. The reference does not prescribe finger assignments or guarantee comfort for every hand.

## Conventions and sources

[Open Music Theory: Chord Symbols](https://viva.pressbooks.pub/openmusictheory/chapter/chord-symbols/) explains extension symbols and implied lower chord members. [Open Music Theory: Jazz Voicings](https://viva.pressbooks.pub/openmusictheory/chapter/jazz-voicings/) distinguishes chord identity from voicing omissions. [Macalester: Extended Tertian Chords and Altered Dominants](https://pressbooks.macalester.digital/multimodalmusicianship/chapter/extended-tertian-chords-altered-dominants-2/) gives practical extended-chord reductions, including dominant elevenths without the third.

Omission choices in this catalog are explicit implementation conventions, not a claim that every performance uses the same notes. Arbitrary combined alterations and an ambiguous generic “alt” symbol remain outside the supported syntax.

## Verification — 7 September 2026

Independent reviews covered formulas, parser aliases, omission recipes, metadata and the interface. All 18 tests passed, including authored rooted/rootless shapes, preserved alterations, exact omissions and symbolic matching. A separate sweep checked 544 root/quality cases and 22,002 voicings: actual MIDI bass, spelling, complete sounded/omitted partitions, bounds, deduplication and compact stretch constraints. 848 shapes reach fret 24.

Browser verification: C7♯9 preserves D♯; C13 displays its full seven-note formula independently of a four-note grip; E-bass rootless C13 explicitly lists missing C/G/F and displays no root markers. All chord tones restores the full formula and Chord shapes restores the selected subset. C11 explicitly omits E/G. At 320px, client and scroll widths both equal 305px; omission text and controls remain readable and fret 24 stays accessible. See advanced-mobile.jpg.

G13 → Cmaj7 matches the full C-major collection and receives a qualified cadence explanation; its chord-shape preview and nested returns work. G7(b9) → Cm parses and matches C harmonic minor. Browser error logs were empty. These browser journeys used the development preview; physical-device and screen-reader listening checks remain outstanding.

Independent unthrottled Node generation sample: median 0.29ms, p95 0.68ms. These are calculation timings, not measured mobile end-to-end latency. The optional blues-color heuristic still targets its original plain 7/9 progression families; it was not broadened to every extended/altered dominant.

Final typecheck, lint, all 18 music tests, production build and diff whitespace checks passed. No deployment was performed.
