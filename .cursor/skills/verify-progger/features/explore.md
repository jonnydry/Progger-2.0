# Explore

Explore shows a guitar scale or chord on one neck from the open strings through fret 24. The default page is A Dorian.

## Sub-features

- `explore-open` lands on A Dorian from `#explore`, from the Explore link, and from `/`.
- `explore-root` changes the scale root to F♯ and shows that spelling on the neck.
- `explore-chords` opens C Major shapes and hides the drone toggle.
- `explore-return` keeps the F♯ scale root when you come back from Chords.

## How to get to it (user POV)

- Open the app. The first screen is Explore.
- Choose `Explore` in `Main navigation`.
- Open `#explore`.

## Driving it with verify-progger

Preconditions:

- Doctor reports the verify origin.
- The browser context has no saved stash.

Run `node .cursor/skills/verify-progger/bin/drive.mjs --feature explore`. The command does the following.

- **Hash entry.** Load `/#explore`. The link `Explore` has `aria-current="page"`. The heading is `A Dorian guitar reference`. The combobox `Root note` shows `A`. The neck image name includes `A degree 1`, `C degree ♭3`, `F♯ degree 6`, and `G degree ♭7`.
- **Nav entry.** Load `/#match`, then choose `Explore`. The heading is `A Dorian guitar reference` again.
- **Bare URL.** Load `/`. The heading is still `A Dorian guitar reference`.
- **Change root.** Choose `F♯` in the `Root note` list. The heading is `F♯ Dorian guitar reference`. The neck image name starts `F♯ Dorian notes:` and includes `F♯ degree 1`, `G♯ degree 2`, `A degree ♭3`, `C♯ degree 5`, `D♯ degree 6`, and `E degree ♭7`. The button `Drone, off, Reed` is present.
- **Open chords.** Choose `Chords`. The heading is `C Major guitar reference`. The neck image name includes `C Major sounding notes: C degree 1, E degree 3, G degree 5`. The button `Drone, off, Reed` is gone.
- **Return.** Choose `Scales & modes`. The heading is `F♯ Dorian guitar reference` and `Root note` shows `F♯`.
- **Proof.** `evidence/explore/02-f-sharp-dorian.png` and `02-f-sharp-dorian.aria.txt` show F♯ Dorian. `03-c-major.png` shows C Major. `04-back-to-f-sharp.png` shows the scale root still F♯.

## Gotchas

- `Root note` is a combobox. A click before hydration does not open the list.
- The accessible name stays `Root note`. The visible value is the note.
- The chord root stays C when you change the scale root. Chords opens on C Major.
- Reload returns to A Dorian. The root choice is not stored.
- The drone toggle is on the scales practice bar and is absent on Chords. Hearing the drone is not this feature.
- Frets 0 through 24 are one neck. Do not look for a separate phone fret count.
