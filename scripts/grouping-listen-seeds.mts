// Seeds for a feel listen of this head against main tip 38ab664.
// A is main (uniform rhythm draw, no grouping cells). B is this head.
// A seed is usable only when the played B line has at least one grouping
// atom and the same seed on A has none. The old pack
// (1094, 1201, 1376, 1184, 1024) is not this list.
//
// Playback for every seed: BPM 96 (PHRASE_TEMPO_DEFAULT), feel straight
// (SWING_AMOUNT_DEFAULT 0). generatePhrase does not take a tempo.
import { pathToFileURL } from 'node:url';

const CTX = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F', 'major', 'Fmaj7'],
  ['E', 'minor', 'Em'],
  ['D', 'dorian', 'Dm7'],
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'minor-pentatonic', 'Am7'],
] as const;

const mod = (n: number) => ((n % 12) + 12) % 12;

function steps(a: number, b: number, pcs: Set<number>) {
  if (a === b) return 0;
  const s = Math.sign(b - a);
  let m = a;
  let c = 0;
  while (m !== b && c < 30) {
    m += s;
    if (pcs.has(mod(m))) c++;
  }
  return s * c;
}

/** Played grouping atoms: two or more repeats of a 3, 4, or 6 cell. */
export function playedGroupingAtoms(
  midis: readonly number[],
  beats: readonly number[],
  pcs: Set<number>,
): number {
  const hit = Array.from({ length: midis.length }, () => false);
  let atoms = 0;
  for (const k of [3, 4, 6]) {
    for (let s = 0; s + 2 * k <= midis.length; s++) {
      if (hit[s]) continue;
      const pat = (o: number) =>
        Array.from({ length: k - 1 }, (_, i) =>
          steps(midis[o + i], midis[o + i + 1], pcs),
        ).join(',');
      const p0 = pat(s);
      const sh = steps(midis[s], midis[s + k], pcs);
      if (Math.abs(sh) < 1 || Math.abs(sh) > 2) continue;
      let o = s;
      let len = 0;
      while (
        o + 2 * k <= midis.length &&
        pat(o + k) === p0 &&
        steps(midis[o], midis[o + k], pcs) === sh &&
        beats[o + k] - beats[o] === k * 0.5
      ) {
        o += k;
        len++;
      }
      if (len < 1) continue;
      atoms++;
      for (let i = s; i < o + k; i++) hit[i] = true;
    }
  }
  return atoms;
}

/** Verified on this head against main 38ab664. Not the retired pack. */
export const LISTEN_SEEDS: readonly {
  seed: number;
  bars: 2;
  key: string;
  scale: string;
  chord: string;
}[] = [
  { seed: 1001, bars: 2, key: 'C', scale: 'major', chord: 'C' },
  { seed: 1051, bars: 2, key: 'A', scale: 'dorian', chord: 'Am' },
  { seed: 1105, bars: 2, key: 'C', scale: 'major', chord: 'G7' },
  { seed: 1154, bars: 2, key: 'F', scale: 'major', chord: 'Fmaj7' },
  { seed: 1206, bars: 2, key: 'E', scale: 'minor', chord: 'Em' },
];

export type ListenSeed = {
  seed: number;
  bars: 2 | 4;
  key: string;
  scale: string;
  chord: string;
  bpm: 96;
  feel: 'straight';
  bAtoms: number;
  aAtoms: number;
};

const invoked = process.argv[1]?.includes('grouping-listen-seeds');
if (invoked) {
  const mainDir = process.argv[2];
  if (!mainDir) {
    console.error('usage: grouping-listen-seeds.mts <main-checkout>');
    process.exit(1);
  }
  const here = new URL('..', import.meta.url).pathname;
  const head = await import(pathToFileURL(here + '/lib/phrase.ts').href);
  const mu = await import(pathToFileURL(here + '/lib/music.ts').href);
  const ha = await import(pathToFileURL(here + '/lib/harmony.ts').href);
  const main = await import(pathToFileURL(mainDir + '/lib/phrase.ts').href);

  const retired = new Set([1094, 1201, 1376, 1184, 1024]);
  const found: ListenSeed[] = [];
  const seen = new Set<string>();
  for (const bars of [2, 4] as const) {
    for (let ci = 0; ci < CTX.length; ci++) {
      const [root, sid, chord] = CTX[ci];
      const sc = mu.SCALES.find((s: { id: string }) => s.id === sid);
      const scaleNotes = mu.spell(root, sc.formula);
      const chordNotes = ha.parseChord(chord).notes;
      const pcs = new Set<number>(scaleNotes.map((n: { pc: number }) => n.pc));
      for (let k = 0; k < 50; k++) {
        const seed = 1000 + ci * 50 + k;
        if (retired.has(seed)) continue;
        const b = head.generatePhrase({ seed, bars, scaleNotes, chordNotes });
        if (!b.ok) continue;
        const bAtoms = playedGroupingAtoms(
          b.phrase.notes.map((n: { midi: number }) => n.midi),
          b.phrase.notes.map((n: { beat: number }) => n.beat),
          pcs,
        );
        if (bAtoms < 1) continue;
        const key = `${root} ${sid} ${chord} ${bars}`;
        if (seen.has(key)) continue;
        const a = main.generatePhrase({ seed, bars, scaleNotes, chordNotes });
        const aAtoms = a.ok
          ? playedGroupingAtoms(
              a.phrase.notes.map((n: { midi: number }) => n.midi),
              a.phrase.notes.map((n: { beat: number }) => n.beat),
              pcs,
            )
          : 0;
        if (aAtoms !== 0) continue;
        seen.add(key);
        found.push({
          seed,
          bars,
          key: root,
          scale: sid,
          chord,
          bpm: 96,
          feel: 'straight',
          bAtoms,
          aAtoms,
        });
      }
    }
  }
  const retiredRows: ListenSeed[] = [];
  for (const seed of retired) {
    const ci = Math.floor((seed - 1000) / 50);
    const row = CTX[ci];
    if (!row) continue;
    const [root, sid, chord] = row;
    const sc = mu.SCALES.find((s: { id: string }) => s.id === sid);
    const scaleNotes = mu.spell(root, sc.formula);
    const chordNotes = ha.parseChord(chord).notes;
    const pcs = new Set<number>(scaleNotes.map((n: { pc: number }) => n.pc));
    const b = head.generatePhrase({
      seed,
      bars: 2,
      scaleNotes,
      chordNotes,
    });
    const a = main.generatePhrase({
      seed,
      bars: 2,
      scaleNotes,
      chordNotes,
    });
    retiredRows.push({
      seed,
      bars: 2,
      key: root,
      scale: sid,
      chord,
      bpm: 96,
      feel: 'straight',
      bAtoms: b.ok
        ? playedGroupingAtoms(
            b.phrase.notes.map((n: { midi: number }) => n.midi),
            b.phrase.notes.map((n: { beat: number }) => n.beat),
            pcs,
          )
        : 0,
      aAtoms: a.ok
        ? playedGroupingAtoms(
            a.phrase.notes.map((n: { midi: number }) => n.midi),
            a.phrase.notes.map((n: { beat: number }) => n.beat),
            pcs,
          )
        : 0,
    });
  }
  console.error(JSON.stringify({ retiredNotForPack: retiredRows }));
  const picked = found.filter((row) => row.bars === 2).slice(0, 5);
  if (picked.length < 5) {
    console.error(`only ${picked.length} two-bar seeds; refusing a short list`);
    process.exit(1);
  }
  for (const row of picked) {
    if (row.bAtoms < 1 || row.aAtoms !== 0) {
      console.error('seed failed verification', row);
      process.exit(1);
    }
  }
  const expected = LISTEN_SEEDS.map((row) => row.seed).join(',');
  const actual = picked.map((row) => row.seed).join(',');
  if (actual !== expected) {
    console.error(`listen seeds moved: ${actual} expected ${expected}`);
    process.exit(1);
  }
  console.log(JSON.stringify(picked, null, 2));
}
