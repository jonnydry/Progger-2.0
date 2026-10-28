# Progger verification map

This directory is the maintained source for verifying the user-facing behavior of Progger. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch Progger with `node .cursor/skills/verify-progger/bin/launch.mjs`.
- The app is usable at `http://127.0.0.1:4173/` unless `VERIFY_APP_PORT` set another port.
- Run `node .cursor/skills/verify-progger/bin/doctor.mjs` and require exit 0.
- Drive only the instance this launch started. This checkout can run one `vinext dev` server.
- Each feature drive opens a new browser context. Stash and phrase history from an earlier feature are not there.
- The default Explore page is A Dorian, connected form starting at fret 5, notes shown, right-handed, dark color scheme.

## Driving conventions

- Start every recipe from that baseline unless its preconditions say otherwise.
- Prefer ARIA roles and accessible names over coordinates.
- Wait until `networkidle` before the first click. The server-rendered controls do not respond before hydration.
- Run the feature with `node .cursor/skills/verify-progger/bin/drive.mjs --feature <id>`.
- Keep the quoted note names unchanged, including `F♯`, `♭`, and `·`.
- Cleanup stops the server. It does not delete `/tmp/progger-verify/<run-id>/evidence/`.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an ARIA snapshot and a screenshot that shows the Progger header.
- A reload proof reads the screen again and the `localStorage` key the action writes.
- Record the feature id with every artifact. Drive writes that into `result.json`.
- Report an unreachable path with the command you ran and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short ids with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-progger` starts with `Preconditions:` and uses labeled bullets that pair each user action with the command and the observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Explore](./explore.md) covers the default scale page, the root combobox, and the Chords tab.
- [Phrases](./phrases.md) covers opening the generator, a new line, playback status, and saving it to Stash.
- [Match chords](./match.md) covers the hash and the nav link, the Am D starter, the fretboard handoff, and an invalid chord name.
- [Stash](./stash.md) covers the empty tray, bookmarking A Dorian, reopening it, and seeing it after reload.
