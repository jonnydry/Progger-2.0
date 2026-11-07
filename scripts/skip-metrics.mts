// 800-phrase skip metrics. Same set as RESEARCH-3 §2 / scripts/grouping-metrics.mts.
// Resets both atom counters, then reports skip share, hand cost, fast leaps,
// and the skip-atom drop rate. Fast leaps that are not a 2-string no-shift
// arrival are counted separately from the pinned ones.
import { pathToFileURL } from 'node:url';

const dir = process.argv[2] ?? new URL('..', import.meta.url).pathname;
const ph = await import(pathToFileURL(dir + '/lib/phrase.ts').href);
const mu = await import(pathToFileURL(dir + '/lib/music.ts').href);
const ha = await import(pathToFileURL(dir + '/lib/harmony.ts').href);
const CTX = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F', 'major', 'Fmaj7'],
  ['E', 'minor', 'Em'],
  ['D', 'dorian', 'Dm7'],
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'minor-pentatonic', 'Am7'],
];
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
function grouped(midis: number[], beats: number[], pcs: Set<number>) {
  const hit = Array.from({ length: midis.length }, () => false);
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
      for (let i = s; i < o + k; i++) hit[i] = true;
    }
  }
  return hit.filter(Boolean).length;
}
ph.resetGroupingAtomReport();
ph.resetSkipAtomReport();
let N = 0;
let notes = 0;
let g = 0;
let phrG = 0;
let trans = 0;
let skip = 0;
let adj = 0;
let same = 0;
let wide = 0;
let shiftCost = 0;
let shifts = 0;
let fast6 = 0;
let fastPinned = 0;
let fastUnpinned = 0;
let maxBarArrivals = 0;
const ms: number[] = [];
const listen: {
  seed: number;
  bars: number;
  root: string;
  scale: string;
  chord: string;
  fast: number;
}[] = [];
for (const bars of [2, 4] as const) {
  CTX.forEach(([root, sid, chord], ci) => {
    for (let k = 0; k < 50; k++) {
      const sc = mu.SCALES.find((s: { id: string }) => s.id === sid);
      const sn = mu.spell(root, sc.formula);
      const cn = ha.parseChord(chord).notes;
      const seed = 1000 + ci * 50 + k;
      const t0 = performance.now();
      const r = ph.generatePhrase({
        seed,
        bars,
        scaleNotes: sn,
        chordNotes: cn,
      });
      ms.push(performance.now() - t0);
      if (!r.ok) continue;
      N++;
      const ns = r.phrase.notes;
      const pcs = new Set<number>(sn.map((n: { pc: number }) => n.pc));
      const gm = grouped(
        ns.map((n: { midi: number }) => n.midi),
        ns.map((n: { beat: number }) => n.beat),
        pcs,
      );
      g += gm;
      if (gm) phrG++;
      notes += ns.length;
      const perBar = new Map<number, number>();
      let phraseFast = 0;
      for (let i = 1; i < ns.length; i++) {
        trans++;
        const j = Math.abs(ns[i].string - ns[i - 1].string);
        if (j === 0) same++;
        else if (j === 1) adj++;
        else if (j === 2) skip++;
        else wide++;
        const d = Math.abs(ns[i].position - ns[i - 1].position);
        shiftCost += ph.handShiftCost(d, ns[i].duration <= 0.5);
        if (ns[i].shift) shifts++;
        if (ns[i].duration <= 0.5 && Math.abs(ns[i].midi - ns[i - 1].midi) > 5) {
          fast6++;
          phraseFast++;
          const pinned = j === 2 && d < 4;
          if (pinned) fastPinned++;
          else fastUnpinned++;
          const bar = Math.floor(ns[i].beat / 4);
          const count = (perBar.get(bar) ?? 0) + 1;
          perBar.set(bar, count);
          if (count > maxBarArrivals) maxBarArrivals = count;
        }
      }
      if (phraseFast > 0) {
        listen.push({
          seed,
          bars,
          root,
          scale: sid,
          chord,
          fast: phraseFast,
        });
      }
    }
  });
}
ms.sort((a, b) => a - b);
const pct = (x: number, y: number) =>
  ((100 * x) / Math.max(1, y)).toFixed(2) + '%';
const skipsReport = ph.skipAtomReport();
const groups = ph.groupingAtomReport();
listen.sort((a, b) => b.fast - a.fast);
console.log({
  phrases: N,
  notes,
  groupedNoteShare: pct(g, notes),
  phrasesWithGrouping: pct(phrG, N),
  sameString: pct(same, trans),
  adjacent: pct(adj, trans),
  skip1: pct(skip, trans),
  skip2plus: pct(wide, trans),
  shiftCostPerTransition: (shiftCost / Math.max(1, trans)).toFixed(4),
  shiftsPerPhrase: (shifts / Math.max(1, N)).toFixed(3),
  fastLeapsOver5: fast6,
  fastPinned,
  fastUnpinned,
  maxPinnedArrivalsInABar: maxBarArrivals,
  p95ms: ms[Math.floor(ms.length * 0.95)].toFixed(2),
  p50ms: ms[ms.length >> 1].toFixed(2),
  skipAtomsKept: skipsReport.kept,
  skipAtomsDropped: skipsReport.dropped,
  skipAtomsAttempted: skipsReport.attempted,
  skipAtomDropRate: pct(skipsReport.dropped, skipsReport.attempted),
  playedInside: skipsReport.playedInside,
  playedInsideSkips: skipsReport.playedInsideSkips,
  insideSkipShare: pct(skipsReport.playedInsideSkips, skipsReport.playedInside),
  skipFail: skipsReport.failReason,
  groupingAtoms: groups,
  listen: listen.slice(0, 8),
});
