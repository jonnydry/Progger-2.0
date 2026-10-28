# Stash

Stash keeps scales, chords, and phrases on this device. From an empty tray you can bookmark the scale you are looking at and open that bookmark later.

## Sub-features

- `stash-empty` shows `Nothing saved yet` before the first save.
- `stash-bookmark` saves the default A Dorian view as `A Dorian · form 4`.
- `stash-reopen` returns to A Dorian after you have moved to C Dorian.
- `stash-persist` shows the same row after reload, without the save banner.

## How to get to it (user POV)

- Choose `Stash` in the header.

## Driving it with verify-progger

Preconditions:

- Doctor reports the verify origin.
- Explore is the default A Dorian connected form.
- The browser context has an empty stash, so the button name is `Stash`.

Run `node .cursor/skills/verify-progger/bin/drive.mjs --feature stash`. The command does the following.

- **Empty.** Choose `Stash`. The dialog `Stash` shows the heading `Nothing saved yet`.
- **Bookmark.** Choose `Bookmark this scale`. The dialog says `Saved to stash.` and includes `A Dorian · form 4`.
- **Leave the view.** Close the dialog and set `Root note` to `C`. The heading is `C Dorian guitar reference`.
- **Reopen.** Open `Stash` and choose `Open` on the saved scale. The dialog closes and the heading is `A Dorian guitar reference`.
- **Reload.** Reload, then open `Stash`. The row `A Dorian · form 4` remains. The banner `Saved to stash.` does not. `localStorage` key `progger.tray.v1` contains `A Dorian`.
- **Proof.** `evidence/stash/01-empty.png` shows the empty tray. `03-reopened.png` shows A Dorian after Open. `04-after-reload.png` and `04-after-reload.aria.txt` show the row still there.

## Gotchas

- After the first save the button name is `Stash, 1 saved`, not `Stash`.
- `A Dorian · form 4` is the default connected form, the one whose low E start is fret 5. A different form would bookmark a different name.
- The save banner is only for that visit. Reload keeps the row and drops the banner.
- `Open` on a scale bookmark closes Stash and restores Explore. It does not generate a phrase.
- Storage is `progger.tray.v1` for this origin and this browser context.
