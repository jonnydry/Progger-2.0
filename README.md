# Progger

A guitar scale, mode, and chord reference with a pixel frog guitarist. Reference and matching calculations run locally in the browser.

## Run

Use Node 22.13 or later. From this directory:

```sh
npm install
npm run dev
```

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

- Thirteen scale/mode definitions across all roots, including correctly spelled major modes, pentatonic/blues, harmonic minor, and jazz melodic minor.
- Full neck through fret 24, 3NPS/2NPS practice patterns, left-handed view, and text equivalents.
- Nineteen chord qualities with movable voicing templates validated against their pitch sets.
- Chord parsing including slash basses, grouped collection matching, optional home note, per-chord palettes, and curated pentatonic/blues colors.
- A feature-detected `explore_scale` WebMCP action using the same visible application state.

AI Progression Lab, alternate tunings, audio playback, accounts, and offline installation remain follow-up scope. No musical quality is claimed solely from pitch-set membership. Some movable chord and harmonic-minor patterns require wide stretches; diagrams show positions rather than prescribed fingers.

## Assets

`public/progger-mascot.png` was created with the built-in image-generation tool. The final prompt and asset provenance are in `docs/mascot.md`.
