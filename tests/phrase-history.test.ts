import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  PHRASE_START_LEAD_SEC,
  PHRASE_TICK_SEC,
  PhrasePlayer,
  melodyFrets,
  nextPhraseBarLine,
  phraseLoopSeconds,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import { voicingMidi } from '../lib/voicing-audio.ts';
import {
  defaultChordNotes,
  generatePhrase,
  type FingeredNote,
} from '../lib/phrase.ts';
import {
  PHRASE_HISTORY_KEY,
  PHRASE_HISTORY_LIMIT,
  emptyPhraseHistory,
  getPhraseHistory,
  movePhraseHistory,
  onPhraseHistoryStorage,
  parsePhraseHistory,
  phraseHistoryActiveLocks,
  phraseHistoryEntry,
  phraseHistoryOpening,
  phraseHistoryShows,
  phraseHistoryStepFocus,
  pushPhraseHistory,
  readPhraseHistory,
  rememberPhrase,
  samePhraseHistoryEntry,
  stepPhraseHistory,
  writePhraseHistory,
  type PhraseHistoryEntry,
  type PhraseHistoryState,
} from '../lib/phrase-history.ts';
import { SCALES, spell } from '../lib/music.ts';

const tonic = [
  { name: 'A', pc: 9, degree: '1' },
  { name: 'C', pc: 0, degree: 'b3' },
  { name: 'E', pc: 4, degree: '5' },
];

function entry(
  seed: number,
  patch: Partial<PhraseHistoryEntry> = {},
): PhraseHistoryEntry {
  const made = phraseHistoryEntry({
    seed,
    bars: patch.bars ?? 2,
    scaleRoot: patch.scaleRoot ?? 'A',
    scaleId: patch.scaleId ?? 'dorian',
    place: patch.place ?? 'scale',
    chord: patch.chord === undefined ? null : patch.chord,
    chordNotes: patch.chordNotes ?? tonic,
    locks: patch.locks ?? {},
  });
  assert.ok(made, `fixture ${seed} should be a phrase`);
  return made;
}

function rememberSeeds(seeds: readonly number[]): PhraseHistoryState {
  return seeds.reduce(
    (state, seed) => pushPhraseHistory(state, entry(seed)),
    emptyPhraseHistory(),
  );
}

function memory(initial: string | null = null) {
  let raw = initial;
  return {
    getItem(key: string) {
      return key === PHRASE_HISTORY_KEY ? raw : null;
    },
    setItem(key: string, value: string) {
      if (key !== PHRASE_HISTORY_KEY) return;
      raw = value;
    },
    raw: () => raw,
  };
}

function install(initial: string | null) {
  let value = initial;
  let writes = 0;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const storage = {
    getItem(key: string) {
      return key === PHRASE_HISTORY_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key !== PHRASE_HISTORY_KEY) return;
      writes += 1;
      value = next;
    },
    writes: () => writes,
    raw: () => value,
    restore() {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
      onPhraseHistoryStorage(PHRASE_HISTORY_KEY);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  onPhraseHistoryStorage(PHRASE_HISTORY_KEY);
  return storage;
}

void test('history keeps the last 3 phrases and drops the oldest', () => {
  assert.equal(PHRASE_HISTORY_LIMIT, 3);
  const state = rememberSeeds([11, 22, 33, 44]);
  assert.deepEqual(
    state.entries.map((item) => item.seed),
    [22, 33, 44],
  );
  assert.equal(state.index, 2);
  assert.equal(state.entries.length, 3);
  const kept = rememberSeeds([11, 22, 33]);
  assert.equal(kept.entries[0]?.seed, 11);
});

void test('back and forward move inside the list and stop at the ends', () => {
  let state = rememberSeeds([11, 22, 33]);
  assert.equal(stepPhraseHistory(state, 1), state);
  state = stepPhraseHistory(state, -1);
  assert.equal(state.entries[state.index]?.seed, 22);
  state = stepPhraseHistory(state, -1);
  assert.equal(state.entries[state.index]?.seed, 11);
  assert.equal(state.index, 0);
  assert.equal(stepPhraseHistory(state, -1), state);
  state = stepPhraseHistory(state, 1);
  assert.equal(state.entries[state.index]?.seed, 22);
  state = stepPhraseHistory(state, 1);
  assert.equal(state.entries[state.index]?.seed, 33);
  assert.equal(stepPhraseHistory(state, 1), state);
  assert.equal(
    stepPhraseHistory(emptyPhraseHistory(), -1),
    emptyPhraseHistory(),
  );
  assert.equal(
    stepPhraseHistory(emptyPhraseHistory(), 1),
    emptyPhraseHistory(),
  );
});

void test('a new phrase from the middle drops the forward phrases', () => {
  let state = rememberSeeds([11, 22, 33]);
  state = stepPhraseHistory(state, -1);
  const branched = pushPhraseHistory(state, entry(22));
  assert.deepEqual(
    branched.entries.map((item) => item.seed),
    [11, 22],
  );
  assert.equal(branched.index, 1);
  state = pushPhraseHistory(branched, entry(99));
  assert.deepEqual(
    state.entries.map((item) => item.seed),
    [11, 22, 99],
  );
  assert.equal(state.index, 2);
});

void test('the phrase on screen is not stored twice', () => {
  const state = rememberSeeds([11, 22]);
  const again = pushPhraseHistory(state, entry(22));
  assert.equal(again, state);
  const otherScale = pushPhraseHistory(
    state,
    entry(22, { scaleRoot: 'C', scaleId: 'major' }),
  );
  assert.equal(otherScale.entries.length, 3);
  assert.equal(samePhraseHistoryEntry(entry(22), entry(22)), true);
  assert.equal(
    samePhraseHistoryEntry(entry(22), entry(22, { bars: 4 })),
    false,
  );
  assert.equal(
    samePhraseHistoryEntry(
      entry(22),
      entry(22, { locks: { rhythm: 'quarters' } }),
    ),
    false,
  );
  const spelled = entry(22, {
    chordNotes: [{ name: 'C#', pc: 1, degree: '3' }],
  });
  const flats = entry(22, {
    chordNotes: [{ name: 'Db', pc: 1, degree: '3' }],
  });
  assert.equal(samePhraseHistoryEntry(spelled, flats), false);
  const broken = entry(22);
  broken.seed = Number.NaN;
  assert.equal(pushPhraseHistory(state, broken), state);
});

void test('storage round-trips the phrase and leaves tempo and swing out', () => {
  let state = rememberSeeds([4, 5, 6]);
  state = stepPhraseHistory(state, -1);
  const store = memory();
  writePhraseHistory(store, state);
  assert.deepEqual(readPhraseHistory(store), state);
  const parsed = parsePhraseHistory(store.raw());
  assert.equal(parsed.writable, true);
  assert.deepEqual(parsed.state, state);
  const raw = store.raw() ?? '';
  assert.equal(raw.includes('tempo'), false);
  assert.equal(raw.includes('swing'), false);
  assert.equal(raw.includes('"version":1'), true);
  assert.deepEqual(parsePhraseHistory(null), {
    state: emptyPhraseHistory(),
    writable: true,
  });
  assert.deepEqual(readPhraseHistory(memory(null)), emptyPhraseHistory());
});

void test('the browser store round-trips and ignores a duplicate push', () => {
  const held = install(null);
  try {
    assert.deepEqual(getPhraseHistory(), emptyPhraseHistory());
    rememberPhrase(entry(7));
    rememberPhrase(entry(8));
    const duplicate = held.raw();
    const writes = held.writes();
    assert.equal(rememberPhrase(entry(8)), getPhraseHistory());
    assert.equal(held.raw(), duplicate);
    assert.equal(held.writes(), writes);
    const saved = held.raw();
    onPhraseHistoryStorage(PHRASE_HISTORY_KEY);
    const loaded = getPhraseHistory();
    assert.deepEqual(
      loaded.entries.map((item) => item.seed),
      [7, 8],
    );
    assert.equal(loaded.index, 1);
    assert.deepEqual(parsePhraseHistory(saved).state, loaded);
    const back = movePhraseHistory(-1);
    assert.equal(back?.seed, 7);
    assert.equal(getPhraseHistory().index, 0);
    assert.equal(movePhraseHistory(-1), null);
    assert.equal(getPhraseHistory().index, 0);
    const forward = movePhraseHistory(1);
    assert.equal(forward?.seed, 8);
  } finally {
    held.restore();
  }
});

void test('corrupt storage is ignored and left untouched', () => {
  const blobs = [
    '{',
    '[]',
    'null',
    '"history"',
    '',
    JSON.stringify({ version: 2, entries: [entry(1)], index: 0 }),
    JSON.stringify({ version: 0, entries: [] }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, entries: { seed: 1 } }),
    JSON.stringify({ entries: [entry(1)] }),
  ];
  for (const raw of blobs) {
    const store = memory(raw);
    assert.deepEqual(readPhraseHistory(store), emptyPhraseHistory(), raw);
    assert.equal(store.raw(), raw);
    assert.equal(parsePhraseHistory(raw).writable, false);
    const held = install(raw);
    try {
      assert.deepEqual(rememberPhrase(entry(5)), emptyPhraseHistory());
      assert.equal(movePhraseHistory(-1), null);
      assert.equal(held.raw(), raw);
      assert.equal(held.writes(), 0);
    } finally {
      held.restore();
    }
  }
});

void test('a corrupt entry is ignored and the phrases around it remain', () => {
  const first = entry(3);
  const second = entry(8, { bars: 4, locks: { cadence: 'fifth' } });
  const raw = JSON.stringify({
    version: 1,
    index: 0,
    entries: [first, { seed: 'nope' }, null, second, { seed: 1, bars: 3 }],
  });
  const store = memory(raw);
  const loaded = readPhraseHistory(store);
  assert.deepEqual(
    loaded.entries.map((item) => [item.seed, item.bars]),
    [
      [3, 2],
      [8, 4],
    ],
  );
  assert.equal(loaded.entries[1]?.locks.cadence, 'fifth');
  assert.equal(loaded.index, 0);
  assert.equal(store.raw(), raw);
  assert.equal(parsePhraseHistory(raw).writable, true);
  const missingIndex = JSON.stringify({
    version: 1,
    entries: [first, { bars: 2 }, second],
  });
  assert.equal(parsePhraseHistory(missingIndex).state.index, 1);
  assert.equal(parsePhraseHistory(missingIndex).writable, true);
});

void test('a stored list longer than 3 loads only the newest 3', () => {
  const entries = Array.from({ length: 50 }, (_, index) => entry(index + 1));
  const raw = JSON.stringify({ version: 1, index: 49, entries });
  const loaded = parsePhraseHistory(raw);
  assert.equal(loaded.writable, true);
  assert.deepEqual(
    loaded.state.entries.map((item) => item.seed),
    [48, 49, 50],
  );
  assert.equal(loaded.state.index, 2);
  const earlier = parsePhraseHistory(
    JSON.stringify({ version: 1, index: 48, entries }),
  );
  assert.equal(earlier.state.entries[earlier.state.index]?.seed, 49);
  const store = memory(raw);
  assert.equal(readPhraseHistory(store).entries.length, 3);
  assert.equal(store.raw(), raw);
});

void test('a repeated phrase moves to the current spot instead of being stored twice', () => {
  let state = pushPhraseHistory(emptyPhraseHistory(), entry(1));
  state = pushPhraseHistory(state, entry(2));
  state = pushPhraseHistory(state, entry(1));
  assert.deepEqual(
    state.entries.map((item) => item.seed),
    [2, 1],
  );
  assert.equal(state.index, 1);
  assert.equal(state.entries.filter((item) => item.seed === 1).length, 1);
  const back = stepPhraseHistory(state, -1);
  assert.equal(back.entries[back.index]?.seed, 2);
  let branched = rememberSeeds([1, 2, 3]);
  branched = stepPhraseHistory(branched, -1);
  branched = pushPhraseHistory(branched, entry(1));
  assert.deepEqual(
    branched.entries.map((item) => item.seed),
    [2, 1],
  );
  assert.equal(branched.index, 1);
});

void test('a refused write still steps the phrases in memory', () => {
  const held = install(null);
  try {
    rememberPhrase(entry(1));
    rememberPhrase(entry(2));
    const raw = held.raw();
    held.setItem = () => {
      throw new Error('full');
    };
    const saved = rememberPhrase(entry(3));
    assert.deepEqual(
      saved.entries.map((item) => item.seed),
      [1, 2, 3],
    );
    assert.equal(held.raw(), raw);
    assert.equal(movePhraseHistory(-1)?.seed, 2);
    assert.equal(getPhraseHistory().index, 1);
    assert.equal(movePhraseHistory(1)?.seed, 3);
    assert.equal(held.raw(), raw);
    assert.equal(held.writes(), 2);
  } finally {
    held.restore();
  }
});

void test('an older saved phrase without a chord control is dropped', () => {
  const legacy = {
    seed: 4,
    bars: 4,
    scaleRoot: 'E',
    scaleId: 'mixolydian',
    chordNotes: tonic,
    locks: {},
  };
  const raw = JSON.stringify({
    version: 1,
    index: 0,
    entries: [legacy, entry(9)],
  });
  const store = memory(raw);
  const loaded = readPhraseHistory(store);
  assert.equal(loaded.entries.length, 1);
  assert.equal(loaded.entries[0]?.seed, 9);
  assert.equal(loaded.index, 0);
  assert.equal(store.raw(), raw);
  assert.equal(parsePhraseHistory(raw).writable, true);
});

void test('stepping does not add a phrase, and back adopts an unsaved context', () => {
  const held = install(null);
  try {
    rememberPhrase(entry(1));
    rememberPhrase(entry(2, { scaleRoot: 'C', scaleId: 'major' }));
    const raw = held.raw();
    const writes = held.writes();
    const adopted = movePhraseHistory(-1, false);
    assert.equal(adopted?.scaleRoot, 'C');
    assert.equal(adopted?.seed, 2);
    assert.equal(held.raw(), raw);
    assert.equal(held.writes(), writes);
    const back = movePhraseHistory(-1, true);
    assert.equal(back?.seed, 1);
    assert.equal(getPhraseHistory().entries.length, 2);
    const saved = JSON.parse(held.raw() ?? '{}') as {
      entries: { seed: number }[];
    };
    assert.deepEqual(
      saved.entries.map((item) => item.seed),
      [1, 2],
    );
    const forward = movePhraseHistory(1);
    assert.equal(forward?.seed, 2);
    assert.equal(getPhraseHistory().entries.length, 2);
  } finally {
    held.restore();
  }
});

void test('a showing phrase keeps the locks it was saved with', () => {
  const saved = entry(5, { locks: { cadence: 'fifth', contour: 'arch' } });
  assert.deepEqual(phraseHistoryActiveLocks(saved, true, {}), saved.locks);
  assert.deepEqual(phraseHistoryActiveLocks(saved, false, {}), {});
  assert.equal(
    phraseHistoryShows(saved, {
      seed: saved.seed,
      bars: saved.bars,
      scaleRoot: saved.scaleRoot,
      scaleId: saved.scaleId,
      place: saved.place,
      chord: saved.chord,
      chordNotes: saved.chordNotes,
    }),
    true,
  );
  assert.equal(
    phraseHistoryShows(saved, {
      seed: saved.seed,
      bars: saved.bars,
      scaleRoot: 'C',
      scaleId: 'major',
      place: 'scale',
      chord: null,
      chordNotes: saved.chordNotes,
    }),
    false,
  );
});

void test('focus leaves a step button that has reached the end', () => {
  assert.equal(
    phraseHistoryStepFocus({ direction: -1, index: 0, count: 3 }),
    'next',
  );
  assert.equal(
    phraseHistoryStepFocus({ direction: 1, index: 2, count: 3 }),
    'previous',
  );
  assert.equal(
    phraseHistoryStepFocus({ direction: -1, index: 1, count: 3 }),
    null,
  );
  assert.equal(
    phraseHistoryStepFocus({ direction: 1, index: 0, count: 1 }),
    'new',
  );
});

void test('unavailable storage is an empty history', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  onPhraseHistoryStorage(PHRASE_HISTORY_KEY);
  try {
    assert.deepEqual(getPhraseHistory(), emptyPhraseHistory());
    assert.deepEqual(rememberPhrase(entry(1)), emptyPhraseHistory());
    assert.equal(movePhraseHistory(1), null);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
    onPhraseHistoryStorage(PHRASE_HISTORY_KEY);
  }
});

void test('a stored entry regenerates the same spelled phrase', () => {
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const scaleNotes = spell('A', scale.formula);
  const chordNotes = defaultChordNotes(scaleNotes);
  const locks = { contour: 'arch' as const, rhythm: 'quarters' as const };
  const generated = generatePhrase({
    seed: 42,
    bars: 4,
    scaleNotes,
    chordNotes,
    locks,
  });
  assert.equal(generated.ok, true);
  const saved = phraseHistoryEntry({
    seed: 42,
    bars: 4,
    scaleRoot: 'A',
    scaleId: 'major',
    place: 'scale',
    chord: null,
    chordNotes,
    locks,
  });
  assert.ok(saved);
  assert.equal(
    saved.chordNotes.some((note) => note.name.includes('#')),
    true,
  );
  const store = memory();
  const state = pushPhraseHistory(emptyPhraseHistory(), saved);
  writePhraseHistory(store, state);
  const loaded = readPhraseHistory(store).entries[0];
  assert.ok(loaded);
  const scaleAgain = SCALES.find((item) => item.id === loaded.scaleId);
  assert.ok(scaleAgain);
  const again = generatePhrase({
    seed: loaded.seed,
    bars: loaded.bars,
    scaleNotes: spell(loaded.scaleRoot, scaleAgain.formula),
    chordNotes: loaded.chordNotes,
    locks: loaded.locks,
  });
  assert.deepEqual(again, generated);
  if (again.ok && generated.ok) {
    assert.deepEqual(
      again.phrase.notes.map((note) => note.name),
      generated.phrase.notes.map((note) => note.name),
    );
  }
  const context = {
    scaleRoot: 'A',
    scaleId: 'major',
    place: 'scale' as const,
    chord: null,
    chordNotes,
    locks,
  };
  assert.deepEqual(phraseHistoryOpening(state, context), {
    seed: 42,
    bars: 4,
  });
  assert.equal(
    phraseHistoryOpening(state, { ...context, scaleRoot: 'C' }),
    null,
  );
  assert.equal(phraseHistoryOpening(emptyPhraseHistory(), context), null);
});

void test('the panel stores history beside the stash and not in the component', () => {
  assert.equal(PHRASE_HISTORY_KEY, 'progger.phrase-history.v1');
  const history = readFileSync(
    new URL('../lib/phrase-history.ts', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(history.includes('phrase-audio'), false);
  assert.equal(history.includes('drone'), false);
  assert.equal(history.includes("from './phrase.ts'"), false);
  assert.equal(history.includes("from '@/lib/phrase'"), false);
  assert.match(history, /localStorage/);
  assert.equal(panel.includes('localStorage'), false);
  assert.equal(panel.includes('sessionStorage'), false);
  assert.match(panel, /rememberPhrase/);
  assert.match(panel, /movePhraseHistory/);
  assert.match(panel, /aria-label="Previous phrase"/);
  assert.match(panel, /aria-label="Next phrase"/);
  assert.match(panel, /Last 3 phrases\./);
});

class AudioClock implements PhraseClock {
  currentTime = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.currentTime;
  }

  after(delaySec: number, fn: () => void): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.currentTime + delaySec, fn });
    return id;
  }

  cancel(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(to: number): void {
    this.currentTime = to;
    for (;;) {
      let due: { id: number; at: number; fn: () => void } | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= this.currentTime + 1e-9 && (!due || timer.at < due.at))
          due = { id, at: timer.at, fn: timer.fn };
      }
      if (!due) break;
      this.timers.delete(due.id);
      due.fn();
    }
  }
}

const placed: FingeredNote = {
  name: 'A',
  pc: 9,
  degree: '1',
  midi: 57,
  beat: 0,
  duration: 1,
  strong: true,
  chordTone: true,
  string: 0,
  fret: 0,
  finger: 1,
  position: 0,
  shift: false,
};

function queuedNote(fret: number, beat: number, duration = 1): FingeredNote {
  return { ...placed, fret, beat, duration };
}

function pitchHz(fret: number): number {
  const midi = voicingMidi(melodyFrets({ string: 0, fret }))[0] ?? 0;
  return 440 * 2 ** ((midi - 69) / 12);
}

function spyPhrase(context: OfflineAudioContext) {
  const starts: { when: number; frequency: number }[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push({ when, frequency: oscillator.frequency.value });
      return start(when);
    };
    return oscillator;
  };
  return starts;
}

async function rollClock(clock: AudioClock, to: number) {
  let steps = 0;
  while (clock.currentTime + 1e-9 < to) {
    clock.advance(Math.min(to, clock.currentTime + PHRASE_TICK_SEC));
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(++steps < 40000, 'the clock spun');
  }
}

void test('a bars change while looping lands on the next downbeat', async () => {
  const tempo = 120;
  const changes = [
    { from: 4 as const, to: 2 as const, seamBeats: 16 },
    { from: 2 as const, to: 4 as const, seamBeats: 8 },
  ];
  for (const change of changes) {
    const context = new OfflineAudioContext(1, 44100 * 24, 44100);
    context.resume = () => Promise.resolve();
    const clock = new AudioClock();
    const starts = spyPhrase(context);
    const player = new PhrasePlayer(() => {});
    const cadence = change.seamBeats;
    const playing = [
      queuedNote(0, 0),
      queuedNote(2, cadence - 2),
      queuedNote(3, cadence, 2),
    ];
    await player.start({
      notes: playing,
      bars: change.from,
      tempo,
      swing: 0,
      loop: true,
      context,
      destination: context.createGain(),
      clock,
    });
    const lead = PHRASE_START_LEAD_SEC;
    const seam = lead + phraseLoopSeconds(playing, tempo);
    assert.equal(seam, lead + cadence * (60 / tempo));
    await rollClock(clock, lead + 0.4);
    const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
    assert.ok(
      boundary < seam - 1,
      `${change.from} to ${change.to} waited for the end of the pass`,
    );
    player.queuePhrase({
      notes: [queuedNote(10, 0), queuedNote(10, change.to * 4, 2)],
      bars: change.to,
      tempo,
      swing: 0,
      loop: true,
      context,
      destination: context.destination,
      clock,
    });
    await rollClock(clock, boundary + 0.05);
    const arrived = starts.filter(
      (item) => Math.abs(item.frequency - pitchHz(10)) < 1e-3,
    );
    assert.equal(
      arrived.some((item) => item.when < boundary - 1e-6),
      false,
      `${change.from} to ${change.to} started before the downbeat`,
    );
    assert.ok(
      arrived.some((item) => Math.abs(item.when - boundary) < 1e-6),
      `${change.from} to ${change.to} did not start on the next downbeat`,
    );
    player.stop();
  }
});
