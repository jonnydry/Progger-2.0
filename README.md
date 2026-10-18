# Progger 2.0

A guitar scale, mode and chord reference with a phrase generator, a practice
drone and a pixel frog guitarist. Everything runs in your browser: no account,
no AI credential and no music database.

**Live at [progger.studio](https://progger.studio).**

## What it does

**Explore scales and chords**

- 28 scales and modes in every key: the major, harmonic-minor and jazz
  melodic-minor modes, pentatonic and blues, whole tone and both diminished
  scales. See [scale coverage](docs/scale-coverage.md).
- A continuous neck up to fret 24 with connected 3-notes-per-string and
  2-notes-per-string shapes, overlap with neighboring shapes, adjustable view
  width, a whole-neck overview, a left-handed view and text equivalents. See
  [connected neck](docs/connected-neck.md).
- 32 chord qualities, including 11ths, 13ths and altered tensions, with
  complete, reduced and rootless guitar voicings. See
  [advanced chords](docs/advanced-chords.md).
- Hear any voicing exactly as drawn: a short synthesized strum that keeps the
  inversion, muted strings and omitted notes. See
  [voicing audio](docs/voicing-audio.md).

**Match a progression**

- Type chords (slash basses included) and Progger lists the scales that fit,
  grouped across the whole progression, with an optional home note and a
  palette per chord. Up to 32 chords per progression.

**Practice**

- **Phrase generator:** builds a 2- or 4-bar guitar line over the selected
  scale and chord, then plays it and shows it on the neck. Tempo runs from 40
  to 240 BPM, with adjustable swing and optional looping. Phrases are made by
  seeded rules in the browser with no network calls.
- **Drone:** holds the key under your playing. Choose Reed or Bow (both
  synthesized with Web Audio) or Cello (CC0 samples), and set the volume.
- **Practice tray:** save phrases, scales and chords, reopen them later, and
  download a saved phrase as ASCII guitar tab or a MIDI file.

**Scenes**

- Three illustrated scenes (The Pond, Tidepool and Twilight), each with a day
  and night version. The choice is saved on your device and the transition
  respects reduced-motion settings. See [scenes](docs/scenes/README.md).

Progressions, alternate tunings, accounts and offline install are not built
yet. Some movable shapes need wide stretches. Diagrams show positions, not
prescribed fingerings.

## Run it locally

Requires Node 22.13 or later.

```sh
npm ci
npm run dev
```

To try the production build locally:

```sh
npm run build
npm start -- --port 3000 --ip 127.0.0.1
```

If a system libvips install makes Sharp try a native build, use
`SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm ci`.

## Checks

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

`npm test` uses Node's built-in test runner. Some tests drive real browsers
through Playwright; install them once with
`npx playwright install --with-deps chromium firefox`. The full suite takes
a few minutes.

## Project layout

- `app/`: the page, layout and styles
- `components/`: React UI (neck, voicings, phrase panel, drone, practice tray)
- `lib/`: browser-independent music logic (`music.ts`, `harmony.ts`,
  `phrase.ts`, `drone.ts`) and audio
- `tests/`: unit and browser tests
- `docs/`: design notes and verification records

Built with React, TypeScript and Vite through [vinext](https://github.com/cloudflare/vinext),
and deployed on Vercel. See [Vercel deployment](docs/vercel-deployment.md).

## Credits

- Cello drone: excerpts of the Versilian Studios
  [VSCO 2 Community Edition](https://versilian-studios.com/vsco-community/)
  cello section, CC0 1.0. See `public/audio/drone/LICENSE.md`.
- Fonts: [Maple Mono](https://github.com/subframe7536/maple-font) v7.9
  (SIL Open Font License 1.1, see `public/fonts/maple-mono/`) and
  [Silkscreen](https://fonts.google.com/specimen/Silkscreen) (SIL Open Font
  License 1.1, loaded through Google Fonts).
- Scene artwork and the frog mascot were generated for this project. Prompts
  are recorded in `docs/`.

## License

Progger is released under the [MIT License](LICENSE).

Third-party assets keep their own licenses:

- Maple Mono fonts: SIL Open Font License 1.1, see
  [`public/fonts/maple-mono/LICENSE.txt`](public/fonts/maple-mono/LICENSE.txt).
- Cello drone samples: CC0 1.0, see
  [`public/audio/drone/LICENSE.md`](public/audio/drone/LICENSE.md).
