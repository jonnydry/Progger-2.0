import {
  DRONE_MODES,
  DRONE_ROOTS,
  dronePitches,
  midiHz,
  type DroneModeId,
  type DroneOctave,
} from './drone.ts';
import {
  DRONE_MAX_LINEAR_GAIN,
  REED_GAINS,
  REED_TIMING,
  reedHarmonicAmplitudeSum,
  reedPitchGain,
} from './drone-audio.ts';

export const FULL_SCALE_MARGIN = 10 ** (-1 / 20);

export function steadyEnvelope(): number {
  return REED_GAINS.envelope + REED_GAINS.bellows;
}

export function crossfadeEnvelopePeak(steps = 4096): number {
  const attack = REED_TIMING.switchAttack;
  const fade = REED_TIMING.switchFade;
  const alive = fade + REED_TIMING.stopTail;
  const rise = attack + REED_TIMING.bellowsRise;
  const duration = Math.max(attack, alive, rise);
  const growth = REED_GAINS.envelope / REED_GAINS.silence;
  let peak = 0;
  for (let index = 0; index <= steps; index += 1) {
    const t = (duration * index) / steps;
    const oldAutomation = t >= fade ? 0 : REED_GAINS.envelope * (1 - t / fade);
    const old = t >= alive ? 0 : oldAutomation + REED_GAINS.bellows;
    const rising =
      t >= attack
        ? REED_GAINS.envelope
        : REED_GAINS.silence * growth ** (t / attack);
    const newBellows = REED_GAINS.bellows * Math.min(1, t / rise);
    peak = Math.max(peak, old + rising + newBellows);
  }
  return peak;
}

export function reedLinearPeak(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
  sampleRate = 48000,
): number {
  const pitches = dronePitches(root, modeId, octave);
  let mixer = 0;
  for (const pitch of pitches) {
    mixer +=
      2 *
      reedHarmonicAmplitudeSum(midiHz(pitch.midi), sampleRate) *
      reedPitchGain(pitch.role, pitch.layer);
  }
  const formants = REED_GAINS.formants.reduce((sum, amount) => sum + amount, 0);
  const pre =
    mixer * REED_GAINS.body +
    mixer * formants * REED_GAINS.formantBus +
    REED_GAINS.noise;
  const voice = pre * steadyEnvelope();
  const wetPeak = REED_GAINS.impulse * (1 + REED_GAINS.early);
  return (
    (voice * REED_GAINS.dry + voice * REED_GAINS.wet * wetPeak) *
    DRONE_MAX_LINEAR_GAIN
  );
}

export type LoudestReed = {
  root: string;
  modeId: DroneModeId;
  octave: DroneOctave;
  steady: number;
  overlap: number;
};

export function loudestReedPeaks(sampleRate = 48000): LoudestReed {
  const ratio = crossfadeEnvelopePeak() / steadyEnvelope();
  let best: LoudestReed | null = null;
  for (const octave of ['low', 'layered'] as const) {
    for (const mode of DRONE_MODES) {
      for (const root of DRONE_ROOTS) {
        const steady = reedLinearPeak(root, mode.id, octave, sampleRate);
        const overlap = steady * ratio;
        if (!best || overlap > best.overlap) {
          best = { root, modeId: mode.id, octave, steady, overlap };
        }
      }
    }
  }
  if (!best) throw new Error('No reed voicing to measure.');
  return best;
}
