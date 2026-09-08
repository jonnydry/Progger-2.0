# Asset delivery audit — 2026-09-07

The current pond illustrations keep their existing generated artwork. Delivery copies use lossless WebP encoding; original PNGs remain available as source assets.

| Asset                    | Dimensions  |    Original PNG |   Delivery WebP | Verification                   |
| ------------------------ | ----------- | --------------: | --------------: | ------------------------------ |
| Header arcade pond       | 2172 × 724  | 1,429,430 bytes | 1,116,624 bytes | Decoded RGBA buffers identical |
| Desktop underwater scene | 1870 × 841  | 1,129,466 bytes |   803,156 bytes | Decoded RGBA buffers identical |
| Mobile underwater scene  | 1254 × 1254 | 1,206,505 bytes |   855,766 bytes | Decoded RGBA buffers identical |

Files were encoded with the installed Sharp codec using `webp({lossless: true, effort: 6, alphaQuality: 100})`. Each source and delivery file was independently decoded to raw RGBA and compared byte for byte. No dimensions, crops, colors, or artwork changed.

`public/favicon.png` is a technical 64 × 64 PNG derivative of `public/progger-mascot.png`, resized with Sharp's default Lanczos3 resampling and encoded at PNG compression level 9. It is 6,331 bytes versus the original 1,003,697-byte source. The derivative was visually inspected at its output size; the frog and guitar remain recognizable. This intentional icon resizing is separate from the exact-pixel checks for the large scene images.

For one header, one viewport-appropriate underwater scene, and the icon, total file bytes fall from 3,562,593 to 1,926,111 on desktop, and from 3,639,632 to 1,978,721 on mobile (about 46% lower in both cases). These are asset file totals, not a measured total browser transfer or loading time. The source art still has substantial texture; further transfer reductions would require smaller responsive derivatives or a deliberately reviewed lossy codec choice.
