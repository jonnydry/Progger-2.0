# Progger — bold visual exploration

Status: the user selected **2 — Night Swim**. Implemented in the existing application and verified locally. The earlier Quiet Cabinet design is historical context, not the current direction.

The user requested genuinely new designs in the spirit of elegant simplicity, premium production value, immediate musical utility, and Progger's arcade/frog personality. This round varies visual system and product composition, not just palette. Images are concept references, never the source of musical coordinates.

## Authoritative displayed order

The following order is based on the three generated images actually displayed in the conversation on 2026-09-06. It supersedes the earlier round for any subsequent bare numeric selection.

1. **Field Notes** — `/home/jonnyd/.codex/generated_images/01a074be-236c-7e01-81e6-fa4975602a03/exec-adac3be4-683e-4e95-ab59-de20b957c973.png`
2. **Night Swim** — `/home/jonnyd/.codex/generated_images/01a074be-236c-7e01-81e6-fa4975602a03/exec-dbcd0df8-2353-4ddc-82d8-6ec46c585682.png`
3. **Play Desk** — `/home/jonnyd/.codex/generated_images/01a074be-236c-7e01-81e6-fa4975602a03/exec-0f921419-9555-434b-99a3-557097d7dce3.png`

Generated independently with the built-in Image Gen tool. All three received the existing UI screenshot and real mascot as image references, explicitly as functional/brand context rather than a layout constraint. Target was a single 1440×1024 desktop screen per concept. These are preview assets; originals remain in the generated-image directory.

## Shared brief

Focused A Dorian scale explorer, notes A B C D E F♯ G and degrees 1 2 ♭3 4 5 6 ♭7. Same three-notes-per-string pattern starting at low E fret 5 for honest comparison. Visible focused range 3–12 with access to the full 0–24 neck, clear Full neck/3NPS distinction, Notes/Degrees, standard tuning, and a quiet chord disclosure. Maintain responsive control access and pannable neck. No feature inventory, sign-in, AI chat, analytics, pricing, or invented playback.

## Adversarial review takeaways

Independent product review: Field Notes offers editorial clarity; Night Swim gives the most atmospheric Progger world; Play Desk makes the strongest structural change and is a promising daily-use foundation. These are judgments, not proof of suitability; the user chooses the direction and the build must be tested.

- **Field Notes:** preserve typography and the contrasting neck plate. Remove duplicate root/scale controls if the title is editable; simplify navigation without losing keyboard/touch alternatives. Keep the frog's visual style coherent. Its illustrated viewport highlight and nut-like boundary must be replaced with engine geometry.
- **Night Swim:** keep the scene peripheral, with crisp unglowing musical data. Clarify the title's edit affordance. Adapt the desktop control dock into compact mobile rows. Remove hollow circles beside each string: they misleadingly imply open-string notes in this fretted pattern.
- **Play Desk:** keep the selector rail and broad playing surface. Remove the duplicated mascot/tuning inventory and make the starting-fret action evident. Collapse the rail to compact controls on phones. Correct illustrated inlay positions, label gutter, nut-like boundary, and overview range.

Independent musical review checked all three images against an authored fixture. The intended 18 note positions and three roots are correct in each. Implementation must preserve that fixture and derive every fret line, inlay, note, and viewport extent from deterministic data; decorative mock geometry is not authoritative.

| String, low to high | Frets | Notes |
| --- | --- | --- |
| E | 5, 7, 8 | A, B, C |
| A | 5, 7, 9 | D, E, F♯ |
| D | 5, 7, 9 | G, A, B |
| G | 5, 7, 9 | C, D, E |
| B | 7, 8, 10 | F♯, G, A |
| e | 7, 8, 10 | B, C, D |

Roots are low E5, D7, and B10. A focused viewport beginning at fret 3 has no nut or open-string markers. Standard inlays in that range are 3, 5, 7, 9, and double 12.

## Implementation outcome

Night Swim now uses midnight navy, mint Silkscreen titles and Maple Mono supporting typography, a generated peripheral pond scene, and a focused neck with its controls in a responsive dock underneath. Default is the authored A Dorian pattern starting at fret 5. Full neck still exposes all 25 positions 0–24; pattern and voicing views enlarge a movable window. Notes, degrees, exact chord voicings, custom selectors, contextual matching, and complete return navigation are retained.

Independent music and interface reviewers challenged the implementation. Resolved continuous-ruler state, resize restoration, grid contrast, short desktop control visibility, touch targets, and a tablet overflow. No remaining blocker found. Browser checks span 320–1487px; production build, typecheck, lint, and musical tests pass. See `app/design-qa.md` for evidence, intentional adaptations, and remaining verification limits. Local preview is `http://localhost:3000/#explore`. Publishing is a separate next step when requested.
