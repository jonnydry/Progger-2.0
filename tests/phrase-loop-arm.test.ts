import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  PHRASE_LOOKAHEAD_SEC,
  PHRASE_START_LEAD_SEC,
  PHRASE_TICK_SEC,
  PhrasePlayer,
  melodyFrets,
  nextPhraseBarLine,
  phraseLoopSeconds,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import {
  onsetSeconds,
  phrasePeriodBeats,
  type FingeredNote,
} from '../lib/phrase.ts';
import { voicingMidi } from '../lib/voicing-audio.ts';

const RATE = 44100;

const finger = {
  name: 'A',
  pc: 9,
  degree: '1',
  midi: 57,
  strong: false,
  chordTone: true,
  finger: 1,
  position: 5,
  shift: false,
} as const;

function note(fret: number, beat: number, duration = 1): FingeredNote {
  return { ...finger, string: 0, fret, beat, duration };
}

function pitchHz(fret: number): number {
  const midi = voicingMidi(melodyFrets({ string: 0, fret }))[0] ?? 0;
  return 440 * 2 ** ((midi - 69) / 12);
}

class TestClock implements PhraseClock {
  currentTime = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.currentTime;
  }

  after(delaySec: number, fn: () => void): number {
    assert.ok(delaySec > 1e-4, `wake did not move the clock (${delaySec}s)`);
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

async function roll(clock: TestClock, to: number) {
  let steps = 0;
  while (clock.currentTime + 1e-9 < to) {
    clock.advance(Math.min(to, clock.currentTime + PHRASE_TICK_SEC));
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(++steps < 40000, 'the clock spun');
  }
}

type Start = { when: number; frequency: number; oscillator: OscillatorNode };

function spy(context: OfflineAudioContext) {
  const starts: Start[] = [];
  const dropped = new Set<OscillatorNode>();
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    const disconnect = oscillator.disconnect.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push({ when, frequency: oscillator.frequency.value, oscillator });
      return start(when);
    };
    oscillator.disconnect = () => {
      dropped.add(oscillator);
      return disconnect();
    };
    return oscillator;
  };
  return { starts, dropped };
}

function near(start: Start, fret: number): boolean {
  return Math.abs(start.frequency - pitchHz(fret)) < 1e-3;
}

function context() {
  const offline = new OfflineAudioContext(1, RATE * 24, RATE);
  offline.resume = () => Promise.resolve();
  return offline;
}

/** A 2-bar phrase with a body note in each bar and its cadence on bar 3. */
const TWO_BARS: readonly FingeredNote[] = [
  note(0, 0, 4),
  note(3, 4, 4),
  note(8, 8, 2),
];

/**
 * Loop-on during the first bar must not fade the pass and start it again at
 * beat 1. The pass plays on, the repeat takes the next bar line, and the
 * repeat's beat 1 is that downbeat.
 */
void test('Loop on mid-pass repeats from the next bar line, not bar 1', async () => {
  const tempo = 120;
  const offline = context();
  const clock = new TestClock();
  const { starts } = spy(offline);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const bar = 4 * (60 / tempo);
  // Mid-bar 1, clear of both the start lead and the bar line.
  await roll(clock, lead + bar * 0.4);
  const barLine = nextPhraseBarLine(lead, clock.currentTime, tempo);
  assert.equal(barLine, lead + bar);
  const before = starts.length;
  assert.equal(player.isLooping, false);
  assert.equal(player.loopArmed, false);

  player.armAtNextBar({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  assert.equal(player.loopArmed, true, 'Loop on was not armed');
  assert.equal(player.isLooping, false, 'Loop on restarted the pass');
  // Nothing starts again from beat 1 before the bar line: the bar being
  // heard plays out. The repeat's own beat 1 on the bar line is expected,
  // so the check is bounded above by that boundary.
  await roll(clock, barLine - 0.02);
  assert.equal(
    starts.filter(
      (item) =>
        near(item, 0) && item.when > lead + 1e-6 && item.when < barLine - 1e-6,
    ).length,
    0,
    'Loop on restarted the pass from bar 1',
  );
  assert.ok(before >= 1);

  const boundary = barLine;
  await roll(clock, boundary + PHRASE_LOOKAHEAD_SEC + 0.02);
  assert.equal(player.loopArmed, false, 'the arm never landed');
  assert.equal(player.isLooping, true, 'the repeat did not start');
  const downbeat = starts.filter(
    (item) => near(item, 0) && Math.abs(item.when - boundary) < 1e-6,
  );
  assert.ok(
    downbeat.length >= 1,
    'the repeat did not begin on the armed bar line',
  );
  player.stop();
});

/**
 * The loop period is unchanged by the arming, so the repeat after the armed
 * one still wraps on the phrase's own loop length.
 */
void test('an armed repeat keeps the phrase loop period', async () => {
  const tempo = 120;
  const offline = context();
  const clock = new TestClock();
  const { starts } = spy(offline);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const bar = 4 * (60 / tempo);
  const loopSec = phraseLoopSeconds(TWO_BARS, tempo);
  assert.equal(loopSec, bar * 2);
  await roll(clock, lead + bar * 0.4);
  player.armAtNextBar({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  await roll(clock, boundary + loopSec + 0.05);
  const downbeats = starts
    .filter(
      (item) =>
        near(item, 0) &&
        item.when >= boundary - 1e-6 &&
        item.when <= boundary + loopSec + 1e-6,
    )
    .map((item) => item.when);
  assert.ok(
    downbeats.some((when) => Math.abs(when - boundary) < 1e-6),
    'the armed repeat did not start on its bar line',
  );
  assert.ok(
    downbeats.some((when) => Math.abs(when - (boundary + loopSec)) < 1e-6),
    `the next repeat did not wrap a full phrase later (${downbeats.join(',')})`,
  );
  player.stop();
});

/**
 * Turning Loop back off before the armed bar line lands must leave the
 * sounding pass alone: it plays to its closing note and no repeat starts.
 */
void test('Loop off before the armed bar line keeps the pass and drops the repeat', async () => {
  const tempo = 120;
  const offline = context();
  const clock = new TestClock();
  const { starts } = spy(offline);
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  await player.start({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const bar = 4 * (60 / tempo);
  await roll(clock, lead + bar * 0.4);
  player.armAtNextBar({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  player.cancelLoopArm();
  assert.equal(player.loopArmed, false);
  assert.equal(player.isLooping, false);

  const cadenceAt = lead + onsetSeconds(8, tempo, 0);
  await roll(clock, cadenceAt + 0.05);
  assert.ok(
    starts.some(
      (item) => near(item, 8) && Math.abs(item.when - cadenceAt) < 1e-6,
    ),
    'the closing note was dropped with the armed repeat',
  );
  await roll(clock, lead + phrasePeriodBeats(2) * (60 / tempo) + 0.4);
  assert.equal(
    starts.some((item) => near(item, 0) && item.when > cadenceAt + 1e-6),
    false,
    'a repeat started after Loop was turned back off',
  );
  assert.equal(states.at(-1), 'idle');
  player.stop();
});

/**
 * A Loop switched on with the closing cadence already sounding has no bar
 * line left in this pass. The repeat must begin where the pass ends rather
 * than leaving silence until a boundary that never arrives.
 */
void test('Loop on during the closing cadence repeats from the pass end', async () => {
  const tempo = 120;
  const offline = context();
  const clock = new TestClock();
  const { starts } = spy(offline);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const cadenceAt = lead + onsetSeconds(8, tempo, 0);
  await roll(clock, cadenceAt + 0.02);
  player.armAtNextBar({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  await roll(clock, cadenceAt + 0.9);
  assert.ok(
    starts.some((item) => near(item, 0) && item.when > cadenceAt + 0.1),
    'the repeat never started after the closing cadence',
  );
  player.stop();
});

/**
 * A tempo change armed while the phrase is looping is heard from the next
 * bar line and the repeat keeps looping. This is the half-speed and slider
 * release path, which used to cut the bar and restart from beat 1.
 */
void test('a retime armed during a loop lands on the next bar line and keeps looping', async () => {
  const tempo = 120;
  const slower = 60;
  const offline = context();
  const clock = new TestClock();
  const { starts } = spy(offline);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: TWO_BARS,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const bar = 4 * (60 / tempo);
  await roll(clock, lead + bar * 0.4);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  assert.equal(boundary, lead + bar);
  player.armAtNextBar({
    notes: TWO_BARS,
    bars: 2,
    tempo: slower,
    swing: 0,
    loop: true,
    context: offline,
    destination: offline.createGain(),
    clock,
  });
  assert.equal(player.loopArmed, false, 'a retime is not a Loop-on');
  await roll(clock, boundary + 6.05);
  // The bar that was sounding plays out: its own beat 1 is not re-struck.
  assert.equal(
    starts.filter(
      (item) =>
        near(item, 0) && item.when > lead + 1e-6 && item.when < boundary - 1e-6,
    ).length,
    0,
    'the retime cut the bar that was sounding',
  );
  // The tempo takes effect on the bar line, where the phrase restarts.
  assert.ok(
    starts.some(
      (item) => near(item, 0) && Math.abs(item.when - boundary) < 1e-6,
    ),
    'the new tempo did not start on the bar line',
  );
  // From there the phrase runs at the new tempo: its second bar begins four
  // slow quarters later, not two fast ones.
  assert.ok(
    starts.some(
      (item) => near(item, 3) && Math.abs(item.when - (boundary + 4)) < 1e-6,
    ),
    'the new tempo was not heard from the bar line',
  );
  assert.equal(
    starts.some(
      (item) => near(item, 3) && Math.abs(item.when - (boundary + 2)) < 1e-6,
    ),
    false,
    'the retimed pass kept the old tempo',
  );
  assert.equal(player.isLooping, true, 'the retime stopped looping');
  player.stop();
});
