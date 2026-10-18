# Tidepool asset revisions

Generated with the built-in image generation tool. The interface has no explicit model-selection field; no CLI or fallback was used.

## Outputs

- Day raw: `outputs/imagegen/tidepool-day-v2.png` — 1774 × 887.
- Night raw: `outputs/imagegen/tidepool-night-v2.png` — 1774 × 887.
- Day original tool output: original generation file (not committed).
- Night original tool output: original generation file (not committed).

Production conversion and app integration handled separately. Existing public assets were not overwritten by this generation task.

## Review

Day and night preserve a consistent geography, mascot silhouette, and band arrangement. Clean stepped contours and larger coherent color clusters make this read more like pixel game art than the old asset. The complete instrument is visible, with clear bridge/pickup/neck features, and the two small bandmates remain secondary. Both assets retain a natural 2:1 ratio.

Remaining caveat: despite the prompt asking for a calm bottom 40%, the broken water reflections remain fairly detailed through roughly 80% height. The last 10–15% is quiet and softly fades to the page-compatible base. The parent reviewer should check overlay text contrast and feathering in the actual app. Day/night highlights vary but all major solid-object placements stay consistent. The night palette retains rich blue and lavender rather than making the mascot green lighting neutral.

## Day prompt

Use case: style-transfer.
Asset type: finished game-art background for Progger guitar-reference website, 2:1 wide landscape (ideally 2048 by 1024).
Input image 1 is the existing DAY TIDEPOOL scene, an edit target and identity/layout reference. Revise its pixel-art execution substantially while preserving the mascot, his band and its established sea-stack tidepool world.
Scene: sea-glass turquoise coastal tidal pools, sculpted rocky shorelines, small tasteful magenta anemones, sparse seaweed, distant tall sea stacks and conifers, clear pale aqua sky, warm sand sunlight. Foreground reflecting water fades gently into uniform very pale aqua-ivory #f4f4e7 along entire bottom edge.
Subject: Proggy, confident playful bright green frog with a vivid red bandana and cheeky open grin, beautifully readable expressive eyes, badass rock-game hero stance. Full body on a rock on the right near 75% of canvas width. Complete cream electric guitar with orange angular V-like body edge, dark neck, clear frets, pickups, bridge and six-string instrument cues. His left hand grips neck naturally and right hand strums near pickups; correct two arms and two legs. Recognizable simple game-sprite hands, no extra limbs. On the far left retain the two existing small bandmates: green frog bassist holding burgundy bass; green frog drummer at orange-red drum kit.
Style: truly intentional premium old-school 16-bit game pixel art. Draw deliberate crisp stepped contours, chunky coherent pixel clusters and a restrained palette of 5–7 discrete shades per material. Selective ordered dithering only to soften shading boundaries. Crisp silhouette, confident clean composition, modeled but visibly pixel-block frog anatomy. Modern vivid green/turquoise/coral saturation, subtle CRT phosphor color blending and very restrained luminous edge halo on bright pixels. Never a smooth painted cartoon covered in noisy fake-pixel texture. No illustration brushwork, glossy 3D modeling, gritty noise or giant scanline overlay.
Composition: preserve the reference's story but redesign its spacing for utility. Top 12% is quiet sky free of characters/cloud highlights for header navigation. Proggy's eyes around y=17%, feet around y=50–52%; whole guitar and headstock comfortably inside x=95%. Bandmates left around x=20% and 33%, from y=28% to 47%. Sea stacks middle-distance near horizon. All rocks and solid subjects stay above 58% height. Bottom 40% exclusively quiet reflecting water, with simplified broken pixel reflections at top and then broad calm pale water. Center x=36–65% stays restrained enough for app controls over the lower water; do not bake controls into image.
Constraints: preserve character identity and geography motifs. Exactly three frogs, no extra props or characters, no words, letters, logos, UI, musical symbols, frames, watermark or CRT monitor border. A premium playful pixel game environment, not a website mockup. Render one single landscape scene, not a collage or comparison.

## Night prompt

Use case: lighting-weather.
Asset type: finished pixel-game NIGHT TIDEPOOL background for Progger guitar-reference website. Single 2:1 wide landscape, preserve exact dimensions and framing of reference 1.
Input image 1: the approved newly revised DAY Tidepool image, edit target. LOCK its character identity, crisp pixel execution, camera angle, geometry, all object positions, limb poses and silhouette. Input image 2: old NIGHT Tidepool, reference only for blue-teal/lavender night colors and moon motif.
Primary request: transform image 1 into a moonlit night version with consistent geography and character placement. Maintain exactly the three frogs and existing guitar/bass/drum kit. Proggy green frog red bandana, cream/orange angular electric guitar, playful badass smile. No body, hand or instrument changes. Keep small bassist and drummer left, mascot right; complete instrument including headstock.
Lighting: deep blue night sky, sparse tiny stars, restrained lavender crescent moon near x=42%, y=16%, dark sculpted sea stacks and conifers. Teal/aqua phosphor edge glints on water and stone, violet soft moon rim light on frogs and instrument edges. Magenta-violet anemones and very modest sea-green bioluminescence at shore, not a rave of neon. Frog remains clearly rich green under cool night light. Water near horizon luminous turquoise, then fades to deep uniform blue-black #041421 along entire bottom edge.
Style: lock deliberate old-school 16-bit hand-placed pixel art from image 1, bold clean stepped silhouettes, coherent chunky pixel clusters, discrete color ramps with selective ordered dithering. Modern saturation and subtle CRT phosphor blending only, retain crisp character detail. Do not convert to smooth painterly cartoon, brushed illustration, 3D render, grainy noise or scanline filter.
Composition: top12% quiet dark sky for UI navigation. Keep Proggy at x75%, eyes around17%, feet around50%. Keep all solid objects above58%height; bottom40% exclusively reflecting water, reduce high contrast reflection detail smoothly from65% downward so bottom quarter is mostly calm deep blue-black. Center below y55% needs quiet negative space for app controls. Keep a natural textured water transition, not a hard horizontal fade boundary.
Constraints: exact same geography and object placement as image1, same three frogs, body proportions, poses, single full six-string electric guitar with legible pickups/frets/bridge, no extra limbs/props/characters. No text, logos, letters, musical symbols, website UI, frames, watermark or CRT border. Return one night scene only, not a collage or day/night split.
