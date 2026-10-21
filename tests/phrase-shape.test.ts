import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  PHRASE_END_RELEASE_SEC,
  PHRASE_START_LEAD_SEC,
  PHRASE_TICK_SEC,
  PhrasePlayer,
  nextPhraseBarLine,
  phraseClosingIndex,
  phraseLoopBeats,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import {
  emptyPhraseHistory,
  phraseHistoryEntry,
  pushPhraseHistory,
  stepPhraseHistory,
} from '../lib/phrase-history.ts';
import {
  generatePhrase,
  generatePhraseWithPlanner,
  generateShapedPhrase,
  mulberry32,
  onsetSeconds,
  phrasePeriodBeats,
  rulePlan,
  type FingeredNote,
  type PhrasePlanner,
} from '../lib/phrase.ts';
import {
  createPhrasePlanner,
  parseDistributions,
} from '../lib/phrase-planner-client.ts';
import {
  BAR_VARIATIONS,
  MOTIF_CONTOURS,
  QUESTION_DEGREES,
  barThreeTwists,
  motifRhythmsFor,
  questionHits,
  rollShape,
  sampleShape,
  sanitizeShape,
} from '../lib/phrase-shape.ts';
import {
  distributionsFromAnswers,
  handlePhrasePlan,
  parsePhrasePlanRequest,
  phrasePlanQuestions,
  resetPhrasePlanStateForTests,
  shuffleItems,
} from '../api/phrase-plan.ts';

function major() {
  const scale = SCALES.find((item) => item.id === 'major');
  if (!scale) throw new Error('major');
  return spell('C', scale.formula);
}

void test('rules fill a version-1 shape and keep bar 3 from repeating', () => {
  const plan = rulePlan(8, ['root', 'third', 'fifth'], undefined, 4);
  assert.equal(plan.shape?.version, 1);
  assert.equal(plan.shape?.variations.length, 3);
  assert.notEqual(plan.shape?.variations[1], 'repeat');
  assert.equal(plan.shape?.question.bar, 2);
  assert.equal(plan.shape?.peak, undefined);
  const again = rulePlan(8, ['root', 'third', 'fifth'], undefined, 4);
  assert.deepEqual(again.shape, plan.shape);
  const short = rulePlan(8, ['root', 'third'], undefined, 2);
  assert.equal(short.shape?.variations.length, 1);
  assert.equal(short.shape?.question.bar, 1);
  assert.equal(short.contour, plan.contour);
  assert.equal(short.rhythm, plan.rhythm);
  const random = mulberry32(3);
  random();
  random();
  random();
  random();
  const rolled = rollShape(random, 4, 'eighths');
  assert.notEqual(rolled.variations[1], 'repeat');
});

void test('sanitize keeps a legal shape, a typed peak, and drops a repeat on bar 3', () => {
  const plan = rulePlan(4, ['root'], undefined, 4);
  const shape = plan.shape;
  assert.ok(shape);
  const kept = sanitizeShape(
    { ...shape, peak: { bar: 3, beat: 2 }, syncopation: null },
    4,
    plan.rhythm,
  );
  assert.equal(kept?.peak?.bar, 3);
  assert.equal(kept?.syncopation, null);
  assert.equal(
    sanitizeShape(
      { ...shape, variations: ['repeat', 'repeat', 'sequence-up'] },
      4,
      plan.rhythm,
    ),
    undefined,
  );
  assert.equal(sanitizeShape({ ...shape, version: 2 }, 4), undefined);
  assert.equal(
    parsePhrasePlanRequest({
      scaleId: 'major',
      root: 'C',
      chord: 'please write a solo',
      bars: 4,
      rhythm: 'quarters',
    }),
    null,
  );
  assert.ok(
    parsePhrasePlanRequest({
      scaleId: 'dorian',
      root: 'A',
      chord: 'Am',
      bars: 4,
      rhythm: 'eighths',
    }),
  );
});

void test('the live generator stays unshaped and the shape path keeps its grid', () => {
  const scaleNotes = major();
  const chordNotes = parseChord('C').notes;
  let shaped = 0;
  for (const bars of [2, 4] as const) {
    for (let seed = 1; seed <= 12; seed++) {
      const live = generatePhrase({ seed, bars, scaleNotes, chordNotes });
      const next = generateShapedPhrase({ seed, bars, scaleNotes, chordNotes });
      assert.equal(live.ok, true);
      assert.equal(next.ok, true);
      if (!live.ok || !next.ok) continue;
      assert.equal(live.phrase.plan.shape, undefined);
      assert.deepEqual(
        live.phrase.notes.map((note) => [note.beat, note.duration]),
        next.phrase.notes.map((note) => [note.beat, note.duration]),
      );
      assert.equal(
        next.phrase.notes.some((note) => note.strong && !note.chordTone),
        false,
      );
      const shape = next.phrase.plan.shape;
      if (!shape) continue;
      shaped += 1;
      assert.equal(questionHits(next.phrase.notes, shape), true);
      assert.notEqual(shape.variations[1], 'repeat');
      if (bars === 4) assert.equal(barThreeTwists(next.phrase.notes), true);
    }
  }
  assert.ok(shaped > 0, 'every shaped plan fell back');
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const phrase = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  assert.equal(panel.includes('generateShapedPhrase'), false);
  assert.equal(panel.includes('phrase-planner-client'), false);
  assert.equal(panel.includes('/api/phrase-plan'), false);
  assert.equal(phrase.includes('fetch('), false);
});

void test('a stub planner reuses one distribution and falls back without a route', async () => {
  const scaleNotes = major();
  const chordNotes = parseChord('C').notes;
  const input = {
    seed: 5,
    bars: 4 as const,
    scaleNotes,
    chordNotes,
    scaleId: 'major',
    scaleRoot: 'C',
    chordSymbol: 'C',
    locks: { rhythm: 'quarters' as const },
  };
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    const body = {
      model: 'jev-1.13.0',
      distributions: {
        motifContour: { 'step-up-step-down': 1 },
        motifRhythm: { even: 1 },
        questionDegree: { '4': 1 },
        cadence: { third: 1 },
        variations: [
          { 'sequence-up': 1 },
          { 'sequence-down': 1 },
          { 'altered-ending': 1 },
        ],
      },
    };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  const planner = createPhrasePlanner({ fetch: fetchImpl });
  const first = await generatePhraseWithPlanner({ ...input, planner });
  const second = await generatePhraseWithPlanner({
    ...input,
    seed: 6,
    planner,
  });
  assert.equal(calls, 1);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (first.ok) assert.ok(first.phrase.plan.cadence);
  const offFetch: typeof fetch = async () =>
    new Response(JSON.stringify({ error: 'planner-unavailable' }), {
      status: 503,
    });
  const off = createPhrasePlanner({ fetch: offFetch });
  const missed = await generatePhraseWithPlanner({ ...input, planner: off });
  const missedAgain = await generatePhraseWithPlanner({
    ...input,
    seed: 9,
    planner: off,
  });
  assert.equal(missed.ok, true);
  assert.equal(missedAgain.ok, true);
  if (missed.ok) assert.equal(missed.phrase.source, 'rules');
  const parsed = parseDistributions({
    model: 'jev-1.13.0',
    distributions: {
      motifContour: { 'step-up-step-up': 0.5 },
      motifRhythm: { even: 1 },
      questionDegree: { '2': 1 },
      cadence: { root: 1 },
      variations: [{ repeat: 1 }],
    },
  });
  assert.ok(parsed);
  const hanging: PhrasePlanner = {
    propose() {
      return new Promise(() => undefined);
    },
  };
  const live = generatePhrase({ seed: 5, bars: 2, scaleNotes, chordNotes });
  const timed = await generatePhraseWithPlanner({
    seed: 5,
    bars: 2,
    scaleNotes,
    chordNotes,
    planner: hanging,
    timeoutMs: 30,
  });
  assert.deepEqual(timed, live);
});

void test('the plan route stays shut without a key and never echoes one', async () => {
  resetPhrasePlanStateForTests();
  const seen: { status: number; body: unknown }[] = [];
  const respond = () => ({
    status(code: number) {
      return {
        json(body: unknown) {
          seen.push({ status: code, body });
        },
      };
    },
  });
  const previous = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  await handlePhrasePlan(
    { method: 'POST', body: { scaleId: 'major' } },
    respond(),
  );
  assert.equal(seen[0]?.status, 503);
  assert.equal(JSON.stringify(seen[0]?.body).includes('key'), false);
  process.env.TYPESAFE_API_KEY = 'test-key-not-real';
  await handlePhrasePlan(
    {
      method: 'POST',
      body: {
        scaleId: 'major',
        root: 'C',
        chord: 'C',
        bars: 4,
        rhythm: 'quarters',
        extra: 'text',
      },
    },
    respond(),
    { env: { TYPESAFE_API_KEY: 'test-key-not-real' }, ip: '203.0.113.5' },
  );
  assert.equal(seen[1]?.status, 400);
  let fetched = 0;
  const deps = {
    env: { TYPESAFE_API_KEY: 'test-key-not-real' },
    ip: '203.0.113.8',
    random: () => 0.5,
    now: () => 1_000,
    fetch: async (
      _url: string,
      init: { body: string; headers: Record<string, string> },
    ) => {
      fetched += 1;
      assert.equal(init.headers.authorization, 'Bearer test-key-not-real');
      const questions = JSON.parse(init.body).questions as Record<
        string,
        { criteria: Record<string, string> }
      >;
      assert.deepEqual(Object.keys(questions.motifRhythm.criteria).sort(), [
        'even',
      ]);
      return {
        ok: true,
        json: async () => ({
          model: 'jev-1.13.0',
          usage: { input_tokens: 321 },
          answers: {
            motifContour: {
              probabilities: {
                'step-down-step-up': 0.7,
                'step-up-step-up': 0.3,
              },
            },
            motifRhythm: { probabilities: { even: 1 } },
            questionDegree: { probabilities: { '2': 1 } },
            cadence: { probabilities: { fifth: 1 } },
            variation2: { probabilities: { 'sequence-up': 1 } },
            variation3: {
              probabilities: { repeat: 0.9, 'sequence-down': 0.1 },
            },
            variation4: { probabilities: { 'altered-ending': 1 } },
          },
        }),
      };
    },
  };
  await handlePhrasePlan(
    {
      method: 'POST',
      body: {
        scaleId: 'major',
        root: 'C',
        chord: 'C',
        bars: 4,
        rhythm: 'quarters',
      },
    },
    respond(),
    deps,
  );
  await handlePhrasePlan(
    {
      method: 'POST',
      body: {
        scaleId: 'major',
        root: 'C',
        chord: 'C',
        bars: 4,
        rhythm: 'quarters',
      },
    },
    respond(),
    deps,
  );
  assert.equal(fetched, 1);
  const ok = seen[2];
  assert.equal(ok?.status, 200);
  const body = ok?.body as {
    model: string;
    distributions: { variations: { repeat: number }[] };
    usage?: unknown;
  };
  assert.equal(body.model, 'jev-1.13.0');
  assert.equal(body.usage, undefined);
  assert.deepEqual(Object.keys(body).sort(), ['distributions', 'model']);
  assert.equal(body.distributions.variations[1].repeat, 0);
  assert.equal(JSON.stringify(body).includes('test-key'), false);
  for (let index = 0; index < 29; index++) {
    await handlePhrasePlan(
      {
        method: 'POST',
        body: {
          scaleId: 'major',
          root: 'C',
          chord: 'C',
          bars: 4,
          rhythm: 'quarters',
        },
      },
      respond(),
      deps,
    );
  }
  assert.equal(seen.at(-1)?.status, 429);
  const ordered = shuffleItems(['a', 'b', 'c'], () => 0);
  assert.deepEqual(ordered, ['b', 'c', 'a']);
  const questions = phrasePlanQuestions(
    { scaleId: 'major', root: 'C', chord: 'C', bars: 4, rhythm: 'quarters' },
    () => 0.1,
  );
  assert.equal(questions.variation3.criteria.repeat, undefined);
  const source = readFileSync(
    new URL('../api/phrase-plan.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('console.'), false);
  assert.equal(
    distributionsFromAnswers(
      { scaleId: 'major', root: 'C', chord: 'C', bars: 2, rhythm: 'eighths' },
      null,
    ),
    null,
  );
  if (previous === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = previous;
  resetPhrasePlanStateForTests();
});

void test('the server menus match the shape module', () => {
  for (const grid of ['quarters', 'eighths', 'long-short', 'push'] as const) {
    const questions = phrasePlanQuestions(
      { scaleId: 'major', root: 'C', chord: 'C', bars: 4, rhythm: grid },
      () => 0.2,
    );
    assert.deepEqual(
      Object.keys(questions.motifRhythm.criteria).sort(),
      [...motifRhythmsFor(grid)].sort(),
    );
    assert.deepEqual(
      Object.keys(questions.motifContour.criteria).sort(),
      [...MOTIF_CONTOURS].sort(),
    );
    assert.deepEqual(
      Object.keys(questions.questionDegree.criteria).sort(),
      [...QUESTION_DEGREES].sort(),
    );
    assert.deepEqual(
      Object.keys(questions.variation2.criteria).sort(),
      [...BAR_VARIATIONS].sort(),
    );
  }
  const source = readFileSync(
    new URL('../api/phrase-plan.ts', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes("from '../lib/"), false);
});

void test('CI loads a hand-authored distribution fixture and never a live Jev call', () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL('./fixtures/phrase-plan-distributions.json', import.meta.url),
      'utf8',
    ),
  ) as { recordedFromJev: boolean; note: string };
  assert.equal(fixture.recordedFromJev, false);
  assert.match(fixture.note, /No call to api\.typesafe\.ai/);
  const parsed = parseDistributions(fixture);
  assert.ok(parsed);
  for (let seed = 1; seed <= 32; seed++) {
    const random = mulberry32(seed);
    const shaped = sampleShape(random, 4, 'eighths', parsed);
    assert.notEqual(shaped.variations[1], 'repeat');
    assert.equal(shaped.question.bar, 2);
  }
  const phrase = readFileSync(
    new URL('../lib/phrase.ts', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(phrase.includes('phrase-planner-client'), false);
  assert.equal(phrase.includes('api.typesafe.ai'), false);
  assert.equal(panel.includes('createPhrasePlanner'), false);
  const recorded = JSON.parse(
    readFileSync(
      new URL('./fixtures/phrase-plan-jev-recorded.json', import.meta.url),
      'utf8',
    ),
  ) as { recordedFromJev: boolean; contexts: Record<string, unknown> };
  assert.equal(recorded.recordedFromJev, true);
  assert.equal(Object.keys(recorded.contexts).length, 64);
  assert.ok(parseDistributions(recorded.contexts['major|C|C|4|quarters']));
});

const PLAYBACK_CORPUS: readonly (readonly [string, string, string])[] = [
  ['C', 'major', 'C'],
  ['A', 'minor', 'Am'],
  ['A', 'dorian', 'Am'],
  ['C', 'major', 'G7'],
  ['F#', 'major', 'F#maj7'],
  ['A', 'harmonic-minor', 'E7'],
  ['C', 'minor-pentatonic', 'Cm'],
  ['C', 'minor-blues', 'C7'],
  ['Bb', 'mixolydian', 'Bb7'],
];

function scaleNotesFor(root: string, scaleId: string) {
  const scale = SCALES.find((item) => item.id === scaleId);
  if (!scale) throw new Error(scaleId);
  return spell(root, scale.formula);
}

void test('a shaped phrase keeps the grid the player loops, closes, and holds', () => {
  let shaped = 0;
  for (const [root, scaleId, symbol] of PLAYBACK_CORPUS) {
    const scaleNotes = scaleNotesFor(root, scaleId);
    const chordNotes = parseChord(symbol).notes;
    for (const bars of [2, 4] as const) {
      for (let seed = 1; seed <= 24; seed++) {
        const live = generatePhrase({ seed, bars, scaleNotes, chordNotes });
        const next = generateShapedPhrase({
          seed,
          bars,
          scaleNotes,
          chordNotes,
        });
        assert.equal(live.ok, true);
        assert.equal(next.ok, true);
        if (!live.ok || !next.ok) continue;
        assert.equal(live.phrase.plan.shape, undefined);
        assert.deepEqual(
          live.phrase.notes.map((note) => [note.beat, note.duration]),
          next.phrase.notes.map((note) => [note.beat, note.duration]),
        );
        const notes = next.phrase.notes;
        const tail = notes[notes.length - 1];
        assert.ok(tail);
        assert.equal(notes[0]?.beat, 0);
        assert.equal(phraseLoopBeats(notes), bars * 4);
        assert.equal(phraseClosingIndex(notes), notes.length - 1);
        assert.equal(tail.beat, bars * 4);
        assert.equal(tail.beat + tail.duration, phrasePeriodBeats(bars));
        assert.equal(
          notes.some((note) => note.strong && !note.chordTone),
          false,
        );
        assert.equal(
          notes.some((note) => note.fret < 0 || note.fret > 24),
          false,
        );
        if (next.phrase.plan.shape) shaped += 1;
        else {
          assert.deepEqual(
            live.phrase.notes.map((note) => note.midi),
            notes.map((note) => note.midi),
          );
        }
      }
    }
  }
  assert.ok(shaped > 0);
});

class PlaybackClock implements PhraseClock {
  currentTime = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.currentTime;
  }

  after(delaySec: number, fn: () => void): number {
    if (!(delaySec > 1e-4)) {
      throw new Error(`wake did not move at ${this.currentTime}`);
    }
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
        if (
          timer.at <= this.currentTime + 1e-9 &&
          (!due || timer.at < due.at)
        ) {
          due = { id, at: timer.at, fn: timer.fn };
        }
      }
      if (!due) break;
      this.timers.delete(due.id);
      due.fn();
    }
  }
}

async function roll(clock: PlaybackClock, to: number): Promise<void> {
  let steps = 0;
  while (clock.currentTime + 1e-9 < to) {
    clock.advance(Math.min(to, clock.currentTime + PHRASE_TICK_SEC));
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(++steps < 40000, 'the clock spun');
  }
}

function midiHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function spyStarts(context: OfflineAudioContext) {
  const starts: {
    when: number;
    frequency: number;
    dropped: boolean;
  }[] = [];
  const stops: number[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const entry = { when: 0, frequency: 0, dropped: false };
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      entry.when = when;
      entry.frequency = oscillator.frequency.value;
      starts.push(entry);
      return start(when);
    };
    const stop = oscillator.stop.bind(oscillator);
    oscillator.stop = (when = 0) => {
      stops.push(when);
      return stop(when);
    };
    const disconnect = oscillator.disconnect.bind(oscillator);
    oscillator.disconnect = () => {
      entry.dropped = true;
      return disconnect();
    };
    return oscillator;
  };
  return { starts, stops };
}

function spyRamps(): {
  ramps: { value: number; when: number }[];
  restore: () => void;
} {
  const sample = new OfflineAudioContext(1, 8000, 8000).createGain();
  const proto = Object.getPrototypeOf(sample.gain);
  const original = proto.linearRampToValueAtTime;
  const ramps: { value: number; when: number }[] = [];
  proto.linearRampToValueAtTime = function (
    this: AudioParam,
    value: number,
    when: number,
  ) {
    ramps.push({ value, when });
    return original.call(this, value, when);
  };
  return {
    ramps,
    restore() {
      proto.linearRampToValueAtTime = original;
    },
  };
}

function matchesMidi(frequency: number, midi: number): boolean {
  return Math.abs(frequency - midiHz(midi)) < 1e-2;
}

async function playShaped(
  notes: readonly FingeredNote[],
  bars: 2 | 4,
  loop: boolean,
  clock: PlaybackClock,
) {
  const context = new OfflineAudioContext(1, 44100 * 20, 44100);
  context.resume = () => Promise.resolve();
  const { starts, stops } = spyStarts(context);
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  await player.start({
    notes,
    bars,
    tempo: 120,
    swing: 0,
    loop,
    context,
    destination: context.createGain(),
    clock,
  });
  return { player, states, context, starts, stops };
}

void test('a shaped phrase uses the live switch, history, closing note, and stop', async () => {
  const scaleNotes = major();
  const chord = parseChord('C');
  const chordNotes = chord.notes.map((note) => ({
    name: note.name,
    pc: note.pc,
    degree: note.degree,
  }));
  let shaped: FingeredNote[] | null = null;
  let shapedSeed = 0;
  let restored: FingeredNote[] | null = null;
  let restoredSeed = 0;
  for (let seed = 1; seed <= 48 && !shaped; seed++) {
    const next = generateShapedPhrase({
      seed,
      bars: 2,
      scaleNotes,
      chordNotes: chord.notes,
    });
    const live = generatePhrase({
      seed,
      bars: 2,
      scaleNotes,
      chordNotes: chord.notes,
    });
    if (!next.ok || !live.ok || !next.phrase.plan.shape) continue;
    const shapedLine = next.phrase.notes.map((note) => note.midi).join(',');
    const liveLine = live.phrase.notes.map((note) => note.midi).join(',');
    if (shapedLine === liveLine) continue;
    if (next.phrase.notes[0]?.midi === next.phrase.notes.at(-1)?.midi) continue;
    for (let other = 1; other <= 48; other++) {
      if (other === seed) continue;
      const previous = generatePhrase({
        seed: other,
        bars: 2,
        scaleNotes,
        chordNotes: chord.notes,
      });
      if (!previous.ok) continue;
      const first = previous.phrase.notes[0]?.midi;
      if (first === undefined) continue;
      const early = next.phrase.notes.some(
        (note) => note.beat < 4 && note.midi === first,
      );
      if (early) continue;
      shaped = next.phrase.notes;
      shapedSeed = next.phrase.seed;
      restored = previous.phrase.notes;
      restoredSeed = previous.phrase.seed;
      break;
    }
  }
  assert.ok(
    shaped && restored,
    'no shaped phrase to play through the live path',
  );
  if (!shaped || !restored) return;

  const historyChord = {
    symbol: chord.symbol,
    root: chord.root,
    qualityId: chord.quality.id,
    fromContext: false,
    notes: chordNotes,
  };
  const currentEntry = phraseHistoryEntry({
    seed: shapedSeed,
    bars: 2,
    scaleRoot: 'C',
    scaleId: 'major',
    place: 'chord',
    chord: historyChord,
    chordNotes,
    locks: {},
  });
  const previousEntry = phraseHistoryEntry({
    seed: restoredSeed,
    bars: 2,
    scaleRoot: 'C',
    scaleId: 'major',
    place: 'chord',
    chord: historyChord,
    chordNotes,
    locks: {},
  });
  assert.ok(currentEntry && previousEntry);
  if (!currentEntry || !previousEntry) return;
  const stepped = stepPhraseHistory(
    pushPhraseHistory(
      pushPhraseHistory(emptyPhraseHistory(), previousEntry),
      currentEntry,
    ),
    -1,
  );
  const showing = stepped.entries[stepped.index];
  assert.ok(showing);
  assert.equal(showing.seed, restoredSeed);
  assert.equal(showing.bars, 2);
  assert.equal(showing.scaleRoot, 'C');
  assert.equal(showing.scaleId, 'major');
  assert.equal(showing.chord?.symbol, chord.symbol);
  const fromHistory = generatePhrase({
    seed: showing.seed,
    bars: showing.bars,
    scaleNotes,
    chordNotes: chord.notes,
  });
  assert.equal(fromHistory.ok, true);
  if (!fromHistory.ok) return;
  assert.deepEqual(
    fromHistory.phrase.notes.map((note) => note.midi),
    restored.map((note) => note.midi),
  );

  const tempo = 120;
  const lead = PHRASE_START_LEAD_SEC;
  const loopClock = new PlaybackClock();
  const looping = await playShaped(shaped, 2, true, loopClock);
  const loopStarts = looping.starts;
  assert.equal(looping.player.phraseChangeWaits(), true);
  await roll(loopClock, lead + 0.4);
  const boundary = nextPhraseBarLine(lead, loopClock.currentTime, tempo);
  const bar = 4 * (60 / tempo);
  assert.ok(boundary - loopClock.currentTime > bar / 2);
  looping.player.queuePhrase({
    notes: fromHistory.phrase.notes,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: looping.context,
    destination: looping.context.destination,
    clock: loopClock,
  });
  const restoredFirst = fromHistory.phrase.notes[0]?.midi ?? -1;
  await roll(loopClock, boundary - 0.02);
  assert.equal(
    loopStarts.some(
      (item) =>
        item.when < boundary - 1e-6 &&
        matchesMidi(item.frequency, restoredFirst),
    ),
    false,
  );
  await roll(loopClock, boundary + 0.05);
  assert.equal(
    loopStarts.some(
      (item) =>
        Math.abs(item.when - boundary) < 1e-6 &&
        matchesMidi(item.frequency, restoredFirst),
    ),
    true,
  );
  looping.player.stop();
  assert.equal(looping.states.at(-1), 'idle');
  assert.equal(looping.player.phraseChangeWaits(), false);
  assert.equal(looping.player.isLooping, false);

  const openClock = new PlaybackClock();
  const open = await playShaped(shaped, 2, false, openClock);
  const openStarts = open.starts;
  await roll(openClock, lead + 0.4);
  assert.equal(open.player.phraseChangeWaits(), false);
  const switchedAt = openClock.currentTime + lead;
  const laterBar = nextPhraseBarLine(lead, openClock.currentTime, tempo);
  assert.ok(laterBar - switchedAt > 0.5);
  const fade = spyRamps();
  open.player.queuePhrase({
    notes: fromHistory.phrase.notes,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context: open.context,
    destination: open.context.destination,
    clock: openClock,
  });
  await Promise.resolve();
  await Promise.resolve();
  await roll(openClock, switchedAt + 0.05);
  assert.equal(
    openStarts.some(
      (item) =>
        Math.abs(item.when - switchedAt) < 1e-6 &&
        matchesMidi(item.frequency, restoredFirst),
    ),
    true,
  );
  assert.equal(
    openStarts.some(
      (item) =>
        Math.abs(item.when - laterBar) < 1e-6 &&
        matchesMidi(item.frequency, restoredFirst),
    ),
    false,
  );
  assert.equal(
    fade.ramps.some(
      (ramp) =>
        ramp.value === 0 &&
        Math.abs(ramp.when - (switchedAt + PHRASE_END_RELEASE_SEC)) < 1e-4,
    ),
    true,
  );
  fade.restore();
  open.player.stop();

  const closingClock = new PlaybackClock();
  const closing = await playShaped(shaped, 2, true, closingClock);
  const closingStarts = closing.starts;
  const loopSec = 8 * (60 / tempo);
  const cadenceAt = lead + onsetSeconds(8, tempo, 0);
  assert.equal(cadenceAt, lead + loopSec);
  await roll(closingClock, lead + 60 / tempo);
  assert.equal(
    closingStarts.some(
      (item) =>
        Math.abs(item.when - cadenceAt) < 1e-6 &&
        matchesMidi(item.frequency, shaped[0]?.midi ?? -1),
    ),
    true,
  );
  const landing = shaped.at(-1)?.midi ?? -2;
  assert.equal(
    closingStarts.some(
      (item) =>
        Math.abs(item.when - cadenceAt) < 1e-6 &&
        matchesMidi(item.frequency, landing),
    ),
    false,
  );
  const release = spyRamps();
  closing.player.finishPass();
  assert.equal(closing.player.phraseChangeWaits(), true);
  const holdEnd = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await roll(closingClock, holdEnd + PHRASE_END_RELEASE_SEC + 0.2);
  assert.equal(
    closingStarts.some(
      (item) =>
        !item.dropped &&
        Math.abs(item.when - cadenceAt) < 1e-6 &&
        matchesMidi(item.frequency, landing),
    ),
    true,
  );
  assert.equal(
    closingStarts.some(
      (item) =>
        !item.dropped &&
        Math.abs(item.when - cadenceAt) < 1e-6 &&
        matchesMidi(item.frequency, shaped[0]?.midi ?? -1),
    ),
    false,
  );
  assert.equal(
    closingStarts.some((item) => !item.dropped && item.when > cadenceAt + 1e-4),
    false,
  );
  assert.equal(
    release.ramps.some(
      (ramp) =>
        ramp.value === 0 &&
        Math.abs(ramp.when - (holdEnd + PHRASE_END_RELEASE_SEC)) < 1e-6,
    ),
    true,
  );
  release.restore();
  closing.player.stop();
  assert.equal(closing.states.at(-1), 'idle');

  const stopClock = new PlaybackClock();
  const stopped = await playShaped(shaped, 2, true, stopClock);
  const stopStarts = stopped.starts;
  await roll(stopClock, lead + 0.4);
  const stopBoundary = nextPhraseBarLine(lead, stopClock.currentTime, tempo);
  stopped.player.queuePhrase({
    notes: fromHistory.phrase.notes,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: stopped.context,
    destination: stopped.context.destination,
    clock: stopClock,
  });
  stopped.player.stop();
  assert.equal(stopped.states.at(-1), 'idle');
  assert.equal(stopped.player.phraseChangeWaits(), false);
  assert.equal(
    stopped.stops.some((when) => Math.abs(when - 0.03) < 1e-3),
    true,
  );
  assert.equal(
    stopped.stops.some((when) => Math.abs(when - stopBoundary) < 1e-3),
    false,
  );
  await roll(stopClock, stopBoundary + 0.2);
  assert.equal(
    stopStarts.some(
      (item) =>
        item.when >= stopBoundary - 1e-6 &&
        matchesMidi(item.frequency, restoredFirst),
    ),
    false,
  );
});
