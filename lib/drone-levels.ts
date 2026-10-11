import {
  DRONE_MODES,
  DRONE_ROOTS,
  dronePitches,
  midiHz,
  type DroneModeId,
  type DroneOctave,
} from './drone.ts';
import {
  BOW_GAINS,
  CELLO_GAINS,
  DRONE_MAX_LINEAR_GAIN,
  REED_GAINS,
  REED_TIMING,
  WALK_GAINS,
  reedHarmonicAmplitudeSum,
  reedPitchGain,
  soundLinearCap,
  walkHarmonicAmplitudeSum,
} from './drone-audio.ts';
import type { DroneSoundId } from './drone.ts';

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

export function walkPluckPeak(sampleRate = 48000): number {
  let peak = 0;
  for (let midi = 36; midi <= 96; midi += 1) {
    const sum = walkHarmonicAmplitudeSum(midiHz(midi), sampleRate);
    peak = Math.max(peak, sum * WALK_GAINS.attack * WALK_GAINS.trim);
  }
  return peak;
}

function pitchWeight(role: 'root' | 'fifth' | 'octave', layer: 'low' | 'upper') {
  return (
    (role === 'root' ? 1 : REED_GAINS.other) *
    (layer === 'upper' ? REED_GAINS.upper : 1)
  );
}

function roomFactor(dry: number, wet: number): number {
  const wetPeak = REED_GAINS.impulse * (1 + REED_GAINS.early);
  return dry + wet * wetPeak;
}

export function bowLinearPeak(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
): number {
  const pitches = dronePitches(root, modeId, octave);
  let mixer = BOW_GAINS.noise;
  for (const pitch of pitches) {
    mixer += BOW_GAINS.voices * BOW_GAINS.pitch * pitchWeight(pitch.role, pitch.layer);
  }
  return (
    mixer *
    BOW_GAINS.envelope *
    roomFactor(BOW_GAINS.dry, BOW_GAINS.wet) *
    soundLinearCap('bow')
  );
}

export function celloLinearPeak(
  root: string,
  modeId: DroneModeId,
  octave: DroneOctave,
): number {
  const pitches = dronePitches(root, modeId, octave);
  let mixer = 0;
  for (const pitch of pitches) {
    mixer +=
      CELLO_GAINS.samplePeak *
      CELLO_GAINS.pitch *
      pitchWeight(pitch.role, pitch.layer);
  }
  return (
    mixer *
    CELLO_GAINS.envelope *
    roomFactor(CELLO_GAINS.dry, CELLO_GAINS.wet) *
    soundLinearCap('cello')
  );
}

export type LoudestSound = LoudestReed & { sound: DroneSoundId; walk: number };

export function loudestSoundPeaks(
  sound: DroneSoundId,
  sampleRate = 48000,
): LoudestSound {
  const walk = walkPluckPeak(sampleRate);
  if (sound === 'reed') {
    const reed = loudestReedPeaks(sampleRate);
    return { ...reed, sound, walk };
  }
  const ratio = 1.0001;
  let best: LoudestSound | null = null;
  const measure = sound === 'bow' ? bowLinearPeak : celloLinearPeak;
  for (const octave of ['low', 'layered'] as const) {
    for (const mode of DRONE_MODES) {
      for (const root of DRONE_ROOTS) {
        const steady = measure(root, mode.id, octave);
        const overlap = steady * ratio;
        if (!best || overlap > best.overlap) {
          best = { root, modeId: mode.id, octave, steady, overlap, sound, walk };
        }
      }
    }
  }
  if (!best) throw new Error(`No ${sound} voicing to measure.`);
  return best;
}

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
