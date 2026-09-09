# Hear a voicing

The chord-shape browser offers one short, user-triggered plucked strum. It uses
local Web Audio synthesis; no samples, network request, or AudioContext are
created before the user presses Hear voicing. It is a synthesized reference tone,
not a recorded guitar. The control becomes Stop during startup and playback.

Sounding MIDI pitches come directly from the six displayed frets and standard
tuning, in low-string-to-high-string picking order. Muted strings are omitted;
open strings, unisons, octave doublings, inversions, rootless shapes, and omitted
extensions are preserved. Pitch-class summaries and chord symbols never generate
the audio. Left-handed display changes do not reverse the instrument's pitches.

A 45ms stagger, rounded harmonic spectrum, closing low-pass filter and short
amplitude decay make one approximately 2.8-second audition. Conservative gain
scaling leaves headroom. There is no autoplay, looping, tempo or instrument menu.

Changing chord/shape, leaving Explore, hiding the tab, or leaving the page stops
the audition. Stop invalidates pending context resumes. Old callbacks cannot end
a newer session. Nodes disconnect after completion or cancellation, including
suspended clocks and partial graph failures. Unmount closes the context.
Unsupported/blocked audio exposes a retry message while the reference stays usable.

## Verification

- Seven independent musical fixtures cover authored open shapes, inversion,
  actual rootless catalog shapes, repeated/crossing pitches, fret 24 and invalid
  inputs. Eight independent player fixtures cover startup, completion, stop,
  retries, stale resumes, disposal, suspension and partial graph failure.
- Browser: click/keyboard playback, Stop, natural completion, changing shapes,
  Match/Explore navigation, and 320/390px layouts in day/night appearances.
- Isolated Chromium audio rendering: open C peak 0.288, rootless C13 peak 0.323,
  solo A4 peak 0.633; clean silent endings. A4 measured approximately 440Hz.
- Full tests, lint, typecheck and production build pass.

Limits: automated checks establish pitches, signal headroom and lifecycle
behavior; timbre preference needs musician listening feedback. Physical mobile
hardware and separate Safari/Firefox audio behavior have not been checked.
