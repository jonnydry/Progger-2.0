// 800-phrase grouping metrics. Same set as RESEARCH-3 §2.
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
  let strong = 0;
  let onBeat = 0;
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
      const bar = Math.floor(beats[s] / 4);
      const eighth = Math.round((beats[s] - bar * 4) * 2);
      if (eighth === 0 || eighth === 4) strong++;
      if (eighth === 0 || eighth === 2 || eighth === 4) onBeat++;
      for (let i = s; i < o + k; i++) hit[i] = true;
    }
  }
  return { notes: hit.filter(Boolean).length, atoms, strong, onBeat };
}
ph.resetGroupingAtomReport();
let N = 0;
let notes = 0;
let g = 0;
let phrG = 0;
let atoms = 0;
let strongAtoms = 0;
let onBeatAtoms = 0;
let trans = 0;
let skip = 0;
let adj = 0;
let same = 0;
let wide = 0;
let shiftCost = 0;
let shifts = 0;
let fast6 = 0;
const ms: number[] = [];
const listen: {
  seed: number;
  bars: number;
  root: string;
  scale: string;
  chord: string;
  grouped: number;
  notes: number;
}[] = [];
for (const bars of [2, 4]) {
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
      g += gm.notes;
      atoms += gm.atoms;
      strongAtoms += gm.strong;
      onBeatAtoms += gm.onBeat;
      if (gm.notes) phrG++;
      notes += ns.length;
      if (gm.notes >= 6 && bars === 2) {
        listen.push({
          seed,
          bars,
          root,
          scale: sid,
          chord,
          grouped: gm.notes,
          notes: ns.length,
        });
      }
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
        if (ns[i].duration <= 0.5 && Math.abs(ns[i].midi - ns[i - 1].midi) > 5)
          fast6++;
      }
    }
  });
}
ms.sort((a, b) => a - b);
const pct = (x: number, y: number) =>
  ((100 * x) / Math.max(1, y)).toFixed(2) + '%';
const report = ph.groupingAtomReport();
listen.sort((a, b) => b.grouped / b.notes - a.grouped / a.notes);
console.log({
  phrases: N,
  notes,
  groupedNoteShare: pct(g, notes),
  phrasesWithGrouping: pct(phrG, N),
  groupingStartsOnStrong: atoms ? pct(strongAtoms, atoms) : 'n/a',
  groupingStartsOnBeat: atoms ? pct(onBeatAtoms, atoms) : 'n/a',
  sameString: pct(same, trans),
  adjacent: pct(adj, trans),
  skip1: pct(skip, trans),
  skip2plus: pct(wide, trans),
  shiftCostPerTransition: (shiftCost / trans).toFixed(4),
  shiftsPerPhrase: (shifts / N).toFixed(2),
  fastLeapsOver5: fast6,
  p95ms: ms[Math.floor(ms.length * 0.95)].toFixed(2),
  atomsKept: report.kept,
  atomsDropped: report.dropped,
  atomsAttempted: report.attempted,
  atomRejectRate: pct(report.dropped, report.attempted),
  report,
  listen: listen.slice(0, 8),
});
