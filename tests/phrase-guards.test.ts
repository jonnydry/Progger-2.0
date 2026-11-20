import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseChord } from '../lib/harmony.ts';
import { patterns, SCALES, spell, type Note } from '../lib/music.ts';
import { generatePhrase, type Phrase } from '../lib/phrase.ts';

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

function scaleOf(root: string, id: string): Note[] {
  const scale = SCALES.find((item) => item.id === id);
  assert.ok(scale, id);
  return spell(root, scale.formula);
}

/** Form lookup in the engine's keying, rebuilt here so a test can disagree. */
function formLookupFor(forms: readonly { positions: readonly { string: number; fret: number }[] }[]): ReadonlyMap<number, number[]> {
  const map = new Map<number, number[]>();
  forms.forEach((form, index) => {
    for (const position of form.positions) {
      const key = position.string * 32 + position.fret;
      const list = map.get(key);
      if (list) list.push(index);
      else map.set(key, [index]);
    }
  });
  return map;
}

/** Two strings apart, both in a form, and those forms within one of each other. */
function skipOneFormApart(
  shapes: ReadonlyMap<number, number[]>,
  from: { string: number; fret: number },
  to: { string: number; fret: number },
): boolean {
  if (Math.abs(from.string - to.string) !== 2) return false;
  const left = shapes.get(from.string * 32 + from.fret) ?? [];
  const right = shapes.get(to.string * 32 + to.fret) ?? [];
  if (!left.length || !right.length) return false;
  return left.some((a) => right.some((b) => Math.abs(a - b) <= 1));
}

function phrase(
  root: string,
  scaleId: string,
  symbol: string,
  seed: number,
  bars: 2 | 4,
): Phrase {
  const result = generatePhrase({
    seed,
    bars,
    scaleNotes: scaleOf(root, scaleId),
    chordNotes: parseChord(symbol).notes,
  });
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error(symbol);
  return result.phrase;
}

function scaleStep(from: number, to: number, pcs: ReadonlySet<number>): number {
  if (from === to) return 0;
  const sign = Math.sign(to - from);
  let midi = from;
  let count = 0;
  while (midi !== to && count < 24) {
    midi += sign;
    if (pcs.has(((midi % 12) + 12) % 12)) count += 1;
  }
  return sign * count;
}

function eighth(beat: number): number {
  const bar = Math.floor(beat / 4);
  return Math.round((beat - bar * 4) * 2);
}

/** The attacks inside one bar, as eighths from its downbeat. */
function barOnsets(line: Phrase, bar: number): string {
  return line.notes
    .filter(
      (note) => Math.floor(note.beat / 4) === bar && note.beat < line.bars * 4,
    )
    .map((note) => eighth(note.beat))
    .join(',');
}

function monotone(midis: readonly number[], pcs: ReadonlySet<number>): number {
  let best = 1;
  let run = 1;
  let dir = 0;
  for (let index = 1; index < midis.length; index++) {
    const delta = scaleStep(midis[index - 1] ?? 0, midis[index] ?? 0, pcs);
    if (Math.abs(delta) === 1 && delta === dir) run += 1;
    else if (Math.abs(delta) === 1) {
      dir = delta;
      run = 2;
    } else {
      dir = 0;
      run = 1;
    }
    if (run > best) best = run;
  }
  return best;
}

/** A 6-note ABCABC that is not the shifted 4-note return sitting on itself. */
function period3Outside(
  notes: Phrase['notes'],
  pcs: ReadonlySet<number>,
): boolean {
  const midis = notes.map((note) => note.midi);
  const grouped = [0, 1].map((bar) =>
    notes
      .map((note, index) => ({ note, index }))
      .filter(
        (item) => Math.floor(item.note.beat / 4) === bar && item.note.beat < 8,
      ),
  );
  let cover: [number, number] | null = null;
  const left = grouped[0] ?? [];
  const right = grouped[1] ?? [];
  if (left.length >= 4 && right.length >= 4) {
    let matched = true;
    for (let index = 0; index < 4; index++) {
      const a = left[index]?.note;
      const b = right[index]?.note;
      if (!a || !b || eighth(a.beat) !== eighth(b.beat)) matched = false;
    }
    for (let index = 1; index < 4 && matched; index++) {
      if (
        scaleStep(
          left[index - 1]?.note.midi ?? 0,
          left[index]?.note.midi ?? 0,
          pcs,
        ) !==
        scaleStep(
          right[index - 1]?.note.midi ?? 0,
          right[index]?.note.midi ?? 0,
          pcs,
        )
      )
        matched = false;
    }
    if (matched) cover = [left[0]?.index ?? 0, (right[3]?.index ?? 0) + 1];
  }
  const length = 6;
  for (let start = 0; start + length <= midis.length; start++) {
    if (cover && start >= cover[0] && start + length <= cover[1]) continue;
    let match = true;
    for (let index = 3; index < length; index++) {
      if (midis[start + index] !== midis[start + (index % 3)]) match = false;
    }
    if (match && new Set(midis.slice(start, start + 3)).size >= 2) return true;
  }
  return false;
}

void test('sentence guards stay visible in the notes', () => {
  let phrases = 0;
  let four = 0;
  let leap = 0;
  let sequenced = 0;
  let freeFour = 0;
  let freeSequenced = 0;
  let heldOpen = 0;
  let nonEighthOpen = 0;
  const OPEN_GUARD: Record<string, { held: number; total: number }> = {
    quarters: { held: 0, total: 0 },
    'long-short': { held: 0, total: 0 },
    push: { held: 0, total: 0 },
  };
  let bars = 0;
  let silent = 0;
  let returned = 0;
  let monotonePhrases = 0;
  let period3 = 0;
  let strong = 0;
  let strongChord = 0;
  let sync = 0;
  let syncNotes = 0;
  let repeatedCells = 0;
  let repeatedOnsets = 0;
  for (const [root, scaleId, symbol] of SWEEP) {
    const scaleNotes = scaleOf(root, scaleId);
    const pcs = new Set(scaleNotes.map((note) => note.pc));
    for (const barsCount of [2, 4] as const) {
      for (let seed = 1; seed <= 25; seed++) {
        const line = phrase(root, scaleId, symbol, seed, barsCount);
        phrases += 1;
        const notes = line.notes;
        const closing = notes.at(-1);
        const before = notes.at(-2);
        if (closing && before && Math.abs(closing.midi - before.midi) >= 3)
          leap += 1;
        // The eighths lane no longer forces a held first note, so a run can
        // start on beat 1. The other lanes keep the hold in their patterns,
        // but not at one rate: quarters and long-short open held every time,
        // while the push lane's anticipations open on an eighth about two
        // times in five. Counted per lane, so the check below can hold each
        // one to its own rate instead of an average that hides the push lane.
        if (line.plan.rhythm !== 'eighths') {
          nonEighthOpen += 1;
          if ((notes[0]?.duration ?? 0) >= 1) heldOpen += 1;
          const lane = OPEN_GUARD[line.plan.rhythm];
          lane.total += 1;
          if ((notes[0]?.duration ?? 0) >= 1) lane.held += 1;
        }
        for (const note of notes) {
          if (note.shift) assert.ok(note.duration > 0.5);
        }
        const body = notes.filter((note) => note.beat < barsCount * 4);
        const groups = Array.from({ length: barsCount }, (_, bar) =>
          body.filter((note) => Math.floor(note.beat / 4) === bar),
        );
        for (const group of groups) {
          bars += 1;
          if (
            !group.some(
              (note) => Math.abs(note.beat - Math.round(note.beat)) < 1e-6,
            )
          )
            silent += 1;
        }
        const opening = groups[0] ?? [];
        const answer = groups[1] ?? [];
        if (opening.length >= 4 && answer.length >= 4) {
          const rhythm = (group: typeof opening) =>
            group
              .slice(0, 4)
              .map((note) => eighth(note.beat))
              .join(',');
          const motion = (group: typeof opening) =>
            group
              .slice(0, 4)
              .slice(1)
              .map((note, index) =>
                scaleStep(group[index]?.midi ?? 0, note.midi, pcs),
              )
              .join(',');
          if (
            rhythm(opening) === rhythm(answer) &&
            motion(opening) === motion(answer)
          )
            returned += 1;
        }
        if (barsCount === 4) {
          four += 1;
          const free = seed % 4 === 0;
          if (free) freeFour += 1;
          const head = groups[0] ?? [];
          const fragment = groups[2] ?? [];
          if (head.length >= 2 && fragment.length >= 4) {
            const first = eighth(head[0]?.beat ?? 0);
            const second = eighth(head[1]?.beat ?? 0);
            const secondDur = Math.max(
              1,
              Math.round((head[1]?.duration ?? 0.5) * 2),
            );
            const span = second + secondDur - first;
            const rhythm =
              eighth(fragment[0]?.beat ?? 0) === first &&
              eighth(fragment[1]?.beat ?? 0) === second &&
              eighth(fragment[2]?.beat ?? 0) === first + span &&
              eighth(fragment[3]?.beat ?? 0) === second + span;
            const idea = scaleStep(head[0]?.midi ?? 0, head[1]?.midi ?? 0, pcs);
            const left = scaleStep(
              fragment[0]?.midi ?? 0,
              fragment[1]?.midi ?? 0,
              pcs,
            );
            const right = scaleStep(
              fragment[2]?.midi ?? 0,
              fragment[3]?.midi ?? 0,
              pcs,
            );
            if (
              rhythm &&
              idea === left &&
              left === right &&
              fragment[0]?.midi !== fragment[2]?.midi
            ) {
              sequenced += 1;
              if (free) freeSequenced += 1;
            }
          }
        }
        if (
          monotone(
            notes.map((note) => note.midi),
            pcs,
          ) >= 5
        )
          monotonePhrases += 1;
        if (period3Outside(notes, pcs)) period3 += 1;
        for (const note of notes) {
          syncNotes += 1;
          if (note.strong && note.chordTone) strongChord += 1;
          if (note.strong) strong += 1;
          const fraction = note.beat - Math.floor(note.beat + 1e-9);
          if (Math.abs(fraction - 0.5) >= 0.01) continue;
          const following = Math.floor(note.beat) + 1;
          const struck = notes.some(
            (item) => Math.abs(item.beat - following) < 0.01,
          );
          if (!struck) sync += 1;
        }
        const cells = line.plan.cells ?? [];
        for (let index = 1; index < cells.length; index++) {
          if (cells[index] === cells[index - 1]) repeatedCells += 1;
        }
        // Compare what sounds: two bars can share a label ("ans 0,1,2,3")
        // and still attack at different places.
        for (let index = 1; index < barsCount; index++) {
          if (barOnsets(line, index) === barOnsets(line, index - 1))
            repeatedOnsets += 1;
        }
      }
    }
  }
  assert.equal(phrases, 400);
  // One seed in four is a free line: seeds 4, 8, 12, 16, 20 and 24 are free,
  // so 6 of the 25 four-bar phrases in each of the 8 contexts, 48 of 200.
  assert.equal(freeFour, 48);
  assert.ok(leap / phrases <= 0.5, `leap close ${leap}/${phrases}`);
  // Answering seeds still sequence bar 3: 139 of 152 here. Free seeds skip
  // the bar-3 fragment chooser, so only 5 of 48 land on the same two
  // intervals by accident. The two rates are what separate the paths now
  // that there are twice as many free seeds as before (S5).
  assert.ok(
    (sequenced - freeSequenced) / (four - freeFour) >= 0.6,
    `answering fragment ${sequenced - freeSequenced}/${four - freeFour}`,
  );
  // Free lines must stay far below the answering path: 5 of 48 (10.4%)
  // against 143 of 152 (94.1%) here. The gap is the property; an absolute
  // count would only re-encode how many free seeds the sweep happens to have.
  assert.ok(
    freeSequenced / freeFour <= 0.2,
    `free fragment ${freeSequenced}/${freeFour}`,
  );
  // The rate against the answering path comes from the loop-wrap commit;
  // the 0.8 aggregate floor is main's (Rev's tightening), kept as-is.
  assert.ok(
    freeSequenced / freeFour <= 0.25 * ((sequenced - freeSequenced) / (four - freeFour)),
    `free fragment rate against answering ${freeSequenced}/${freeFour}`,
  );
  assert.ok(
    heldOpen / nonEighthOpen >= 0.8,
    `held opening outside the eighths lane ${heldOpen}/${nonEighthOpen}`,
  );
  // Per lane, because the aggregate above hides the push lane: at seeds 1-300
  // quarters and long-short hold 512/512 and 464/464, while push holds
  // 433/720 (60.1%). Each floor sits about 5 points under its measured rate.
  for (const [lane, floor] of [
    ['quarters', 0.95],
    ['long-short', 0.95],
    ['push', 0.5],
  ] as const) {
    const row = OPEN_GUARD[lane];
    assert.ok(row && row.total > 0, `no ${lane} phrases`);
    assert.ok(
      row.held / row.total >= floor,
      `${lane} held opening ${row.held}/${row.total}`,
    );
  }
  assert.ok(silent / bars <= 0.02, `no on-beat ${silent}/${bars}`);
  // One seed in four is now a free line, so the bar-2 return is 74.8% of
  // phrases. The floor sits at 70%.
  assert.ok(returned / phrases >= 0.7, `return ${returned}/${phrases}`);
  assert.ok(
    monotonePhrases / phrases <= 0.02,
    `monotone ${monotonePhrases}/${phrases}`,
  );
  // The walk refuses a 3-cycle on its own. Two phrases appear when that
  // refusal is off, which still sits under a 0.8% ceiling.
  assert.equal(period3, 0, `period-3 ${period3}/${phrases}`);
  // Held notes are chord tones, so strong beats sit on the chord more
  // often. Before the free bar-3 skip this sweep was 85.46% (1846/2160).
  // After it, 86.33% (1870/2166). The wider band stops at 88%.
  assert.ok(
    strongChord / strong <= 0.88,
    `strong chord ${strongChord}/${strong}`,
  );
  // An off-beat eighth with no following downbeat. The critic no longer pays
  // for off-beats, and slice 2 was the low point at 10.7%; by this head the
  // drawn cells put it back. The 400-phrase sweep measures 13.03%
  // (908/6969) and a 4,800-phrase run of the same contexts measures 13.56%.
  // The floor sits at 12%, above slice 2's dip and under both.
  assert.ok(sync / syncNotes >= 0.12, `sync ${sync}/${syncNotes}`);
  // Two separate guards, because they catch different things. Cell ids can
  // repeat once the opening spreads -- two answered bars often share the
  // label "ans 0,1,2,3" -- so the label count is bounded rather than pinned.
  assert.ok(
    repeatedCells <= 20,
    `repeated cell labels ${repeatedCells}/${phrases}`,
  );
  // What a listener actually hears is the onsets, and those may not repeat
  // adjacent at all beyond a handful of accented echoes.
  assert.ok(
    repeatedOnsets <= 4,
    `repeated bar rhythm ${repeatedOnsets}/${phrases}`,
  );
});

void test('score order and the lane tie-break pick a fixed line', () => {
  const two = phrase('C', 'major', 'C', 6, 2);
  assert.deepEqual(
    two.notes.map((note) => [note.midi, note.beat, note.duration]),
    [
      [67, 0, 1],
      [69, 1.5, 0.5],
      [71, 2.5, 0.5],
      [67, 3, 1],
      [64, 4, 1],
      [65, 5.5, 0.5],
      [67, 6.5, 0.5],
      [64, 7, 0.5],
      [62, 7.5, 0.5],
      [60, 8, 2],
    ],
  );
  const four = phrase('C', 'major', 'C', 15, 4);
  assert.deepEqual(
    four.notes.map((note) => note.midi),
    [
      55, 59, 57, 59, 62, 60, 65, 67, 71, 69, 71, 67, 65, 62, 71, 62, 72, 69,
      67, 65, 64, 67, 65, 62, 67, 62, 64,
    ],
  );
});

void test('these cadence tails stay on the weighted pitches', () => {
  const lines: readonly (readonly [
    string,
    string,
    string,
    number,
    2 | 4,
    readonly number[],
  ])[] = [
    ['C', 'major', 'C', 7, 2, [72, 76, 72, 67, 76, 79, 76, 71, 69, 67]],
    [
      'C',
      'major',
      'C',
      46,
      2,
      [60, 59, 64, 60, 65, 64, 62, 67, 64, 62, 57, 55],
    ],
    [
      'C',
      'major',
      'C',
      1,
      4,
      [
        64, 65, 67, 64, 67, 69, 71, 67, 64, 60, 62, 57, 59, 60, 64, 67, 62, 57,
        55,
      ],
    ],
    [
      'C',
      'major',
      'C',
      7,
      4,
      [72, 74, 76, 72, 76, 77, 79, 76, 77, 69, 71, 67, 69, 72, 71, 69, 67],
    ],
    [
      'F#',
      'major',
      'F#maj7',
      24,
      4,
      [54, 49, 58, 54, 53, 49, 58, 59, 61, 58, 59, 54, 56, 65, 66],
    ],
    ['C', 'major', 'C', 1, 2, [64, 67, 65, 67, 60, 64, 62, 64, 59, 55]],
    [
      'F#',
      'major',
      'F#maj7',
      2,
      2,
      [66, 63, 65, 63, 59, 61, 58, 54, 51, 53, 51, 54, 56, 58],
    ],
    [
      'C',
      'major',
      'C',
      4,
      2,
      [52, 53, 55, 52, 48, 50, 52, 53, 57, 55, 53, 55, 50, 48],
    ],
    [
      'C',
      'major',
      'C',
      20,
      4,
      [
        60, 57, 59, 60, 62, 65, 64, 62, 59, 60, 64, 59, 57, 62, 60, 57, 59, 60,
        62, 65, 67, 64, 62, 60, 59, 60,
      ],
    ],
    [
      'C',
      'major',
      'C',
      5,
      4,
      [
        55, 57, 62, 64, 55, 57, 62, 64, 60, 52, 53, 48, 50, 52, 55, 57, 53, 52,
      ],
    ],
    ['A', 'dorian', 'Am', 7, 2, [69, 72, 69, 64, 72, 76, 72, 67, 66, 64]],
  ];
  for (const [root, scaleId, symbol, seed, bars, midis] of lines) {
    const line = phrase(root, scaleId, symbol, seed, bars);
    assert.deepEqual(
      line.notes.map((note) => note.midi),
      [...midis],
      `${symbol} seed ${seed} ${bars}`,
    );
  }
});

void test('the loop wrap never refuses a move the phrase allows, and seeds replay', () => {
  // The wrap a looping pass makes is the only resolution a loop ever hears, so
  // it has to obey the same arrival rule as any move inside the phrase: no
  // unison, no more than an octave, and no more than a fourth onto an eighth
  // unless it is a skip one form apart. The form half matters: a scale with no
  // forms (`patterns` returns nothing for 6- and 8-note scales) can never
  // excuse a wide move onto an eighth, because inside a phrase the engine
  // makes none there either. So the sweep below includes those scales on
  // purpose; without them this test passed while 70 REVIEW phrases broke the
  // rule.
  //
  // It also pins seed drift. When every candidate failed the seam check alone
  // the plan came back unplayable and the caller advanced to the next seed,
  // so a seed silently played a different phrase. The re-roll in
  // `composePhrase` fixes that; this catches it coming back.
  //
  // `shapes` is rebuilt here from `patterns`, the same lookup the engine uses,
  // so this test can disagree with the engine rather than echo it.
  const CONTEXTS: readonly (readonly [string, string, string])[] = [
    ...SWEEP,
    // No-form scales, 6 and 8 notes, where `patterns` returns []. They need
    // more seeds: a wide wrap onto an eighth is rarer in them, and seeds 1-50
    // never reach one.
    ['C', 'whole-tone', 'C7'],
    ['A', 'whole-tone', 'A7'],
    ['C', 'minor-blues', 'C7'],
    ['E', 'minor-blues', 'E7'],
    ['C', 'half-whole-diminished', 'C7'],
    ['A', 'half-whole-diminished', 'A7'],
  ];
  let phrases = 0;
  let illegal = 0;
  let drift = 0;
  let wideOntoEighth = 0;
  let noFormWide = 0;
  for (const [root, scaleId, symbol] of CONTEXTS) {
    const shapes = formLookupFor(patterns(scaleOf(root, scaleId)));
    const formless = shapes.size === 0;
    const seeds = formless ? 200 : 50;
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= seeds; seed++) {
        const line = phrase(root, scaleId, symbol, seed, bars);
        phrases += 1;
        if (line.seed !== seed) drift += 1;
        const body = line.notes.filter((note) => note.beat < bars * 4);
        const last = body[body.length - 1];
        const first = line.notes[0];
        assert.ok(last && first, `${symbol} seed ${seed} ${bars}`);
        const gap = Math.abs(first.midi - last.midi);
        const fast = first.duration <= 0.5;
        if (fast && gap > 5) {
          wideOntoEighth += 1;
          if (formless) noFormWide += 1;
        }
        const excuse =
          fast && gap > 5 ? skipOneFormApart(shapes, last, first) : true;
        const legal = gap > 0 && gap <= 12 && excuse;
        if (!legal) {
          illegal += 1;
          assert.fail(
            `${symbol} seed ${seed} ${bars}: wrap ${last.midi} -> ${first.midi} (gap ${gap}, first ${first.duration}, strings ${last.string} -> ${first.string}, formless ${formless})`,
          );
        }
      }
    }
  }
  // 8 sweep contexts at 50 seeds and 6 formless ones at 200, both 2 and 4 bars.
  assert.equal(phrases, (8 * 50 + 6 * 200) * 2);
  assert.equal(illegal, 0, `illegal wraps ${illegal}`);
  // The branch is exercised, not vacuous: phrases really do wrap wide onto an
  // eighth where a form exists to excuse them.
  assert.ok(wideOntoEighth >= 10, `wide wraps onto an eighth ${wideOntoEighth}`);
  // In a scale with no forms there is nothing to excuse a wide move onto an
  // eighth, and the engine makes none inside such a phrase either, so the
  // count here must be zero. On main it was 605 across the same contexts;
  // asserting zero is what catches a return of the string-only excuse, which
  // is the bug that let 67 REVIEW phrases through.
  assert.equal(noFormWide, 0, `wide wraps onto an eighth in formless scales ${noFormWide}`);
  // Seed drift is 0 on this sweep on main and 0 here; the loop-wrap rule
  // briefly took it to 3 before the same-seed re-roll, and the old
  // fall-through reached 45 on the wider REVIEW grid. Allow a little room for
  // a future change that trades a seed for a musical fix, not that return.
  assert.ok(drift <= 2, `seed drift ${drift}/${phrases}`);
});
