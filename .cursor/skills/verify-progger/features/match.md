# Match chords

Match chords takes chord names and lists scales that contain those tones. A result can open that scale on the Explore neck and come back with the progression still filled in.

## Sub-features

- `match-open` reaches Match from `#match` and from the `Match chords` link.
- `match-starter` fills Am D with home A and shows three collections.
- `match-fretboard` opens A Jazz melodic minor on the full neck and returns to Am D.
- `match-invalid` keeps `Cwat` and explains the unsupported quality.

## How to get to it (user POV)

- Choose `Match chords` in `Main navigation`.
- Open `#match`.

## Driving it with verify-progger

Preconditions:

- Doctor reports the verify origin.
- The progression field is empty.

Run `node .cursor/skills/verify-progger/bin/drive.mjs --feature match`. The command does the following.

- **Hash entry.** Load `/#match`. The link `Match chords` has `aria-current="page"` and the heading is `Match your chords`.
- **Nav entry.** Load `/`, then choose `Match chords`. The heading `No need to know the key.` is visible.
- **Starter.** Choose `A brighter minor sound`. Recognized chords read `Am D`. The result count is `3 different collections contain all your chord tones · Am → D`. The cards are `A Dorian`, `A Jazz melodic minor`, and `A Dorian ♭2`. The home summary includes `Home note` and `A`.
- **Fretboard.** On the `A Jazz melodic minor` card, choose `Try on the fretboard`. The heading is `A Jazz melodic minor guitar reference`. The banner includes `Back to your chords` and `Am → D`. The neck image name includes `A degree 1`, `C degree ♭3`, `F♯ degree 6`, `G♯ degree 7`, and `All note locations through fret 24`.
- **Return.** Choose `Back to your chords`. The textbox `What are you playing?` is still `Am D`.
- **Invalid name.** Choose `Clear`, then type `Cwat`. The error is `“Cwat” has an unsupported chord quality. Use the chord builder to see supported choices.` The heading `Let’s get your chords in place.` is visible and no scale cards remain.
- **Proof.** `evidence/match/01-starter.png` shows the three cards. `02-on-neck.png` shows Jazz melodic minor. `03-invalid.png` shows the error.

## Gotchas

- The empty error output and the result count are both status roles. Read the result count by its text, `3 different collections contain all your chord tones`.
- `A brighter minor sound` sets the chords to `Am D` and the home note to A. Do not substitute a different starter and call this verified.
- `Try on the fretboard` for Jazz melodic minor opens the full neck, not a connected form.
- The app uses curly quotes in the `Cwat` error and a curly apostrophe in `Let’s`.
- Match stays mounted while Explore is showing, so the progression is still there on return.
