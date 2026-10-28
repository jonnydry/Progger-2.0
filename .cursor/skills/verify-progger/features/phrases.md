# Phrases

Phrases builds a guitar line over the current scale, shows it under the neck, plays it, and can save it on this device.

## Sub-features

- `phrases-open` opens the panel on A Dorian with a numeric seed and a staff.
- `phrases-new` replaces the seed and keeps a plan line.
- `phrases-play` changes the status to `Playing this phrase.` and the button to `Stop`.
- `phrases-save` stores `A Dorian · 2 bars` in Stash and shows it again after reload.

## How to get to it (user POV)

- On Explore, choose `Phrases` under the neck.

## Driving it with verify-progger

Preconditions:

- Doctor reports the verify origin.
- Explore is A Dorian and the phrase panel is closed.
- The browser context has an empty stash.

Run `node .cursor/skills/verify-progger/bin/drive.mjs --feature phrases`. The command does the following.

- **Open.** Choose `Phrases`. The region `Phrase practice` appears, the heading is `Phrase`, and the text includes `Over A tonic in A Dorian.` The `Seed` textbox is digits. `2 bars` is pressed. The status is `Same seed replays this phrase.` A staff is visible in the phrase tab host.
- **New phrase.** Choose `New phrase`. The seed number changes. A visible plan line still contains `lands on the`.
- **Play.** Choose `Play`. The status becomes `Playing this phrase.` and the button name becomes `Stop`. Choose `Stop`. The button name returns to `Play`.
- **Save.** Choose `Save to stash`. The text `Saved to stash.` appears. Open `Stash`. The dialog includes `A Dorian · 2 bars`.
- **Reload.** Reload and open `Stash` again. The same row is there. `localStorage` key `progger.tray.v1` contains `A Dorian`.
- **Proof.** `evidence/phrases/03-playing.png` shows the playing status. `05-stash-after-reload.png` shows the saved row.

## Gotchas

- Phrases is not in the main navigation. It is on Explore, under the neck.
- The panel loads in a separate chunk. Wait for the `Phrase` heading and the staff.
- The seed is random. Assert that it changes, not a fixed value.
- The button label `Saved ✓` lasts about 1.5 seconds. The durable text is `Saved to stash.` and the stash row.
- `Playing this phrase.` means the player started. It does not prove a speaker made sound. The sentence `Audio couldn’t start. Tap Play to try again.` fails this step.
- The save belongs to this browser context and this origin.
