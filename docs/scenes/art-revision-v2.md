# Progger artwork revision v2

September 10, 2026. All six header illustrations have been revised and integrated
locally. Each scene retains its day/night palette, Proggy's red bandana and
angular guitar, and the smaller bassist and drummer. The selected day master
for each scene was used as the composition reference for its night partner.

## Assets and prompts

Production files are under `public/art/v2/`. Each is 1774 × 887 pixels (2:1),
converted from the native generated PNG with Sharp, WebP quality 88, effort 6.
Conversion preserves dimensions; there is no raster cropping or creative
post-processing. Framing and fades belong to the app's CSS.

| Scene | Day | Night | Exact generation prompts |
| --- | --- | --- | --- |
| The Pond | [pond-day.webp](../../public/art/v2/pond-day.webp), 286,122 bytes | [pond-night.webp](../../public/art/v2/pond-night.webp), 214,456 bytes | [Pond prompts](revision-prompts-pond.md) |
| Tidepool | [tidepool-day.webp](../../public/art/v2/tidepool-day.webp), 341,906 bytes | [tidepool-night.webp](../../public/art/v2/tidepool-night.webp), 294,646 bytes | [Tidepool prompts](revision-prompts-tidepool.md) |
| Twilight | [twilight-day.webp](../../public/art/v2/twilight-day.webp), 271,436 bytes | [twilight-night.webp](../../public/art/v2/twilight-night.webp), 268,070 bytes | [Twilight prompts](revision-prompts-twilight.md) |

Generation used the built-in image tool. Its interface does not expose a model
selector or report a model version, so no specific version is claimed.
Original generated PNGs are retained in the local, ignored `outputs/imagegen/`
directory and the tool's original output paths recorded in the prompt files.
The Pond uses the first day image; the alternate day reduced Proggy too much.
Existing public artwork files remain intact for comparison or rollback.

## Integration

- All six images use automatic height to preserve their intrinsic proportions.
  The centered header frame caps at 1280px wide, with soft edges on wide screens.
- Every scene shares the same header dimensions: 250px on small phones,
  `90px + 40vw` on tablets, and a maximum 520px on desktop. Reserving space for
  navigation keeps foliage and tall headstocks away from the controls.
- A smaller-screen crop prioritizes the complete mascot and guitar. Bandmates
  at the far left may fall outside the crop.
- Explore and Match reuse a bounded, quiet water crop from the selected scene.
  Pond and Tidepool crop farther down to exclude the pad and dense reflections.
  Mobile uses the calmer center of the water instead of Proggy's reflection.
- Prewarming requests one selected image, reused for the header and water.
  Theme races, retries, reduced-motion behavior, and saved preferences are
  preserved. Musical code, notation, audio, and palette roles are unchanged.

## Verification

- All seven test files pass, including independent music fixtures and theme
  loading/race/retry checks. Typecheck and lint pass.
- The Vercel static production build passes with the revised asset paths.
- All six scene/mode combinations were visually inspected at desktop and
  320px widths. Pond was also inspected at tablet and wide-screen sizes.
- Geometry checks at 320, 390, 500, 501, 640, 900, 901, 1193, 1440, and 1920px
  found no horizontal page overflow. Header dimensions stay consistent across
  scene selections. Mobile and desktop retain complete Proggy/guitar silhouettes.
- Scene and mode changes retained G-flat harmonic minor in Explore and
  `Dbm Ab7` in Match. Match's water blends into readable chord entry. No browser
  console errors were reported during this pass.
- Independent reviewers challenged character anatomy, instrument coherence,
  CSS precedence, loading paths, water crops, and isolation from musical logic.
  Browser findings about navigation interference and busy mobile reflections
  were corrected and rechecked.

Limits: browser checks used the in-app Chromium browser, not physical devices
or a separate Safari/Firefox pass. Guitar hardware is stylized decorative art,
not an instructional diagram. The raw generations are locally archived, not
checked into Git. This revision is not yet committed or deployed.
