# Pond scene revision prompts

Generated with the built-in `image_gen.imagegen` tool. The tool exposes no selectable/reported model ID, so this document makes no claim about a particular model version. September 10, 2026.

## Outputs

All are native, unmodified 1774 × 887 RGB PNGs (2:1). Parent integration selects and optimizes WebP assets separately.

- Preferred day: `outputs/imagegen/pond-day-v2.png`
- Matching night: `outputs/imagegen/pond-night-v2.png`
- Alternate day with quieter lower water but reduced mascot prominence: `outputs/imagegen/pond-day-v2-water-led.png`

Built-in original paths (retained):

- Day first: `/home/jonnyd/.codex/generated_images/01a08e3f-4364-7b80-a6e6-7f87b9193af8/exec-eb1c1d7e-a38f-4ee4-a074-95c9b20cc68d.png`
- Day alternate: `/home/jonnyd/.codex/generated_images/01a08e3f-4364-7b80-a6e6-7f87b9193af8/exec-07277bfc-f994-426a-935f-5e793f3fbd21.png`
- Night: `/home/jonnyd/.codex/generated_images/01a08e3f-4364-7b80-a6e6-7f87b9193af8/exec-3608b30e-a9b7-492c-b9fa-cc36b6c59a92.png`

## Visual assessment

The preferred pair improves Proggy's confident, playful game-character silhouette and pixel shading. Day/night retain matching stance and geography, with the band present in both. The generous 2:1 frame keeps the whole guitar and lily pad intact, while nav space above Proggy remains clear. Some stylized guitar headstock detail is too small/dense to guarantee exactly six visible pegs, so artwork is decorative, not an instructional instrument diagram.

The first/day and selected night do **not** meet the requested lower-40%-water composition: their main lily pad ends around74% height. Their quiet lower quarter and matched pair make them stronger mascot-led art. A second day attempt produces lower40% quiet water but shrinks Proggy too far (head~30%, pad~58%); it is an alternate, not the recommendation. Parent should verify the chosen crop and blend in the actual app before replacing live assets. No existing public assets, CSS, or theme configuration were modified by this artwork task.

## Exact prompt — day first

```text
Use case: style-transfer.
Asset type: production website background illustration for Progger music reference app. Create ONE panoramic image at 2:1 aspect ratio, ideally 2048x1024.
Input image 1 is the existing DAY pond: preserve recognizable scene, Proggy identity, two small frog bandmates, amber palette. Input image 2 is existing NIGHT pond, supporting character/style reference. Revise the art to feel intentionally authored as a premium old-school pixel game, with much clearer game sprite shapes and pixel craftsmanship.
Subject: Proggy, a cheeky, badass but playful vivid green frog guitar hero, red bandana, cream/orange angular electric guitar. Clear expressive eyes and broad confident grin. Athletic rockstar stance with one knee up on a curled edge of his giant olive lily pad. Both feet readable and properly supported, two arms, sensible fingers fretting and picking, correct connected guitar neck with six strings and six tuning pegs. Keep the small frog bassist with burgundy bass and frog drummer on their pads to the left, subordinate to Proggy.
Composition is for a header extending underneath music controls: TOP 12% quiet creamy sky for nav. Main Proggy silhouette center at 76% width, head begins around 15% height, feet and lily pad end near 54% height. Complete guitar fits inside 94% width. Background horizon around 43% height. Small bandmates sit around 24% and 36% width, ending by 48% height. Airy open middle-left, established reeds/trees/lilies only at edges. BOTTOM 40% is calm unobstructed reflecting water, subtle low-frequency horizontal pixel reflection streaks fading gradually into near-uniform warm cream #fff5dd at the bottom edge, intentionally low contrast for dark overlaid interface text. Do not fill the lower water with grass or dramatic beams.
Medium: true 16-bit/32-bit era pixel-art game illustration: chunky intentional square pixel clusters, sculpted limited-color sprite shading, selective clean checker dithering and pixel stepping, precise silhouettes. Contemporary vivid but disciplined color/saturation. Render as if a beautiful real CRT screen's phosphors gently blend nearby colored pixels, VERY subtle bloom only along sunlit highlights and specular water. Crisp expressive face/guitar, no smeared details. Not smooth digital painting. Not vector.
Lighting: honey-amber morning sunshine, warm creamy sky, peach cloud bands, deep olive/moss vegetation, fresh spring green Proggy with golden rim accents and confident high-contrast outline. Warm peaceful pond supporting joyful rock energy.
Constraints: single cohesive panorama; no text, no UI, no logos, no frame, no watermark, no scanline overlay, no CRT bezel, no photo texture. Preserve identifiable mascot and recognizable pond/band scene while improving silhouette/pixel quality. Do NOT create a collage or comparison sheet.
```

References, both inspected with view_image first: `public/progger-day-pond.webp` (edit identity/palette) and `public/progger-arcade-pond.webp` (supporting style/identity).

## Exact prompt — day composition alternate

```text
Use case: precise-object-edit. Edit the attached newly revised Progger DAY pond illustration.
Keep its excellent pixel-art craft, precise character design/pose/face/guitar, two small frog bandmates, palette, warm dawn lighting and overall scene identity unchanged. Keep a single 2:1 panorama.
ONE targeted correction: the scene's subject and lily-pad line are TOO LOW. This is a website background requiring the LOWER FORTY PERCENT to be unobstructed calm reflecting water for interface text. Recompose rather than stretch. Uniformly scale Proggy AND his lily pad smaller (about75% of their present size), retaining normal anatomy/proportions, and place them centered at76% width with his head around15% height and the BOTTOM of his lily pad at58% height maximum. Make the two bandmates and horizon finish around45% height. All foliage/reeds/lily pads should end by60% height; no objects or high-contrast reflected object silhouettes in lower40%.
The resulting composition must have complete Proggy+guitar prominently at top right, small band at middle left, and almost half the picture visibly occupied by open warm-cream pond water below them. Bottom40% subtle sparse horizontal amber reflections, fading into near-uniform #fff5dd at the bottom edge; no extra foreground reeds, no large shapes or dark reflection bands in the lower quarter. Preserve the top12% quiet cream sky for navigation. No text, UI, border, watermark, split panels, or smooth painting. This correction is strictly better vertical art direction and more water breathing room, not a new character design.
```

Reference: first day output, inspected with view_image.

## Exact prompt — matching night

```text
Use case: lighting-weather.
Asset type: nighttime production website scene for Progger music reference app. One 2:1 panorama.
Input1 is our newly revised DAY master. Input2 is the original NIGHT palette/scene reference. Transform the first image into NIGHT using the second image's navy/teal/mint mood. Preserve the first image's exact 2:1 composition, main Proggy character identity, playful rock stance, facial proportions, red bandana, cream/orange angular electric guitar, giant olive lily pad, and overall geography. Main hero should remain around76%width, recognizably large rather than tiny. Keep frog anatomy and instrument crisp and coherent.
Change daytime amber pond into a serene midnight concert: deep ink navy sky/water around #050c18, silhouetted trees, muted teal reeds and water reflections, a small luminous mint moon in the upper-right sky, a handful of fireflies. Proggy receives beautiful luminous mint-green rim light with rich emerald skin shadows and warm amber guitar highlights. Red bandana saturated but controlled. Two small left bandmates may remain as subtle, low-contrast moonlit silhouettes with readable instruments. Replace peach clouds with restrained dark blue pixel clusters. Top12% stays quiet and dark for header navigation.
Pixel craft: deliberately authored 16/32-bit game background and appealing game sprite character; chunky square pixel clusters and stepped edges, disciplined palette, selective checker dithering. Modern saturated color and gentle real CRT phosphor blending/bloom only along luminous contours. No broad blur, smooth digital painting, photorealism, heavy scanlines or fake bezel.
Bottom quarter stays unobstructed calm water fading very gradually into near-uniform dark navy #050c18, no strong bands or objects in lowest20%. Reflections keep horizontal pixel marks and low contrast near the lower edge. No text, UI, logo, border, watermark, split panel, gradients that look like an applied rectangle.
```

References: first day output (edit target/composition), `public/progger-arcade-pond.webp` (night palette/style), both previously inspected.
