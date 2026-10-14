/**
 * ITU-R BS.1770 integrated loudness at 48 kHz.
 * The pre-filter and RLB coefficients are the 48 kHz set from BS.1770-4.
 */

const PRE_B = [1.53512485958697, -2.69169618940638, 1.19839281085285];
const PRE_A = [1, -1.69065929318241, 0.73248077421585];
const RLB_B = [1, -2, 1];
const RLB_A = [1, -1.99004745483398, 0.99007225036621];

const BLOCK = 0.4;
const HOP = 0.1;
const ABSOLUTE_GATE = -70;

function biquad(feedforward: readonly number[], feedback: readonly number[]) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const b0 = feedforward[0] ?? 0;
  const b1 = feedforward[1] ?? 0;
  const b2 = feedforward[2] ?? 0;
  const a1 = feedback[1] ?? 0;
  const a2 = feedback[2] ?? 0;
  return (sample: number) => {
    const output = b0 * sample + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = sample;
    y2 = y1;
    y1 = output;
    return output;
  };
}

function weight(channel: Float32Array): Float32Array {
  const shelf = biquad(PRE_B, PRE_A);
  const highpass = biquad(RLB_B, RLB_A);
  const weighted = new Float32Array(channel.length);
  for (let index = 0; index < channel.length; index += 1) {
    weighted[index] = highpass(shelf(channel[index] ?? 0));
  }
  return weighted;
}

function blockEnergy(channels: readonly Float32Array[], start: number, length: number): number {
  let energy = 0;
  for (const channel of channels) {
    let sum = 0;
    const end = Math.min(channel.length, start + length);
    for (let index = start; index < end; index += 1) {
      const sample = channel[index] ?? 0;
      sum += sample * sample;
    }
    energy += sum / length;
  }
  return energy;
}

function loudnessOf(energies: readonly number[]): number {
  if (!energies.length) return Number.NEGATIVE_INFINITY;
  let mean = 0;
  for (const energy of energies) mean += energy;
  mean /= energies.length;
  if (mean <= 0) return Number.NEGATIVE_INFINITY;
  return -0.691 + 10 * Math.log10(mean);
}

/** Integrated loudness of already-rendered channels at 48 kHz. */
export function integratedLufs(channels: readonly Float32Array[], sampleRate = 48000): number {
  if (sampleRate !== 48000) {
    throw new Error('The K-weighting coefficients are for 48 kHz.');
  }
  const weighted = channels.map((channel) => weight(channel));
  const block = Math.round(BLOCK * sampleRate);
  const hop = Math.round(HOP * sampleRate);
  const length = weighted[0]?.length ?? 0;
  const energies: number[] = [];
  for (let start = 0; start + block <= length; start += hop) {
    const energy = blockEnergy(weighted, start, block);
    const loudness = -0.691 + 10 * Math.log10(Math.max(energy, 1e-20));
    if (loudness >= ABSOLUTE_GATE) energies.push(energy);
  }
  const absolute = loudnessOf(energies);
  if (!Number.isFinite(absolute)) return absolute;
  const relativeGate = absolute - 10;
  const kept = energies.filter(
    (energy) => -0.691 + 10 * Math.log10(energy) >= relativeGate,
  );
  return loudnessOf(kept);
}
