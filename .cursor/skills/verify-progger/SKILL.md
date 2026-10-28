---
name: verify-progger
description: "Drive local Progger in a headless browser across Explore, Phrases, Match chords, and Stash, and capture screenshots plus accessibility snapshots. Use when changing those screens or when asked to verify Progger."
---

# Verify Progger

Progger is a browser guitar reference. The page you drive is `app/page.tsx`. Explore and Match chords are the main navigation links. Phrases sits under the neck on Explore. Stash is the header button that keeps phrases and bookmarks in `localStorage` for that browser profile. There is no account and no server database. Production at `https://progger.studio` is the same client.

Run one verify instance. A second `vinext dev` in this checkout is refused by `.vinext/dev/lock.json`. Do not kill a server this skill did not start.

The dev log prints `Sites local sign-in: seedy@sites.test`. That line comes from the sites Vite plugin. Explore, Phrases, Match chords, and Stash do not ask you to sign in.

## Launch

From the repo root:

```bash
node .cursor/skills/verify-progger/bin/launch.mjs
```

Launch runs `npm run dev -- --hostname 127.0.0.1 --port 4173`. Override the port with `VERIFY_APP_PORT` before launch. If that port is taken, launch exits and names the listener. It does not free the port.

Ready means `GET http://127.0.0.1:4173/` returns 200 and the HTML contains `<title>Progger`, `A Dorian guitar reference`, and `aria-label="Guitar reference explorer"`. The `Local:` log line only means the process is listening. The first request compiles the page, so ready can take a while. Launch waits up to 120 seconds.

State is written outside the repo at `/tmp/progger-verify/<run-id>/state.json`. The pointer is `/tmp/progger-verify/current.json`. Evidence for that run is `/tmp/progger-verify/<run-id>/evidence/`. Server output is `server.log` in the run directory.

If `current.json` already names a live verify pid, launch exits. Drive that instance or run cleanup first.

`npm test` reuses a live vinext lock when one exists. Run cleanup before the suite when you want the tests to start their own server.

## Doctor

```bash
node .cursor/skills/verify-progger/bin/doctor.mjs
```

Doctor is read-only. It exits 0 only when all of these are true.

- The current state exists and is not stopped.
- The launch pid is alive, and its cwd is this repo.
- `package.json` version and `git rev-parse HEAD` still match the state.
- `.vinext/dev/lock.json` names a live process that launch started, on the same origin.
- The process listening on the verify port is that launch pid or a descendant. Doctor uses `ss` when it can see pids, and `/proc` otherwise.
- `google-chrome` is on `PATH`.
- `GET /` still returns the Explore HTML described above.

On failure, doctor prints each problem. Run it before a drive whenever the app looks wrong.

## Drive

```bash
node .cursor/skills/verify-progger/bin/drive.mjs --feature explore
```

Features, in order when you omit `--feature`: `explore`, `phrases`, `match`, `stash`.

Drive refuses to start when doctor fails. Each feature gets a new headless Chrome context through Playwright (`channel: "chrome"`), viewport 1280x900, dark color scheme, and reduced motion. The context starts with empty `localStorage`, so one feature cannot see another feature's stash.

Browser requests whose host is not `127.0.0.1`, `localhost`, or `::1` are aborted and fail the feature. Same-origin HTTP errors and console errors fail it too.

Open the app with `waitUntil: 'networkidle'` before clicking. The server HTML paints Explore immediately, and a click before hydration does not open the root list.

Selectors and expected text live in `features/`. Follow a feature file rather than inventing a shorter path. The root control is the combobox named `Root note`.

## Evidence

Artifacts go to the `evidenceDir` in the state file, under `/tmp/progger-verify/<run-id>/evidence/`. Cleanup does not delete that directory.

Each feature writes screenshots of the action and the resulting state, an ARIA snapshot of the resulting state, `console.json`, `network.json`, and `result.json`. `evidence/summary.json` lists pass or fail per feature. Drive exits 1 when any requested feature failed or the browser tried to leave loopback.

A proof shows the user action and the resulting state. Changing the root to F♯ is not done until the heading reads `F♯ Dorian guitar reference` and the neck text starts `F♯ degree 1`. Saving a phrase is not done until Stash shows `A Dorian · 2 bars` after reload. Bookmarking a scale is not done until Open restores `A Dorian guitar reference`.

`Playing this phrase.` means the phrase player started. It does not by itself prove a speaker made sound. The audio-error sentence is a failure of the play step, not a pass.

## Cleanup

```bash
node .cursor/skills/verify-progger/bin/cleanup.mjs
```

Cleanup reads the current state and signals that process group. It sends `SIGTERM`, then `SIGKILL` if the pid is still alive after a few seconds. It does not kill by process name, and it does not remove evidence. After cleanup, `evidence/summary.json` is still at the path cleanup prints, and doctor fails because the run is stopped.

## Helpers

| Command | What it does |
| --- | --- |
| `node .cursor/skills/verify-progger/bin/launch.mjs` | Start `npm run dev` on 127.0.0.1:4173 and wait for the Explore HTML |
| `node .cursor/skills/verify-progger/bin/doctor.mjs` | Read-only check that this run is still the live server |
| `node .cursor/skills/verify-progger/bin/drive.mjs --feature <id>` | Browser proof for one mapped feature, or all four when the flag is omitted |
| `node .cursor/skills/verify-progger/bin/cleanup.mjs` | Stop the process group this launch started |

Feature ids are `explore`, `phrases`, `match`, and `stash`. The recipes are `features/explore.md`, `features/phrases.md`, `features/match.md`, and `features/stash.md`.

When these screens change, run `/maintain-verification-skill` and drive every feature file again.
