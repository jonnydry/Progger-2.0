# Progger redesign — option 1 implemented

User direction: less crowded, sleek, simple, attractive, elegant simplicity with thoughtful arcade flourishes. Existing musical behavior should be preserved.

Three ImageGen art-direction mocks were displayed in this exact order on 2026-09-06:

1. Quiet Cabinet — original generation file (not committed)
2. Pocket Console — original generation file (not committed)
3. Cartridge Studio — original generation file (not committed)

These are visual concepts, not authoritative musical diagrams or accepted new feature requirements. The user selected option 1 (Quiet Cabinet). It is implemented in the existing app; local verification is documented in app/design-qa.md. The private site has not yet been updated with this redesign.

## Independent review findings

Design reviewer identified duplicated identity (workspace title, reference tabs, selected title), pervasive green boxed layers, and competing theory cards as main sources of crowding. Prefer one selection/title hierarchy, unboxed note/degree strip, dominant neck, lightweight related chords, and a single theory disclosure. Preserve visible Full neck/practice pattern and fret navigation. Handedness can move to an explicitly labeled Display control.

Mock 1 review: reject generated 3/4/5 notes-per-string controls and unexplained corner icon; restore actual Full neck/3NPS/2NPS behavior, root legend and low-E starting fret selection. Reduce oversized title to approximately 56px desktop and 32px phone. All mocks contain illustrative fret/label inconsistencies: implementation must use existing deterministic engine, never copy generated coordinates. Ensure contrast and remove decorative texture from note data.

Matching redesign: broad entry and ranked list, optional examples and home note; disclose per-chord alternatives when shared collections exist but show them directly when no shared collection exists. Preserve recognized tokens, coverage labels, modal ambiguity, original input, catalog limits, and outside-palette warnings.

Music reviewer invariants: F-sharp major E-sharp, G-flat major C-flat; C-major 3NPS start8 has 18 exact positions; pentatonic2NPS and blues Full neck; frets0/24 accessible at320px and left-handed; Am–D retains Dorian and jazz melodic minor; A7–D7–E7 has no exact shared collection with separate blues guidance; A7 over A-minor-blues exposes C-sharp; invalid input suppresses stale results and back navigation preserves input. Existing minor wording issue: chord-reference legend says Scale note; use context-appropriate Note/Chord tone during redesign.
