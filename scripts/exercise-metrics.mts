// Exercise-feel metrics for one engine tree. Read-only on the tree.
//
//   node --experimental-strip-types scripts/exercise-metrics.mts [tree] [out.json]
//
// `tree` defaults to this checkout. Point it at any directory holding
// lib/phrase.ts, lib/music.ts and lib/harmony.ts to measure another revision
// or a candidate change.
//
// Two samples, both deterministic:
//   REVIEW  six roots x fourteen scales x forty seeds x {2,4} bars on the
//           tonic chord (6,720 phrases). Fixed seeds, so two trees produce
//           the same grid and only the engine can move a number.
//   SWEEP   the eight-context, 800-phrase set the musicality test scores, so
//           its ceilings and floors print on the same footing here.
//
// `health.*` is wall-clock milliseconds and `tree` is the path passed in.
// Every other field is a property of the generated notes and repeats exactly;
// `scripts/compare-exercise-metrics.py` prints two runs side by side.
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Note } from '../lib/music.ts';
import type { FingeredNote, PhrasePlan } from '../lib/phrase.ts';

const dir = process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url));
const ph = await import(pathToFileURL(dir + '/lib/phrase.ts').href);
const mu = await import(pathToFileURL(dir + '/lib/music.ts').href);
const ha = await import(pathToFileURL(dir + '/lib/harmony.ts').href);

type Row = {
  root: string;
  scale: string;
  bars: 2 | 4;
  seed: number;
  outSeed: number;
  plan: PhrasePlan;
  notes: FingeredNote[];
  pcs: Set<number>;
  skip: boolean;
  grouping: boolean;
  skipSpots: ({ atom: number } | null)[] | null;
  ms: number;
};

const ROOTS = ['C', 'A', 'E', 'F#', 'Bb', 'G'];
const SCALES = [
  'major',
  'dorian',
  'minor',
  'mixolydian',
  'lydian',
  'phrygian',
  'harmonic-minor',
  'melodic-minor',
  'minor-pentatonic',
  'major-pentatonic',
  'minor-blues',
  'whole-tone',
  'half-whole-diminished',
  'altered',
];
const SWEEP: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['D', 'dorian', 'Dm7'],
  ['E', 'minor', 'Em'],
  ['Bb', 'mixolydian', 'Bb7'],
  ['A', 'harmonic-minor', 'E7'],
];

let failures = 0;

function generate(
  root: string,
  scaleId: string,
  scaleNotes: readonly Note[],
  chordNotes: readonly Note[],
  seed: number,
  bars: 2 | 4,
): Row | null {
  ph.resetSkipAtomReport();
  ph.resetGroupingAtomReport();
  const start = performance.now();
  const result = ph.generatePhrase({ seed, bars, scaleNotes, chordNotes });
  const ms = performance.now() - start;
  if (!result.ok) {
    failures++;
    return null;
  }
  const witness = ph.lastSkipWitness();
  return {
    root,
    scale: scaleId,
    bars,
    seed,
    outSeed: result.phrase.seed,
    plan: result.phrase.plan,
    notes: result.phrase.notes,
    pcs: new Set(scaleNotes.map((note) => note.pc)),
    skip: Boolean(witness?.spots.some(Boolean)),
    grouping: Boolean(witness?.groupingBars.length),
    skipSpots: witness ? witness.spots : null,
    ms,
  };
}

function context(root: string, scaleId: string, chord: string | null) {
  const scale = mu.SCALES.find((item: { id: string }) => item.id === scaleId);
  if (!scale) throw new Error(`unknown scale ${scaleId}`);
  const scaleNotes = mu.spell(root, scale.formula);
  const chordNotes = chord
    ? ha.parseChord(chord).notes
    : ph.defaultChordNotes(scaleNotes);
  return { scaleNotes, chordNotes };
}

const review: Row[] = [];
for (const bars of [2, 4] as const) {
  ROOTS.forEach((root, rootIndex) => {
    SCALES.forEach((scaleId, scaleIndex) => {
      const { scaleNotes, chordNotes } = context(root, scaleId, null);
      for (let index = 0; index < 40; index++) {
        const row = generate(
          root,
          scaleId,
          scaleNotes,
          chordNotes,
          100000 + rootIndex * 10007 + scaleIndex * 613 + index * 37,
          bars,
        );
        if (row) review.push(row);
      }
    });
  });
}

const sweep: Row[] = [];
for (const [root, scaleId, chord] of SWEEP) {
  const { scaleNotes, chordNotes } = context(root, scaleId, chord);
  for (const bars of [2, 4] as const) {
    for (let seed = 1; seed <= 50; seed++) {
      const row = generate(root, scaleId, scaleNotes, chordNotes, seed, bars);
      if (row) sweep.push(row);
    }
  }
}

const pct = (part: number, whole: number) =>
  +((100 * part) / Math.max(1, whole)).toFixed(1);
const mean = (part: number, phrases: number) => +(part / phrases).toFixed(2);
const mod = (value: number) => ((value % 12) + 12) % 12;

/** Signed count of scale steps from `from` to `to`. */
function steps(from: number, to: number, pcs: ReadonlySet<number>): number {
  if (from === to) return 0;
  const sign = Math.sign(to - from);
  let midi = from;
  let count = 0;
  while (midi !== to && count < 40) {
    midi += sign;
    if (pcs.has(mod(midi))) count++;
  }
  return sign * count;
}

/** Everything the phrase sounds; the closing cadence sits past the last bar. */
const body = (row: Row) => row.notes.filter((note) => note.beat < row.bars * 4);
const onsetKey = (row: Row) =>
  body(row)
    .map((note) => note.beat)
    .join(' ');

/**
 * A literal scale sequence: 2k consecutive eighths whose second k-cell is the
 * first moved one or two scale steps. Counts notes inside such a pair, so a
 * phrase can carry one across a bar line.
 */
function sequenceNotes(row: Row): number {
  const notes = body(row);
  const hit = new Set<number>();
  for (const k of [3, 4]) {
    for (let start = 0; start + 2 * k <= notes.length; start++) {
      let ok = true;
      for (let index = 0; index < 2 * k - 1; index++) {
        if (
          Math.abs(
            (notes[start + index + 1]?.beat ?? 0) -
              (notes[start + index]?.beat ?? 0) -
              0.5,
          ) > 1e-6
        )
          ok = false;
      }
      if (!ok) continue;
      const shift = steps(
        notes[start]?.midi ?? 0,
        notes[start + k]?.midi ?? 0,
        row.pcs,
      );
      if (Math.abs(shift) < 1 || Math.abs(shift) > 2) continue;
      for (let index = 1; index < k; index++) {
        if (
          steps(
            notes[start + index]?.midi ?? 0,
            notes[start + k + index]?.midi ?? 0,
            row.pcs,
          ) !== shift
        )
          ok = false;
      }
      if (!ok) continue;
      for (let index = 0; index < 2 * k; index++) hit.add(start + index);
    }
  }
  return hit.size;
}

function count(rows: readonly Row[], key: (row: Row) => string) {
  const tally = new Map<string, number>();
  for (const row of rows) tally.set(key(row), (tally.get(key(row)) ?? 0) + 1);
  return [...tally.entries()].sort((left, right) => right[1] - left[1]);
}

/** Chance two draws share a rhythm, summed over the observed rhythms. */
function collide(rows: readonly [string, number][], total: number): number {
  return +(
    100 * rows.reduce((sum, [, hits]) => sum + (hits / total) ** 2, 0)
  ).toFixed(1);
}

function measure(set: readonly Row[], label: string) {
  const phrases = set.length;
  const two = set.filter((row) => row.bars === 2);
  const eighths = set.filter((row) => row.plan.rhythm === 'eighths');
  const twoBarRhythms = count(two, onsetKey);
  const bar1 = count(set, (row) => row.plan.cells?.[0] ?? '?');
  const bar1Eighths = count(eighths, (row) => row.plan.cells?.[0] ?? '?');

  let firstHeld = 0;
  let firstOnDown = 0;
  let rests = 0;
  let maxRestBeats = 0;
  let quarterOrLongerRests = 0;
  let offbeatSustained = 0;
  let sync = 0;
  let eighthOnsets = 0;
  let onsets = 0;
  let longestRun = 0;
  let hasRun6 = 0;
  let midHeld = 0;
  let endsHeld = 0;
  let barsTotal = 0;
  let adjacentSame = 0;
  let onsetsPerBar = 0;
  for (const row of set) {
    const notes = body(row);
    if ((notes[0]?.duration ?? 0) >= 1) firstHeld++;
    if ((notes[0]?.beat ?? 1) === 0) firstOnDown++;
    let run = 0;
    let best = 0;
    notes.forEach((note, index) => {
      onsets++;
      const next = row.notes[row.notes.indexOf(note) + 1];
      const gap = next ? next.beat - note.beat : note.duration;
      if (next && note.beat + note.duration < next.beat - 1e-6) {
        const rest = +(next.beat - (note.beat + note.duration)).toFixed(4);
        rests++;
        if (rest > maxRestBeats) maxRestBeats = rest;
        if (rest >= 1 - 1e-6) quarterOrLongerRests++;
      }
      if (Math.abs((note.beat % 1) - 0.5) < 0.01 && note.duration > 0.5 + 1e-6) {
        offbeatSustained++;
      }
      if (
        Math.abs((note.beat % 1) - 0.5) < 0.01 &&
        !row.notes.some(
          (other) => Math.abs(other.beat - (Math.floor(note.beat) + 1)) < 0.01,
        )
      )
        sync++;
      if (Math.abs(gap - 0.5) < 1e-6) {
        eighthOnsets++;
        run++;
        if (run > best) best = run;
      } else run = 0;
      if (index > 0 && index < notes.length - 1 && note.duration >= 1)
        midHeld++;
    });
    longestRun += best;
    if (best >= 6) hasRun6++;
    if ((notes[notes.length - 1]?.duration ?? 0) >= 1) endsHeld++;
    onsetsPerBar += notes.length / row.bars;
    const signature = (bar: number) =>
      notes
        .filter((note) => Math.floor(note.beat / 4) === bar)
        .map((note) => note.beat - 4 * bar)
        .join(',');
    for (let bar = 1; bar < row.bars; bar++) {
      barsTotal++;
      if (signature(bar) === signature(bar - 1)) adjacentSame++;
    }
  }

  let moves = 0;
  let stepsShare = 0;
  let thirds = 0;
  let wide = 0;
  let wideWithNext = 0;
  let unisons = 0;
  let settled = 0;
  let settledStep = 0;
  let sameDirection = 0;
  let top2 = 0;
  let topHeavy = 0;
  let distinctPitch = 0;
  let sequencePhrases = 0;
  let sequenceNoteCount = 0;
  let answered = 0;
  let aba = 0;
  let abaPairs = 0;

  let shiftOntoEighth = 0;
  let reachOntoEighth = 0;
  let wideOntoEighth = 0;
  let wideOntoEighthAsTwoStringSkip = 0;
  let withShift = 0;
  let sameFingerNewFretOnEighth = 0;
  let rolls = 0;
  let fastSameFingerRolls = 0;
  let fastNonAdjFingerRolls = 0;
  let unnecessaryMultiStringJumps = 0;
  let midPhrases = 0;
  let openStringInMid = 0;
  let midCollapsedLow = 0;
  let highPhrases = 0;
  let openStringInHigh = 0;
  let consecWideLeaps = 0;
  let exactBar2Copy = 0;
  let modalColorTotal = 0;
  let modalColorHits = 0;
  let modalColorStrongHits = 0;
  const spans: number[] = [];
  const skipKinds = new Map<string, number>();

  const MODAL_COLOR_DEGREES: Record<string, readonly string[]> = {
    dorian: ['6'],
    lydian: ['#4'],
    phrygian: ['b2'],
    mixolydian: ['b7'],
    'harmonic-minor': ['7'],
    'melodic-minor': ['6', '7'],
    'minor-blues': ['b5'],
  };

  for (const row of set) {
    const colorDegrees = MODAL_COLOR_DEGREES[row.scale];
    if (colorDegrees) {
      modalColorTotal++;
      const bodyNotes = body(row);
      if (bodyNotes.some((note) => colorDegrees.includes(note.degree)))
        modalColorHits++;
      if (
        bodyNotes.some(
          (note) => note.strong && colorDegrees.includes(note.degree),
        )
      )
        modalColorStrongHits++;
    }
    if (row.plan.register === 'mid') {
      midPhrases++;
      if (row.notes.some((note) => note.fret === 0)) openStringInMid++;
      const frettedPositions = row.notes
        .filter((note) => note.fret > 0)
        .map((note) => note.position);
      if (
        frettedPositions.length > 0 &&
        Math.min(...frettedPositions) <= 2
      ) {
        midCollapsedLow++;
      }
    }
    if (row.plan.register === 'high') {
      highPhrases++;
      if (row.notes.some((note) => note.fret === 0)) openStringInHigh++;
    }
    const midis = row.notes.map((note) => note.midi);
    const counts = new Map<number, number>();
    for (const midi of midis) counts.set(midi, (counts.get(midi) ?? 0) + 1);
    const ranked = [...counts.values()].sort((left, right) => right - left);
    const share =
      ((ranked[0] ?? 0) + (ranked[1] ?? 0)) / Math.max(1, midis.length);
    top2 += share;
    if (share > 0.45) topHeavy++;
    distinctPitch += counts.size / midis.length;

    const sequence = sequenceNotes(row);
    if (sequence) sequencePhrases++;
    sequenceNoteCount += sequence;

    for (let index = 1; index < row.notes.length; index++) {
      const previous = row.notes[index - 1];
      const note = row.notes[index];
      const next = row.notes[index + 1];
      if (!previous || !note) continue;
      const gap = note.midi - previous.midi;
      const distance = Math.abs(gap);
      moves++;
      if (distance === 0) unisons++;
      else if (distance <= 2) stepsShare++;
      else if (distance <= 4) thirds++;
      if (distance >= 5) {
        wide++;
        if (next) {
          wideWithNext++;
          const after = next.midi - note.midi;
          const opposite = Math.sign(after) === -Math.sign(gap);
          if (opposite && Math.abs(after) >= 1 && Math.abs(after) <= 2)
            settled++;
          if (opposite && Math.abs(steps(note.midi, next.midi, row.pcs)) === 1)
            settledStep++;
          if (Math.sign(after) === Math.sign(gap)) sameDirection++;
          if (Math.abs(after) >= 5) consecWideLeaps++;
        }
      }
      if (index >= 2) {
        abaPairs++;
        if (note.midi === row.notes[index - 2]?.midi) aba++;
      }
      const fast = note.duration <= 0.5;
      const handMove = Math.abs(note.position - previous.position);
      if (fast && distance > 5) {
        wideOntoEighth++;
        if (Math.abs(note.string - previous.string) === 2 && handMove < 4)
          wideOntoEighthAsTwoStringSkip++;
      }
      if (note.fret !== 0 && previous.fret !== 0) {
        if (handMove >= 4 && fast) shiftOntoEighth++;
        else if (handMove > 0 && fast) reachOntoEighth++;
      }
      if (
        note.finger > 0 &&
        note.finger === previous.finger &&
        note.fret !== previous.fret &&
        fast
      )
        sameFingerNewFretOnEighth++;
      if (
        note.finger > 0 &&
        note.finger === previous.finger &&
        note.fret === previous.fret &&
        note.string !== previous.string
      ) {
        rolls++;
        if (fast) {
          fastSameFingerRolls++;
          if (Math.abs(note.string - previous.string) >= 2) {
            fastNonAdjFingerRolls++;
          }
        }
      }
      const stringDist = Math.abs(note.string - previous.string);
      const inSkip =
        Boolean(row.skipSpots?.[index]) || Boolean(row.skipSpots?.[index - 1]);
      if (stringDist >= 2 && distance <= 5 && !inSkip) {
        unnecessaryMultiStringJumps++;
      }
    }

    if (row.notes.some((note) => note.shift)) withShift++;
    const frets = row.notes
      .filter((note) => note.fret > 0)
      .map((note) => note.fret);
    if (frets.length) spans.push(Math.max(...frets) - Math.min(...frets));

    const notes = body(row);
    const opening = notes
      .filter((note) => Math.floor(note.beat / 4) === 0)
      .slice(0, 4);
    const answerBar = notes
      .filter((note) => Math.floor(note.beat / 4) === 1)
      .slice(0, 4);
    if (
      opening.length === 4 &&
      answerBar.length === 4 &&
      opening.every(
        (note, index) => note.beat === (answerBar[index]?.beat ?? -9) - 4,
      )
    ) {
      const shape = (group: readonly FingeredNote[]) =>
        group
          .slice(1)
          .map((note, index) =>
            steps(group[index]?.midi ?? 0, note.midi, row.pcs),
          )
          .join(',');
      if (shape(opening) === shape(answerBar)) answered++;
      if (
        opening.every(
          (note, index) => note.midi === answerBar[index]?.midi,
        )
      ) {
        exactBar2Copy++;
      }
    }

    if (row.skip && row.skipSpots) {
      const atoms = new Map<number, number[]>();
      row.skipSpots.forEach((spot, index) => {
        if (!spot) return;
        atoms.set(spot.atom, [...(atoms.get(spot.atom) ?? []), index]);
      });
      for (const indexes of atoms.values()) {
        const atomMidis = indexes.map((index) => row.notes[index]?.midi ?? 0);
        const gaps = atomMidis
          .slice(1)
          .map((midi, index) => Math.abs(midi - (atomMidis[index] ?? 0)));
        let kind = 'other';
        if (atomMidis.length === 2 && gaps[0] === 12) kind = 'octave';
        else if (atomMidis.length === 2 && (gaps[0] === 8 || gaps[0] === 9))
          kind = 'sixth';
        else if (atomMidis.length === 4 && atomMidis[0] === atomMidis[2])
          kind = 'pedal';
        else if (
          atomMidis.length === 4 &&
          [8, 9].includes(gaps[0] ?? 0) &&
          [8, 9].includes(gaps[2] ?? 0)
        )
          kind = 'sixth-pair';
        else if (atomMidis.length >= 3) kind = 'arp';
        skipKinds.set(kind, (skipKinds.get(kind) ?? 0) + 1);
      }
    }
  }

  let wrapStep = 0;
  let wrapStepOntoChordTone = 0;
  let wrapFourthOrWider = 0;
  let stepIntoCadence = 0;
  let scaleStepIntoCadence = 0;
  let cadenceLeaps6Plus = 0;
  let firstChordTone = 0;
  let strong = 0;
  let strongChord = 0;
  for (const row of set) {
    const notes = body(row);
    const last = notes[notes.length - 1];
    const first = row.notes[0];
    const cadence = row.notes[row.notes.length - 1];
    const approach = row.notes[row.notes.length - 2];
    if (last && first) {
      const wrap = Math.abs(steps(last.midi, first.midi, row.pcs));
      if (wrap === 1) {
        wrapStep++;
        if (first.chordTone) wrapStepOntoChordTone++;
      }
      if (Math.abs(first.midi - last.midi) >= 5) wrapFourthOrWider++;
    }
    if (cadence && approach) {
      const close = Math.abs(cadence.midi - approach.midi);
      if (close === 1 || close === 2) stepIntoCadence++;
      if (Math.abs(steps(approach.midi, cadence.midi, row.pcs)) === 1)
        scaleStepIntoCadence++;
      if (close >= 6) cadenceLeaps6Plus++;
    }
    if (first?.chordTone) firstChordTone++;
    for (const note of row.notes) {
      if (!note.strong) continue;
      strong++;
      if (note.chordTone) strongChord++;
    }
  }

  const lines = new Set(
    set.map(
      (row) =>
        `${row.root}${row.scale}${row.bars}:` +
        row.notes.map((note) => `${note.midi}@${note.beat}`).join(','),
    ),
  );
  const times = set.map((row) => row.ms).sort((left, right) => left - right);
  spans.sort((left, right) => left - right);

  return {
    label,
    phrases,
    rhythm: {
      eighthsLaneShare: pct(eighths.length, phrases),
      eighthsOpen_q_ee_ee_ee: pct(
        eighths.filter((row) => row.plan.cells?.[0] === 'q ee ee ee').length,
        eighths.length,
      ),
      allOpen_q_ee_ee_ee: pct(
        set.filter((row) => row.plan.cells?.[0] === 'q ee ee ee').length,
        phrases,
      ),
      bar1Top3: bar1
        .slice(0, 3)
        .map(([id, hits]) => `${id} ${pct(hits, phrases)}%`),
      bar1EighthsLane: bar1Eighths
        .slice(0, 9)
        .map(([id, hits]) => `${id} ${pct(hits, eighths.length)}%`),
      bar1ByLane: Object.fromEntries(
        ['quarters', 'long-short', 'push'].map((lane) => {
          const rows = set.filter((row) => row.plan.rhythm === lane);
          return [
            lane,
            count(rows, (row) => row.plan.cells?.[0] ?? '?')
              .slice(0, 4)
              .map(([id, hits]) => `${id} ${pct(hits, rows.length)}%`),
          ];
        }),
      ),
      twoBar_distinctRhythms: twoBarRhythms.length,
      twoBar_top1: pct(twoBarRhythms[0]?.[1] ?? 0, two.length),
      twoBar_top5: pct(
        twoBarRhythms.slice(0, 5).reduce((sum, [, hits]) => sum + hits, 0),
        two.length,
      ),
      twoBar_sameRhythmTwiceInARow: collide(twoBarRhythms, two.length),
      firstNoteHeld: pct(firstHeld, phrases),
      firstOnDownbeat: pct(firstOnDown, phrases),
      lastBodyNoteHeld: pct(endsHeld, phrases),
      onsetsPerBar: +(onsetsPerBar / phrases).toFixed(2),
      eighthMotionShare: pct(eighthOnsets, onsets),
      longestEighthRunMean: mean(longestRun, phrases),
      phrasesWithRunOf6: pct(hasRun6, phrases),
      restsPerPhrase: mean(rests, phrases),
      maxRestBeats,
      quarterOrLongerRestsPerPhrase: mean(quarterOrLongerRests, phrases),
      offbeatSustainedShare: pct(offbeatSustained, onsets),
      syncPerPhrase: mean(sync, phrases),
      heldMidPhrasePerPhrase: mean(midHeld, phrases),
      adjacentBarsSameRhythm: pct(adjacentSame, barsTotal),
    },
    pitch: {
      steps: pct(stepsShare, moves),
      thirds: pct(thirds, moves),
      wide: pct(wide, moves),
      unisons,
      wideSettled: pct(settled, wide),
      wideSettledCount: `${settled}/${wide}`,
      wideSettledByScaleStep: pct(settledStep, wideWithNext),
      wideKeepsGoingSameDirection: pct(sameDirection, wideWithNext),
      consecWideLeapShare: pct(consecWideLeaps, wideWithNext),
      topHeavy_gt45: pct(topHeavy, phrases),
      topHeavyCount: `${topHeavy}/${phrases}`,
      meanTop2: +(top2 / phrases).toFixed(3),
      distinctPitchRatio: +(distinctPitch / phrases).toFixed(3),
      abaShare: pct(aba, abaPairs),
      literalSequencePhrases: pct(sequencePhrases, phrases),
      literalSequenceNoteShare: pct(
        sequenceNoteCount,
        set.reduce((sum, row) => sum + body(row).length, 0),
      ),
      bar2AnswersBar1: pct(answered, phrases),
      exactBar2CopyPct: pct(exactBar2Copy, phrases),
      characteristicColorPhrasesPct: pct(modalColorHits, modalColorTotal),
      characteristicColorStrongPct: pct(modalColorStrongHits, modalColorTotal),
      identicalLinesAcrossSeeds: phrases - lines.size,
    },
    figures: {
      withSkip: pct(set.filter((row) => row.skip).length, phrases),
      withGrouping: pct(set.filter((row) => row.grouping).length, phrases),
      withEither: pct(
        set.filter((row) => row.skip || row.grouping).length,
        phrases,
      ),
      withEither2bar: pct(
        two.filter((row) => row.skip || row.grouping).length,
        two.length,
      ),
      withEither4bar: pct(
        set.filter((row) => row.bars === 4 && (row.skip || row.grouping))
          .length,
        phrases - two.length,
      ),
      skipKinds: Object.fromEntries(
        [...skipKinds.entries()].sort((left, right) => right[1] - left[1]),
      ),
    },
    landing: {
      firstNoteChordTone: pct(firstChordTone, phrases),
      strongBeatChordTone: pct(strongChord, strong),
      stepsIntoCadence: pct(stepIntoCadence, phrases),
      scaleStepIntoCadence: pct(scaleStepIntoCadence, phrases),
      cadenceLeaps6Plus: pct(cadenceLeaps6Plus, phrases),
      wrapStep: pct(wrapStep, phrases),
      wrapStepOntoChordTone: pct(wrapStepOntoChordTone, phrases),
      wrapFourthOrWider: pct(wrapFourthOrWider, phrases),
    },
    hand: {
      shiftOntoEighth,
      reachOntoEighth,
      phrasesWithShift: pct(withShift, phrases),
      wideOntoEighth,
      wideOntoEighthAsTwoStringSkip,
      sameFingerNewFretOnEighth,
      sameFingertipRollShare: pct(rolls, moves),
      fastSameFingerRolls,
      fastNonAdjFingerRolls,
      unnecessaryMultiStringJumps,
      openStringInMidPct: pct(openStringInMid, midPhrases),
      openStringInHighPct: pct(openStringInHigh, highPhrases),
      midCollapsedLowPct: pct(midCollapsedLow, midPhrases),
      fretSpanP50: spans[Math.floor(spans.length * 0.5)] ?? 0,
      fretSpanP90: spans[Math.floor(spans.length * 0.9)] ?? 0,
      fretSpanMax: spans[spans.length - 1] ?? 0,
    },
    health: {
      seedDrift: set.filter((row) => row.outSeed !== row.seed).length,
      msP50: +(times[Math.floor(phrases * 0.5)] ?? 0).toFixed(2),
      msP99: +(times[Math.floor(phrases * 0.99)] ?? 0).toFixed(2),
      msMax: +(times[phrases - 1] ?? 0).toFixed(1),
    },
  };
}

const out = {
  tree: dir,
  failures,
  REVIEW: measure(review, 'REVIEW 6720'),
  REVIEW_eighths: measure(
    review.filter((row) => row.plan.rhythm === 'eighths'),
    'REVIEW eighths lane',
  ),
  SWEEP: measure(sweep, 'SWEEP 800 (test set)'),
};

const text = JSON.stringify(out, null, 1);
if (process.argv[3]) writeFileSync(process.argv[3], text + '\n');
console.log(text);
