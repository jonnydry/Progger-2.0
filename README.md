# Progger 2.0

A guitar scale, mode, and chord reference with a pixel frog guitarist. Reference and matching calculations run locally in the browser.

The [project plan](docs/project/PROGGER_PLAN.md) and [design direction](docs/project/DESIGN_EXPLORATION_02.md) record the product decisions behind this version.

## Run

Use Node 22.13 or later. From this directory:

```sh
npm install
npm run dev
```

To inspect the production output locally, run `npm run build` followed by
`npm start -- --port 3000 --ip 127.0.0.1`. Preview logs and local runtime state
stay inside the project unless explicitly overridden in the environment.

If a system libvips installation causes Sharp's optional installation to attempt a native build, use its documented bundled-library setting: `SHARP_IGNORE_GLOBAL_LIBVIPS=1 npm install`.

The Sites scaffold uses React, TypeScript, and Vite through Vinext. Source is in `app/page.tsx`, feature components in `components/`, and browser-independent musical code in `lib/music.ts` and `lib/harmony.ts`. No AI credential or music database is required.

## Checks

```sh
npm run typecheck
npm test
npm run lint
npm run build
```

The tests use Node's built-in runner and independent pitch/fingering fixtures. Lint excludes untouched generated component-library source; intentional ARIA groups, graphical diagrams, and a keyboard-scrollable fretboard have narrowly scoped semantic-rule exceptions. Type checking still covers all TypeScript source.

## First release

- Twenty-eight scales and modes across all roots: all major, harmonic-minor and jazz melodic-minor modes, pentatonic/blues, whole tone and both diminished scales. See [scale coverage](docs/scale-coverage.md).
- Full neck through fret 24, 3NPS/2NPS practice patterns, left-handed view, and text equivalents.
- Thirty-two chord qualities, including 11ths, 13ths and altered tensions, with validated complete, reduced and rootless guitar voicings. Full formulas remain separate from sounding notes and explicit omissions. See [advanced chord coverage](docs/advanced-chords.md).
- Chord parsing including slash basses, grouped collection matching, optional home note, per-chord palettes, and curated pentatonic/blues colors.
- A feature-detected `explore_scale` WebMCP action using the same visible application state.

AI Progression Lab, alternate tunings, audio playback, accounts, and offline installation remain follow-up scope. No musical quality is claimed solely from pitch-set membership. Some movable chord and harmonic-minor patterns require wide stretches; diagrams show positions rather than prescribed fingers.

Progressions accept up to 32 chords and 2,048 characters, with a 32-character
limit per chord symbol. Oversized input stays editable and produces an explicit
error; the matcher never analyzes a silently truncated prefix. Inferred scale
names favor readable enharmonic spellings, while explicit chord roots and home
notes retain their spelling.

Current verification and limitations are recorded in `docs/verification.md`.

## Assets

The Night Swim scene uses generated pixel artwork with separate desktop and
mobile underwater compositions. Live delivery uses lossless WebP copies;
original PNGs are retained. `docs/asset-delivery.md` records byte sizes and
pixel-equivalence checks. Artwork prompts are in `docs/arcade-header/asset-notes.md`
and `docs/underwater/asset-notes.md`.

Typography uses Silkscreen for the wordmark/main selectors and self-hosted Maple
Mono elsewhere. See `docs/TYPOGRAPHY.md` and the font license/provenance in
`public/fonts/maple-mono/`.
