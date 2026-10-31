# Phrase musicality A/B clips

Rendered from head `38359c1d53b2cdd7adadc3ec57d76473ed202a51` (tree `91ddb67c8713aa80ba2ff754ba6931f4136dbe45`).
A uses main's rules at `aaeafd846099b3b81b6f51755418e9465427c68a`, loaded by this script with `git show` into a temp module. That copy is not in the repo.
B uses `lib/phrase.ts` at the head above.
Both sides use the same render: `OfflineAudioContext` at 44100 Hz mono, `schedulePhrase` into `scheduleVoicing`. One fixed seed per pair. The generator has no other randomness.
A and B of each pair share one gain. Integrated EBU R128 is measured on the source wav and aims at -16 LUFS. The gap stays within 0.5 LU. True peak is the wav true peak and stays at or under -1 dBTP. Onsets and durations match in every pair.

## pair1

Note 2 is the one to hear. A climbs D–F–G and holds the F under the G7, so the third is left hanging. B climbs D–E–G instead and lands on the chord tone. Same quarter-note beats.

- Head: `38359c1d53b2cdd7adadc3ec57d76473ed202a51`
- Seed: 3. Seed chosen for this pack.
- Key/scale: C major over G7
- Chords: G7 for 4 bars
- BPM: 100
- Swing: straight (amount 0, ratio 1)
- Sound: plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)
- Plan (same seed on A and B): quarters, fall, mid, cadence root
- Onsets: identical on A and B, and equal to the quarters plan (0, 1.5, 2.5, 3, 4, 5.5, 6.5, 7, 7.5, 8, 9.5, 10, 11.5, 12, 13, 14, 15, 16)
- Durations: identical on A and B
- Shared gain 5.3659
- A 12.30s, -16.8 LUFS, wav true peak -1.0 dBTP
- B 12.30s, -16.8 LUFS, wav true peak -1.0 dBTP
- Integrated gap: 0.00 LU
- A notes: G4@0 D4@1.5 F4@2.5 G4@3 F4@4 C4@5.5 E4@6.5 F4@7 G4@7.5 F4@8 C4@9.5 E4@10 B3@11.5 D4@12 F4@13 D4@14 A3@15 G3@16
- B notes: G4@0 D4@1.5 E4@2.5 G4@3 F4@4 C4@5.5 D4@6.5 F4@7 G4@7.5 F4@8 C4@9.5 E4@10 B3@11.5 D4@12 F4@13 D4@14 A3@15 G3@16
- Files: `pair1_G7_early-leap_100bpm_straight_A.mp3`, `pair1_G7_early-leap_100bpm_straight_B.mp3`, plus matching wav

## pair2

A drops C#–A#–F#–D# in a staircase, each fall as wide as the last. B reaches B after the C# and steps A#–E#–F#, so the descent breathes instead of sliding. Same pushed eighths.

- Head: `38359c1d53b2cdd7adadc3ec57d76473ed202a51`
- Seed: 32. Seed chosen for this pack.
- Key/scale: F# major over F#maj7
- Chords: F#maj7 for 4 bars
- BPM: 100
- Swing: straight (amount 0, ratio 1)
- Sound: plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)
- Plan (same seed on A and B): push, rise, low, cadence fifth
- Onsets: identical on A and B, and equal to the push plan (0, 1.5, 2, 2.5, 3.5, 4, 5.5, 6.5, 7, 8, 9.5, 10, 11.5, 12, 13, 13.5, 14.5, 15.5, 16)
- Durations: identical on A and B
- Shared gain 5.2377
- A 12.30s, -17.1 LUFS, wav true peak -1.0 dBTP
- B 12.30s, -17.0 LUFS, wav true peak -1.0 dBTP
- Integrated gap: 0.10 LU
- A notes: F#3@0 E#3@1.5 G#3@2 C#4@2.5 A#3@3.5 F#3@4 D#3@5.5 E#3@6.5 A#3@7 C#4@8 A#3@9.5 E#3@10 F#3@11.5 A#3@12 B3@13 C#4@13.5 D#4@14.5 B3@15.5 C#4@16
- B notes: F#3@0 E#3@1.5 G#3@2 C#4@2.5 B3@3.5 A#3@4 E#3@5.5 F#3@6.5 A#3@7 C#4@8 A#3@9.5 E#3@10 F#3@11.5 A#3@12 B3@13 C#4@13.5 D#4@14.5 B3@15.5 C#4@16
- Files: `pair2_F#maj7_mid-leap_100bpm_straight_A.mp3`, `pair2_F#maj7_mid-leap_100bpm_straight_B.mp3`, plus matching wav

## pair3

Bar 3 is the loudest difference. A falls A–E–B and F–C, two fifths in a row with no rest between them. B steps C–D and E–B instead, so each fall lands and turns. Same eighth-note grid.

- Head: `38359c1d53b2cdd7adadc3ec57d76473ed202a51`
- Seed: 107. Seed chosen for this pack.
- Key/scale: D Dorian over Dm7
- Chords: Dm7 for 4 bars
- BPM: 100
- Swing: straight (amount 0, ratio 1)
- Sound: plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)
- Plan (same seed on A and B): eighths, wave, high, cadence third
- Onsets: identical on A and B, and equal to the eighths plan (0, 1, 1.5, 2, 3, 3.5, 4, 5, 5.5, 6, 7, 8, 9, 9.5, 10.5, 11.5, 12, 12.5, 13.5, 14.5, 15, 15.5, 16)
- Durations: identical on A and B
- Shared gain 5.0115
- A 12.30s, -16.0 LUFS, wav true peak -1.3 dBTP
- B 12.30s, -16.0 LUFS, wav true peak -1.3 dBTP
- Integrated gap: 0.00 LU
- A notes: C5@0 G4@1 B4@1.5 C5@2 E5@3 G5@3.5 D5@4 A4@5 C5@5.5 D5@6 A4@7 E5@8 B4@9 F5@9.5 C5@10.5 B4@11.5 D5@12 C5@12.5 F5@13.5 E5@14.5 C5@15 G4@15.5 F4@16
- B notes: C5@0 G4@1 A4@1.5 C5@2 E5@3 G5@3.5 D5@4 A4@5 B4@5.5 D5@6 C5@7 D5@8 A4@9 E5@9.5 B4@10.5 C5@11.5 D5@12 B4@12.5 E5@13.5 F5@14.5 C5@15 G4@15.5 F4@16
- Files: `pair3_Dm7_late-leap_100bpm_straight_A.mp3`, `pair3_Dm7_late-leap_100bpm_straight_B.mp3`, plus matching wav

## pair4

One note changes, near the end. A climbs G up to B a major third, then C. B steps G–A and continues to C, so the last bar opens up. Everything before it is identical.

- Head: `38359c1d53b2cdd7adadc3ec57d76473ed202a51`
- Seed: 50. Seed chosen for this pack.
- Key/scale: E minor over Em
- Chords: Em for 4 bars
- BPM: 100
- Swing: straight (amount 0, ratio 1)
- Sound: plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)
- Plan (same seed on A and B): quarters, fall, mid, cadence root
- Onsets: identical on A and B, and equal to the quarters plan (0, 1.5, 2.5, 3, 4, 5.5, 6.5, 7, 7.5, 8, 9.5, 10, 11.5, 12, 13.5, 14.5, 15, 16)
- Durations: identical on A and B
- Shared gain 5.0669
- A 12.30s, -17.2 LUFS, wav true peak -1.0 dBTP
- B 12.30s, -17.2 LUFS, wav true peak -1.0 dBTP
- Integrated gap: 0.00 LU
- A notes: G4@0 A4@1.5 G4@2.5 E4@3 B4@4 C5@5.5 B4@6.5 G4@7 F#4@7.5 E4@8 F#4@9.5 C4@10 D4@11.5 G3@12 B3@13.5 C4@14.5 D4@15 E4@16
- B notes: G4@0 A4@1.5 G4@2.5 E4@3 B4@4 C5@5.5 B4@6.5 G4@7 F#4@7.5 E4@8 F#4@9.5 C4@10 D4@11.5 G3@12 A3@13.5 C4@14.5 D4@15 E4@16
- Files: `pair4_Em_late-step_100bpm_straight_A.mp3`, `pair4_Em_late-step_100bpm_straight_B.mp3`, plus matching wav

## pair5

A steps down F–D–C in thirds, then falls a fourth to A-flat. B reaches G, F, D, and lands on B-flat, so the descent walks down the chord instead of tumbling. Same long–short beats.

- Head: `38359c1d53b2cdd7adadc3ec57d76473ed202a51`
- Seed: 112. Seed chosen for this pack.
- Key/scale: Bb mixolydian over Bb7
- Chords: Bb7 for 4 bars
- BPM: 100
- Swing: straight (amount 0, ratio 1)
- Sound: plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)
- Plan (same seed on A and B): long-short, fall, mid, cadence root
- Onsets: identical on A and B, and equal to the long-short plan (0, 1.5, 2.5, 3, 4, 5.5, 6, 7, 8, 9.5, 10, 11.5, 12, 13, 14, 15.5, 16)
- Durations: identical on A and B
- Shared gain 5.3184
- A 12.30s, -17.0 LUFS, wav true peak -1.0 dBTP
- B 12.30s, -17.0 LUFS, wav true peak -1.0 dBTP
- Integrated gap: 0.00 LU
- A notes: D4@0 Eb4@1.5 F4@2.5 Ab4@3 Bb4@4 G4@5.5 F4@6 D4@7 Ab4@8 F4@9.5 D4@10 C4@11.5 Ab3@12 Bb3@13 D4@14 C4@15.5 Bb3@16
- B notes: D4@0 Eb4@1.5 F4@2.5 Ab4@3 Bb4@4 G4@5.5 F4@6 D4@7 Ab4@8 G4@9.5 F4@10 D4@11.5 Bb3@12 Ab3@13 D4@14 C4@15.5 Bb3@16
- Files: `pair5_Bb7_mid-descent_100bpm_straight_A.mp3`, `pair5_Bb7_mid-descent_100bpm_straight_B.mp3`, plus matching wav

## pair6

The smallest change in the pack: one note at beat 7.5. A drops A down to F, a major third, before D. B drops A to G and then D, so the top of the arch resolves. Same quarter notes.

- Head: `38359c1d53b2cdd7adadc3ec57d76473ed202a51`
- Seed: 75. Seed chosen for this pack.
- Key/scale: D Dorian over Dm7
- Chords: Dm7 for 4 bars
- BPM: 100
- Swing: straight (amount 0, ratio 1)
- Sound: plucked phrase guitar (schedulePhrase → scheduleVoicing, trim 0.2)
- Plan (same seed on A and B): quarters, arch, high, cadence root
- Onsets: identical on A and B, and equal to the quarters plan (0, 1.5, 2.5, 3, 4, 5.5, 6.5, 7, 7.5, 8, 9.5, 10, 11.5, 12, 14.5, 15, 16)
- Durations: identical on A and B
- Shared gain 5.2768
- A 12.30s, -16.2 LUFS, wav true peak -1.0 dBTP
- B 12.30s, -16.2 LUFS, wav true peak -1.0 dBTP
- Integrated gap: 0.00 LU
- A notes: F5@0 E5@1.5 C5@2.5 F5@3 A5@4 G5@5.5 E5@6.5 A5@7 F5@7.5 D5@8 C5@9.5 B4@10 A4@11.5 D5@12 B4@14.5 C5@15 D5@16
- B notes: F5@0 E5@1.5 C5@2.5 F5@3 A5@4 G5@5.5 E5@6.5 A5@7 G5@7.5 D5@8 C5@9.5 B4@10 A4@11.5 D5@12 B4@14.5 C5@15 D5@16
- Files: `pair6_Dm7_one-note_100bpm_straight_A.mp3`, `pair6_Dm7_one-note_100bpm_straight_B.mp3`, plus matching wav
