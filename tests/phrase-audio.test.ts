import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, TUNING, spell } from '../lib/music.ts';
import {
  PHRASE_END_RELEASE_SEC,
  PHRASE_LOOKAHEAD_SEC,
  PHRASE_START_LEAD_SEC,
  PHRASE_TEMPO_DEFAULT,
  PHRASE_TEMPO_MAX,
  PHRASE_TEMPO_MIN,
  PHRASE_TICK_SEC,
  PHRASE_TRIM,
  LookaheadScheduler,
  PhrasePlayer,
  bindPhraseLifecycle,
  clampPhraseTempo,
  melodyFrets,
  nextPhraseBarLine,
  phraseClosingIndex,
  phraseLoopBeats,
  phraseLoopSeconds,
  schedulePhrase,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import { scheduleVoicing, voicingMidi } from '../lib/voicing-audio.ts';
import {
  beatAtSeconds,
  generatePhrase,
  onsetSeconds,
  phrasePeriodBeats,
  SWING_AMOUNT_DEFAULT,
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_ANCHOR_FAST_BPM,
  SWING_ANCHOR_FAST_RATIO,
  SWING_ANCHOR_MID_HIGH_BPM,
  SWING_ANCHOR_MID_LOW_BPM,
  SWING_ANCHOR_MID_RATIO,
  SWING_ANCHOR_SLOW_BPM,
  SWING_ANCHOR_SLOW_RATIO,
  SWING_RATIO_STRAIGHT,
  SWING_SHORT_EIGHTH_MIN_SEC,
  type FingeredNote,
  type SwingInput,
} from '../lib/phrase.ts';

const RATE = 44100;

function peakOf(channel: Float32Array): number {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function firstAudible(channel: Float32Array, floor: number): number {
  for (let index = 0; index < channel.length; index++) {
    if (Math.abs(channel[index]) >= floor) return index / RATE;
  }
  return -1;
}

async function renderNote(beat: number, swing: SwingInput, tempo = 120) {
  const seconds = 1;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(
    context,
    context.destination,
    [{ string: 0, fret: 0, beat }],
    tempo,
    swing,
    0,
  );
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

void test('phrase playback trims the existing voice and swings the offbeat', async () => {
  assert.equal(PHRASE_TRIM, 0.2);
  const straight = await renderNote(0.5, 'straight');
  const swing = await renderNote(0.5, 0.6);
  const straightAt = firstAudible(straight, 0.01);
  const swingAt = firstAudible(swing, 0.01);
  const lightAt = onsetSeconds(0.5, 120, 0.6);
  assert.ok(Math.abs(straightAt - onsetSeconds(0.5, 120, 'straight')) < 0.03);
  assert.ok(
    Math.abs(swingAt - lightAt) < 0.03,
    `light swing onset ${swingAt}s is not ${lightAt}s`,
  );
  assert.ok(Math.abs(swingAt - onsetSeconds(0.5, 120, 'swing')) > 0.02);
  assert.ok(swingAt > straightAt);
  assert.ok(peakOf(straight) > 0.01);
  assert.ok(peakOf(straight) < 0.5);
  assert.ok(peakOf(swing) < 0.5);

  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const phrase = generatePhrase({
    seed: 2,
    bars: 2,
    scaleNotes: spell('C', scale.formula),
    chordNotes: parseChord('C').notes,
  });
  assert.equal(phrase.ok, true);
  if (!phrase.ok) return;
  const context = new OfflineAudioContext(1, RATE * 3, RATE);
  schedulePhrase(
    context,
    context.destination,
    phrase.phrase.notes,
    96,
    'straight',
    0,
  );
  const rendered = await context.startRendering();
  const peak = peakOf(rendered.getChannelData(0));
  assert.ok(peak > 0.01 && peak < 0.5, `phrase peak ${peak}`);
});

void test('playback sounds the fingered phrase at its beats', () => {
  const scale = SCALES.find((item) => item.id === 'major');
  assert.ok(scale);
  const phrase = generatePhrase({
    seed: 3,
    bars: 2,
    scaleNotes: spell('C', scale.formula),
    chordNotes: parseChord('C').notes,
  });
  assert.equal(phrase.ok, true);
  if (!phrase.ok) return;
  const sounded: { midi: number; when: number }[] = [];
  const context = new OfflineAudioContext(1, RATE * 4, RATE);
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      const midi = Math.round(
        69 + 12 * Math.log2(oscillator.frequency.value / 440),
      );
      sounded.push({ midi, when });
      return start(when);
    };
    return oscillator;
  };
  schedulePhrase(
    context,
    context.destination,
    phrase.phrase.notes,
    96,
    'straight',
    0,
  );
  assert.deepEqual(
    sounded,
    phrase.phrase.notes.map((note) => ({
      midi: TUNING[note.string] + note.fret,
      when: onsetSeconds(note.beat, 96, 'straight'),
    })),
  );
  for (const note of phrase.phrase.notes) {
    assert.equal(TUNING[note.string] + note.fret, note.midi);
  }
});

void test('phrase playback never starts the drone and stays out of the first load', () => {
  const audio = readFileSync(
    new URL('../lib/phrase-audio.ts', import.meta.url),
    'utf8',
  );
  const page = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const launcher = readFileSync(
    new URL('../components/phrase-launcher.tsx', import.meta.url),
    'utf8',
  );
  for (const token of [
    'setDrone',
    'drone-audio',
    'drone-session',
    'ReedDrone',
    '.play(',
  ]) {
    assert.equal(audio.includes(token), false, token);
  }
  assert.equal(page.includes("from '@/lib/phrase'"), false);
  assert.equal(page.includes('phrase-audio'), false);
  assert.match(page, /from '@\/lib\/phrase-marks'/);
  assert.match(launcher, /import\('@\/components\/phrase-panel'\)/);
  assert.equal(launcher.includes("from '@/lib/phrase'"), false);
  assert.equal(launcher.includes('phrase-audio'), false);
  assert.equal(launcher.includes('.play('), false);
  assert.equal(launcher.includes('setOpen((current) => {'), false);
  assert.match(page, /phrase-tab-host/);
  const cluster = page.slice(
    page.indexOf('className="under-neck"'),
    page.indexOf('phraseMarks='),
  );
  assert.match(cluster, /<DroneControls/);
  assert.match(cluster, /<PhraseLauncher/);
  assert.match(cluster, /id="phrase-tab-host"/);
  assert.equal(page.includes('volumePopoverOrigin'), false);
  assert.match(audio, /phraseInput/);
  assert.match(audio, /PHRASE_END_RELEASE_SEC/);
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.equal(panel.includes('setHeard'), false);
  assert.equal(panel.includes('left-handed'), false);
  const voicing = readFileSync(
    new URL('../lib/voicing-audio.ts', import.meta.url),
    'utf8',
  );
  assert.equal(voicing.includes('phraseInput'), false);
});

class FakeClock implements PhraseClock {
  time = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.time;
  }

  after(delaySec: number, fn: () => void): number {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + Math.max(0, delaySec), fn });
    return id;
  }

  cancel(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  advance(to: number): void {
    this.time = to;
    for (;;) {
      let due: { id: number; at: number; fn: () => void } | null = null;
      for (const [id, timer] of this.timers) {
        if (timer.at <= this.time + 1e-9 && (!due || timer.at < due.at)) {
          due = { id, at: timer.at, fn: timer.fn };
        }
      }
      if (!due) break;
      this.timers.delete(due.id);
      due.fn();
    }
  }
}

const finger: FingeredNote = {
  name: 'A',
  pc: 9,
  degree: '1',
  midi: 57,
  beat: 0,
  duration: 1,
  strong: true,
  chordTone: true,
  string: 1,
  fret: 12,
  finger: 1,
  position: 12,
  shift: false,
};

void test('the playhead inverts straight and swing timing', () => {
  for (const beat of [0, 0.5, 1, 3.5, 8]) {
    const straight = onsetSeconds(beat, 96, 'straight');
    assert.ok(Math.abs(beatAtSeconds(straight, 96, 'straight') - beat) < 1e-9);
    const swing = onsetSeconds(beat, 96, 'swing');
    assert.ok(
      Math.abs(beatAtSeconds(swing, 96, 'swing') - beat) < 1e-6,
      `swing ${beat}`,
    );
  }
});

/** Quarter grid in seconds. Swing delays the offbeat to two thirds of the quarter. */
function gridSeconds(
  beat: number,
  tempo: number,
  feel: 'straight' | 'swing',
): number {
  const quarter = 60 / tempo;
  if (feel === 'straight') return beat * quarter;
  const whole = Math.floor(beat + 1e-9);
  const fraction = beat - whole;
  if (fraction < 0.01) return whole * quarter;
  if (Math.abs(fraction - 0.5) < 0.01) return (whole + 2 / 3) * quarter;
  return beat * quarter;
}

/**
 * The scheduler's clock is the audio context. `oscillator.start` receives
 * that time. Wall time is not read.
 */
class AudioClock implements PhraseClock {
  currentTime = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.currentTime;
  }

  after(delaySec: number, fn: () => void): number {
    if (!(delaySec > 1e-4)) {
      throw new Error(
        `wake did not move the audio clock at ${this.currentTime}s (delay ${delaySec}s)`,
      );
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
        if (timer.at <= this.currentTime + 1e-9 && (!due || timer.at < due.at))
          due = { id, at: timer.at, fn: timer.fn };
      }
      if (!due) break;
      this.timers.delete(due.id);
      due.fn();
    }
  }
}

function scheduledAudioOnsets(tempo: number, swing: SwingInput): number[] {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const context = new OfflineAudioContext(1, RATE, RATE);
  const bus = context.createGain();
  const starts: number[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push(when);
      return start(when);
    };
    return oscillator;
  };
  const clock = new AudioClock();
  new LookaheadScheduler(
    clock,
    beats,
    tempo,
    swing,
    0,
    30,
    false,
    (cue) => {
      scheduleVoicing(
        context,
        melodyFrets({ string: 0, fret: 0 }),
        cue.scheduled,
        bus,
      );
    },
    () => {},
  ).start();
  const end = 4 * (60 / tempo) + PHRASE_TICK_SEC;
  let steps = 0;
  while (clock.currentTime < end) {
    clock.advance(clock.currentTime + PHRASE_TICK_SEC);
    assert.ok(++steps < 2000, 'the audio clock spun');
  }
  return starts;
}

void test('scheduled onsets match 60 and 120 BPM, straight and swung', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const measured: {
    tempo: number;
    feel: 'straight' | 'swing';
    quarterSec: number;
    averageQuarterSec: number;
    bpm: number;
    maxErrorMs: number;
  }[] = [];
  for (const tempo of [60, 120] as const) {
    for (const feel of ['straight', 'swing'] as const) {
      const starts = scheduledAudioOnsets(tempo, feel);
      assert.equal(starts.length, beats.length);
      let maxError = 0;
      const quarterTimes: number[] = [];
      for (const [index, beat] of beats.entries()) {
        const expected = gridSeconds(beat, tempo, feel);
        const error = Math.abs((starts[index] ?? NaN) - expected);
        maxError = Math.max(maxError, error);
        assert.ok(
          error <= 0.001,
          `${feel} ${tempo} beat ${beat} audio start ${starts[index]}s is ${error * 1000}ms off ${expected}s`,
        );
        if (Number.isInteger(beat)) quarterTimes.push(starts[index] ?? NaN);
      }
      const gaps = quarterTimes.slice(1).map((time, index) => {
        const previous = quarterTimes[index] ?? 0;
        return time - previous;
      });
      const averageQuarterSec =
        gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      const bpm = 60 / averageQuarterSec;
      measured.push({
        tempo,
        feel,
        quarterSec: 60 / tempo,
        averageQuarterSec,
        bpm,
        maxErrorMs: maxError * 1000,
      });
      if (feel === 'swing') {
        assert.ok(
          Math.abs(bpm - tempo) <= 0.05,
          `swung quarter gap averages ${averageQuarterSec}s (${bpm} BPM), not ${tempo}`,
        );
      }
    }
  }
  console.log(JSON.stringify({ audioClock: true, measured }));
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /min=\{PHRASE_TEMPO_MIN\}/);
  assert.match(panel, /max=\{tempoMax\}/);
  assert.match(
    panel,
    /const tempoMax = slow \? PHRASE_TEMPO_MAX \/ 2 : PHRASE_TEMPO_MAX/,
  );
  assert.match(
    panel,
    /const written = clampPhraseTempo\(slow \? sounding \* 2 : sounding\)/,
  );
  assert.match(panel, /value=\{playbackTempo\}/);
  assert.equal(PHRASE_TEMPO_MIN, 40);
  assert.equal(PHRASE_TEMPO_MAX, 240);
  assert.match(panel, /<output>\{playbackTempo\} BPM<\/output>/);
});

/** Anchor curve, written here so a wrong onsetSeconds fails this clock. */
function briefFullRatio(bpm: number): number {
  const anchors = [
    { bpm: SWING_ANCHOR_SLOW_BPM, ratio: SWING_ANCHOR_SLOW_RATIO },
    { bpm: SWING_ANCHOR_MID_LOW_BPM, ratio: SWING_ANCHOR_MID_RATIO },
    { bpm: SWING_ANCHOR_MID_HIGH_BPM, ratio: SWING_ANCHOR_MID_RATIO },
    { bpm: SWING_ANCHOR_FAST_BPM, ratio: SWING_ANCHOR_FAST_RATIO },
  ];
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (!first || !last) return SWING_ANCHOR_MID_RATIO;
  if (bpm <= first.bpm) return first.ratio;
  if (bpm >= last.bpm) return last.ratio;
  for (let index = 1; index < anchors.length; index++) {
    const right = anchors[index];
    const left = anchors[index - 1];
    if (!right || !left || bpm > right.bpm) continue;
    const along = (bpm - left.bpm) / (right.bpm - left.bpm);
    return left.ratio + (right.ratio - left.ratio) * along;
  }
  return last.ratio;
}

function briefRatio(bpm: number, amount: number): number {
  const desired =
    SWING_RATIO_STRAIGHT +
    (briefFullRatio(bpm) - SWING_RATIO_STRAIGHT) * amount;
  const quarter = 60 / bpm;
  const maxRatio = quarter / SWING_SHORT_EIGHTH_MIN_SEC - SWING_RATIO_STRAIGHT;
  const room = Math.max(SWING_RATIO_STRAIGHT, maxRatio);
  return Math.min(Math.max(desired, SWING_RATIO_STRAIGHT), room);
}

function briefOnset(beat: number, bpm: number, amount: number): number {
  const quarter = 60 / bpm;
  const ratio = briefRatio(bpm, amount);
  if (ratio === SWING_RATIO_STRAIGHT) return beat * quarter;
  const whole = Math.floor(beat + 1e-9);
  const fraction = beat - whole;
  if (fraction < 0.01) return whole * quarter;
  if (Math.abs(fraction - 0.5) < 0.01) {
    return (whole + ratio / (ratio + SWING_RATIO_STRAIGHT)) * quarter;
  }
  return beat * quarter;
}

void test('swing intensity ratios sit on the audio clock', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const sixtyPercent = 0.6;
  const amounts = [SWING_AMOUNT_MIN, sixtyPercent, SWING_AMOUNT_MAX];
  const measured: {
    tempo: number;
    amount: number;
    ratio: number;
    expectedRatio: number;
    averageQuarterSec: number;
    bpm: number;
    maxErrorMs: number;
    shortEighthSec: number;
  }[] = [];
  for (const tempo of [60, 120, 180, 280, 290]) {
    for (const amount of amounts) {
      if (tempo === 290 && amount !== SWING_AMOUNT_MAX) continue;
      const starts = scheduledAudioOnsets(tempo, amount);
      assert.equal(starts.length, beats.length);
      let maxError = 0;
      const quarterTimes: number[] = [];
      const ratios: number[] = [];
      const shorts: number[] = [];
      for (const [index, beat] of beats.entries()) {
        const expected = briefOnset(beat, tempo, amount);
        const error = Math.abs((starts[index] ?? NaN) - expected);
        maxError = Math.max(maxError, error);
        assert.ok(
          error <= 0.001,
          `${tempo} BPM ${amount * 100}% beat ${beat} audio start ${starts[index]}s is ${error * 1000}ms off ${expected}s`,
        );
        if (Number.isInteger(beat)) quarterTimes.push(starts[index] ?? NaN);
        if (Math.abs(beat - Math.floor(beat) - 0.5) < 0.01) {
          const long = (starts[index] ?? NaN) - (starts[index - 1] ?? NaN);
          const short = (starts[index + 1] ?? NaN) - (starts[index] ?? NaN);
          ratios.push(long / short);
          shorts.push(short);
          const pair = long + short;
          assert.equal(
            pair,
            (starts[index + 1] ?? NaN) - (starts[index - 1] ?? NaN),
          );
          assert.ok(
            Math.abs(pair - 60 / tempo) <= 1e-9,
            `${tempo} BPM eighth pair ${pair}s is not one beat`,
          );
          assert.ok(
            short >= SWING_SHORT_EIGHTH_MIN_SEC - 0.001,
            `${tempo} BPM short eighth ${short}s is under 100 ms`,
          );
        }
      }
      const gaps = quarterTimes.slice(1).map((time, index) => {
        const previous = quarterTimes[index] ?? 0;
        return time - previous;
      });
      const averageQuarterSec =
        gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length;
      const bpm = 60 / averageQuarterSec;
      const ratio =
        ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
      const shortEighthSec =
        shorts.reduce((sum, value) => sum + value, 0) / shorts.length;
      const expectedRatio = briefRatio(tempo, amount);
      measured.push({
        tempo,
        amount,
        ratio,
        expectedRatio,
        averageQuarterSec,
        bpm,
        maxErrorMs: maxError * 1000,
        shortEighthSec,
      });
      assert.ok(
        Math.abs(ratio - expectedRatio) <= 0.02,
        `${tempo} BPM ${amount * 100}% ratio ${ratio} is not ${expectedRatio}`,
      );
      assert.ok(
        Math.abs(bpm - tempo) <= 0.05,
        `quarter gap averages ${averageQuarterSec}s (${bpm} BPM), not ${tempo}`,
      );
      if (tempo === 290) {
        const quarter = 60 / tempo;
        const unclamped = quarter / (SWING_ANCHOR_FAST_RATIO + 1);
        assert.ok(unclamped < SWING_SHORT_EIGHTH_MIN_SEC);
        assert.ok(quarter / 2 > SWING_SHORT_EIGHTH_MIN_SEC);
        assert.ok(
          Math.abs(shortEighthSec - SWING_SHORT_EIGHTH_MIN_SEC) <= 0.001,
        );
        assert.ok(ratio > SWING_RATIO_STRAIGHT);
      }
    }
  }
  const partialTempo = 292;
  const partialStarts = scheduledAudioOnsets(partialTempo, sixtyPercent);
  const partialShorts: number[] = [];
  for (const beat of [0.5, 1.5, 2.5, 3.5]) {
    const index = beats.indexOf(beat);
    const start = partialStarts[index] ?? NaN;
    const next = partialStarts[index + 1] ?? NaN;
    const previous = partialStarts[index - 1] ?? NaN;
    const expected = briefOnset(beat, partialTempo, sixtyPercent);
    assert.ok(
      Math.abs(start - expected) <= 0.001,
      `292 BPM 60% beat ${beat} is ${Math.abs(start - expected) * 1000}ms off`,
    );
    const short = next - start;
    partialShorts.push(short);
    assert.ok(Math.abs(short - SWING_SHORT_EIGHTH_MIN_SEC) <= 0.001);
    const cap = 60 / partialTempo / SWING_SHORT_EIGHTH_MIN_SEC - 1;
    const blendedAfter = SWING_RATIO_STRAIGHT + (cap - 1) * sixtyPercent;
    const heard = (start - previous) / short;
    assert.ok(Math.abs(heard - cap) < Math.abs(heard - blendedAfter));
    assert.ok(Math.abs(next - previous - 60 / partialTempo) <= 1e-9);
  }
  const floorTempo = 300;
  const floorStarts = scheduledAudioOnsets(floorTempo, SWING_AMOUNT_MAX);
  const floorQuarter = 60 / floorTempo;
  const floorRatios: number[] = [];
  for (const beat of [0.5, 1.5, 2.5, 3.5]) {
    const index = beats.indexOf(beat);
    const down = floorStarts[index - 1] ?? NaN;
    const off = floorStarts[index] ?? NaN;
    const next = floorStarts[index + 1] ?? NaN;
    const pair = off - down + (next - off);
    assert.equal(pair, next - down);
    assert.ok(Math.abs(pair - floorQuarter) <= 1e-9);
    assert.ok(Math.abs(down - (beat - 0.5) * floorQuarter) <= 1e-9);
    floorRatios.push((off - down) / (next - off));
  }
  const heardAt300 =
    floorRatios.reduce((sum, value) => sum + value, 0) / floorRatios.length;
  const targetAt300 = briefFullRatio(floorTempo);
  console.log(
    JSON.stringify({
      swingClock: true,
      measured,
      partialFloor: {
        tempo: partialTempo,
        amount: sixtyPercent,
        shortEighthSec:
          partialShorts.reduce((sum, value) => sum + value, 0) /
          partialShorts.length,
      },
      clampAt300: {
        target: targetAt300,
        heard: heardAt300,
        drop: targetAt300 - heardAt300,
      },
    }),
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /min=\{SWING_AMOUNT_MIN\}/);
  assert.match(panel, /max=\{SWING_AMOUNT_MAX\}/);
  assert.match(panel, /useState\(SWING_AMOUNT_DEFAULT\)/);
  assert.match(panel, /step=\{SWING_AMOUNT_STEP\}/);
  assert.equal(panel.match(/tempo: tempoNow/g)?.length, 2);
  assert.match(panel, /tempoRef=\{soundingTempo\}/);
  assert.doesNotMatch(panel, /Straight/);
  assert.doesNotMatch(panel, /setFeel/);
});

void test('tempo clamps to 40–240 BPM and playback uses that clamp', async () => {
  assert.equal(PHRASE_TEMPO_MIN, 40);
  assert.equal(PHRASE_TEMPO_MAX, 240);
  assert.equal(PHRASE_TEMPO_DEFAULT, 96);
  assert.equal(clampPhraseTempo(5), PHRASE_TEMPO_MIN);
  assert.equal(clampPhraseTempo(20), 40);
  assert.equal(clampPhraseTempo(40), 40);
  assert.equal(clampPhraseTempo(120), 120);
  assert.equal(clampPhraseTempo(240), 240);
  assert.equal(clampPhraseTempo(300), 240);
  assert.equal(clampPhraseTempo(900), PHRASE_TEMPO_MAX);
  assert.equal(clampPhraseTempo(Number.NaN), PHRASE_TEMPO_DEFAULT);
  assert.equal(PHRASE_END_RELEASE_SEC, 0.3);
  const atCeiling = await renderNote(1, 'straight', 240);
  const aboveCeiling = await renderNote(1, 'straight', 5000);
  assert.ok(
    Math.abs(firstAudible(atCeiling, 0.01) - firstAudible(aboveCeiling, 0.01)) <
      0.02,
  );
});

void test('a tick inside the lookahead keeps the note on its audio time', () => {
  const clock = new FakeClock();
  const cues: { intended: number; scheduled: number }[] = [];
  const scheduler = new LookaheadScheduler(
    clock,
    [0],
    60,
    'straight',
    1,
    4,
    false,
    (cue) => cues.push(cue),
    () => {},
  );
  scheduler.start();
  clock.advance(0.9);
  assert.equal(cues.length, 1);
  const cue = cues[0];
  assert.ok(cue);
  const jitter = cue.scheduled - cue.intended;
  assert.equal(jitter, 0);
  assert.equal(cue.intended, 1);
  console.log(
    JSON.stringify({
      lookaheadSec: PHRASE_LOOKAHEAD_SEC,
      onTimeJitter: jitter,
    }),
  );
});

void test('a tick past the lookahead plays late and a loop keeps its grid', () => {
  const lateClock = new FakeClock();
  const late: { intended: number; scheduled: number }[] = [];
  new LookaheadScheduler(
    lateClock,
    [0],
    60,
    'straight',
    1,
    4,
    false,
    (cue) => late.push(cue),
    () => {},
  ).start();
  lateClock.advance(1.04);
  const missed = late[0];
  assert.ok(missed);
  const lateJitter = missed.scheduled - missed.intended;
  assert.ok(lateJitter > 0.03 && lateJitter < 0.05);
  assert.equal(missed.scheduled, lateClock.now());
  console.log(JSON.stringify({ latePastLookaheadJitter: lateJitter }));

  const clock = new FakeClock();
  const cues: { intended: number; scheduled: number }[] = [];
  new LookaheadScheduler(
    clock,
    [0],
    60,
    'straight',
    0,
    2,
    true,
    (cue) => cues.push(cue),
    () => {},
  ).start();
  clock.advance(1.9);
  assert.deepEqual(
    cues.map((cue) => cue.intended),
    [0, 2, 4],
  );
  assert.equal(cues[1]?.scheduled, 2);
  assert.equal(cues[2]?.scheduled, 4);
});

void test('a late wake keeps the latest overdue note instead of stacking the run', () => {
  const clock = new FakeClock();
  const cues: { intended: number; scheduled: number }[] = [];
  new LookaheadScheduler(
    clock,
    [0, 0.5, 1, 1.5],
    120,
    'straight',
    0,
    2,
    true,
    (cue) => cues.push(cue),
    () => {},
  ).start();
  clock.advance(3.2);
  const stacked = cues.filter((cue) => cue.scheduled === clock.now());
  assert.ok(stacked.length <= 1, `stacked ${stacked.length}`);
  assert.ok(cues.every((cue) => cue.intended <= cue.scheduled + 1e-9));
});

void test('stop, dispose, and a rejected bar count leave no timers or nodes', async () => {
  const context = new OfflineAudioContext(1, RATE, RATE);
  context.resume = () => Promise.resolve();
  const destination = context.createGain();
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  await player.start({
    notes: [finger],
    bars: 3 as 2,
    tempo: 120,
    swing: 'straight',
    loop: false,
    context,
    destination,
  });
  assert.deepEqual(states, []);
  await player.start({
    notes: [
      { ...finger, beat: 0 },
      { ...finger, beat: 2, fret: 14, midi: 59 },
    ],
    bars: 2,
    tempo: 5,
    swing: 'straight',
    loop: true,
    context,
    destination,
  });
  assert.equal(states.at(-1), 'playing');
  player.stop();
  player.dispose();
  assert.equal(player.pendingTimers(), 0);
  assert.equal(player.connectedNodes(), 0);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(player.pendingTimers(), 0);
  assert.equal(player.connectedNodes(), 0);
});

void test('hiding the page and restoring from bfcache only pauses', () => {
  let hidden = false;
  const docListeners = new Map<string, Set<() => void>>();
  const hostListeners = new Map<string, Set<(event: Event) => void>>();
  const doc = {
    get hidden() {
      return hidden;
    },
    addEventListener(type: string, listener: () => void) {
      const set = docListeners.get(type) ?? new Set();
      set.add(listener);
      docListeners.set(type, set);
    },
    removeEventListener(type: string, listener: () => void) {
      docListeners.get(type)?.delete(listener);
    },
  };
  const host = {
    addEventListener(type: string, listener: (event: Event) => void) {
      const set = hostListeners.get(type) ?? new Set();
      set.add(listener);
      hostListeners.set(type, set);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      hostListeners.get(type)?.delete(listener);
    },
  };
  let pauses = 0;
  const unbind = bindPhraseLifecycle(doc, host, () => {
    pauses += 1;
  });
  assert.equal(docListeners.get('visibilitychange')?.size, 1);
  assert.equal(hostListeners.get('pagehide')?.size, 1);
  assert.equal(hostListeners.get('pageshow')?.size, 1);
  hidden = true;
  docListeners.get('visibilitychange')?.forEach((listener) => listener());
  hostListeners
    .get('pagehide')
    ?.forEach((listener) => listener(new Event('pagehide')));
  const pageShow = (persisted: boolean) => {
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: persisted });
    return event;
  };
  hostListeners
    .get('pageshow')
    ?.forEach((listener) => listener(pageShow(false)));
  assert.equal(pauses, 2);
  hostListeners
    .get('pageshow')
    ?.forEach((listener) => listener(pageShow(true)));
  assert.equal(pauses, 3);
  unbind();
  assert.equal(docListeners.get('visibilitychange')?.size ?? 0, 0);
  assert.equal(hostListeners.get('pagehide')?.size ?? 0, 0);
  assert.equal(hostListeners.get('pageshow')?.size ?? 0, 0);
});

const QUARTER_BEATS = [0, 1, 2, 3, 4];

/** Live playback path: lookahead scheduler hands each quarter to the voice. */
function scheduledQuarterOnsets(tempo: number): number[] {
  const context = new OfflineAudioContext(1, RATE, RATE);
  const bus = context.createGain();
  const starts: number[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push(when);
      return start(when);
    };
    return oscillator;
  };
  const clock = new AudioClock();
  const quarter = 60 / tempo;
  new LookaheadScheduler(
    clock,
    QUARTER_BEATS,
    tempo,
    0,
    0,
    QUARTER_BEATS[QUARTER_BEATS.length - 1] * quarter + 1,
    false,
    (cue) => {
      scheduleVoicing(
        context,
        melodyFrets({ string: 0, fret: 0 }),
        cue.scheduled,
        bus,
      );
    },
    () => {},
  ).start();
  const end = 4 * quarter + PHRASE_TICK_SEC;
  let steps = 0;
  while (clock.currentTime < end) {
    clock.advance(clock.currentTime + PHRASE_TICK_SEC);
    assert.ok(++steps < 4000, 'the audio clock spun');
  }
  return starts;
}

/** Render path: schedulePhrase places the same quarters on the audio clock. */
function renderedQuarterOnsets(tempo: number): number[] {
  const seconds = 4 * (60 / tempo) + 0.1;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  const starts: number[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push(when);
      return start(when);
    };
    return oscillator;
  };
  schedulePhrase(
    context,
    context.destination,
    QUARTER_BEATS.map((beat) => ({ string: 0, fret: 0, beat })),
    tempo,
    0,
    0,
  );
  return starts;
}

async function audibleQuarterOnset(
  beat: number,
  tempo: number,
): Promise<number> {
  const seconds = beat * (60 / tempo) + 0.05;
  const context = new OfflineAudioContext(
    1,
    Math.ceil(RATE * Math.max(seconds, 0.05)),
    RATE,
  );
  schedulePhrase(
    context,
    context.destination,
    [{ string: 0, fret: 0, beat }],
    tempo,
    0,
    0,
  );
  const rendered = await context.startRendering();
  return firstAudible(rendered.getChannelData(0), 0.01);
}

void test('quarter-note gaps at 40, 120 and 240 BPM equal 60/BPM with swing at 0', async () => {
  assert.equal(SWING_AMOUNT_DEFAULT, 0);
  for (const tempo of [40, 120, 240] as const) {
    const expected = 60 / tempo;
    for (const starts of [
      scheduledQuarterOnsets(tempo),
      renderedQuarterOnsets(tempo),
    ]) {
      assert.equal(starts.length, QUARTER_BEATS.length);
      for (let index = 1; index < starts.length; index++) {
        const gap = (starts[index] ?? NaN) - (starts[index - 1] ?? NaN);
        assert.ok(
          Math.abs(gap - expected) <= 0.001,
          `${tempo} BPM quarter gap ${gap}s is not ${expected}s`,
        );
      }
    }
    const downbeat = await audibleQuarterOnset(0, tempo);
    const nextBeat = await audibleQuarterOnset(1, tempo);
    const heard = nextBeat - downbeat;
    assert.ok(
      Math.abs(heard - expected) <= 0.001,
      `${tempo} BPM rendered quarter gap ${heard}s is not ${expected}s`,
    );
  }
});

void test('a new session starts straight and does not restore swing or tempo', () => {
  assert.equal(SWING_AMOUNT_DEFAULT, 0);
  assert.equal(PHRASE_TEMPO_DEFAULT, 96);
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const launcher = readFileSync(
    new URL('../components/phrase-launcher.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /useState\(SWING_AMOUNT_DEFAULT\)/);
  assert.match(panel, /useState\(PHRASE_TEMPO_DEFAULT\)/);
  // Tempo and swing live only in this session. There is no saved number
  // whose old meaning would need a conversion.
  for (const source of [panel, launcher]) {
    assert.equal(source.includes('localStorage'), false, source);
    assert.equal(source.includes('sessionStorage'), false);
    assert.equal(source.includes('searchParams'), false);
    assert.equal(source.includes('location.hash'), false);
  }
  assert.match(panel, /const \[loop, setLoop\] = useState\(false\)/);
});

function slotNote(beat: number, duration: number): FingeredNote {
  return { ...finger, string: 0, fret: 0, beat, duration };
}

/** Downbeats of a loop, stepped on a coarse clock so a late tick is visible. */
function loopDownbeats(
  beats: readonly number[],
  tempo: number,
  swing: SwingInput,
  period: number,
  passes: number,
  loopBeats = Number.POSITIVE_INFINITY,
): number[] {
  const clock = new AudioClock();
  const cues: { index: number; intended: number; scheduled: number }[] = [];
  new LookaheadScheduler(
    clock,
    beats,
    tempo,
    swing,
    0,
    period,
    true,
    (cue) => cues.push(cue),
    () => {
      throw new Error('a loop ended');
    },
    loopBeats,
  ).start();
  const end = period * passes;
  let steps = 0;
  while (clock.currentTime < end) {
    clock.advance(clock.currentTime + 0.04);
    assert.ok(++steps < 20000, 'the loop clock spun');
  }
  const downs = cues.filter((cue) => cue.index === 0);
  assert.ok(downs.length >= passes, `saw ${downs.length} downbeats`);
  for (const cue of downs) {
    assert.equal(cue.scheduled, cue.intended);
  }
  if (loopBeats < Infinity) {
    const heard = new Map<number, number>();
    for (const cue of cues) {
      const beat = beats[cue.index] ?? 0;
      assert.ok(
        beat < loopBeats - 1e-9,
        `beat ${beat} is at or after the ${loopBeats}-beat loop`,
      );
      const key = Math.round(cue.scheduled * 1e9);
      heard.set(key, (heard.get(key) ?? 0) + 1);
    }
    for (const [time, count] of heard) {
      assert.equal(count, 1, `two notes share ${time / 1e9}s`);
    }
  }
  return downs.slice(0, passes).map((cue) => cue.scheduled);
}

void test('a loop restarts on the next bar line, on the audio clock, with no gap', () => {
  const cases: {
    tempo: number;
    swing: SwingInput;
    notes: { beat: number; duration: number }[];
  }[] = [
    {
      tempo: 40,
      swing: 0,
      notes: [
        { beat: 0, duration: 4 },
        { beat: 6, duration: 1 },
        { beat: 8, duration: 2 },
      ],
    },
    {
      tempo: 96,
      swing: 'straight',
      notes: [
        { beat: 0, duration: 8 },
        { beat: 14, duration: 1 },
        { beat: 16, duration: 2 },
      ],
    },
    {
      tempo: 73,
      swing: 0,
      notes: [
        { beat: 0, duration: 2.5 },
        { beat: 2.5, duration: 0.25 },
      ],
    },
    {
      tempo: 240,
      swing: 1,
      notes: [
        { beat: 0, duration: 3 },
        { beat: 3, duration: 0.5 },
      ],
    },
    {
      tempo: 120,
      swing: 'swing',
      notes: [
        { beat: 0, duration: 0.5 },
        { beat: 0.5, duration: 6.5 },
        { beat: 7.5, duration: 0.5 },
      ],
    },
  ];
  for (const item of cases) {
    const length = phraseLoopSeconds(item.notes, item.tempo);
    const beats = phraseLoopBeats(item.notes);
    const closing = phraseClosingIndex(item.notes);
    assert.equal(beats % 4, 0);
    if (closing >= 0) {
      const landing = item.notes[closing];
      assert.ok(landing);
      assert.ok(Math.abs(landing.beat - beats) < 1e-9);
    }
    assert.equal(length, beats * (60 / item.tempo));
    const quarter = 60 / item.tempo;
    assert.equal(length, onsetSeconds(beats, item.tempo, item.swing));
    const content = item.notes.filter((_, index) => index !== closing);
    const lastOnset = content.reduce(
      (max, note) => Math.max(max, note.beat),
      0,
    );
    if (item.swing !== 0 && item.swing !== 'straight' && lastOnset % 1 !== 0) {
      assert.ok(
        Math.abs(length - onsetSeconds(lastOnset, item.tempo, item.swing)) >
          1e-6,
        `${item.tempo} BPM loop length followed the swung last note`,
      );
    }
    const downs = loopDownbeats(
      item.notes.map((note) => note.beat),
      item.tempo,
      item.swing,
      length,
      4,
      beats,
    );
    assert.equal(downs[0], 0);
    for (let pass = 0; pass < downs.length - 1; pass++) {
      const gap = (downs[pass + 1] ?? NaN) - (downs[pass] ?? NaN);
      assert.ok(
        Math.abs(gap - length) < 1e-10,
        `${item.tempo} BPM ${beats} beats, pass ${pass} gap ${gap}s is not ${length}s`,
      );
      assert.ok(
        Math.abs(gap - beats * quarter) < 1e-10,
        `${item.tempo} BPM seam is not ${beats} quarters`,
      );
    }
  }
  const scale = SCALES.find((entry) => entry.id === 'major');
  assert.ok(scale);
  for (const bars of [2, 4] as const) {
    const phrase = generatePhrase({
      seed: 4,
      bars,
      scaleNotes: spell('C', scale.formula),
      chordNotes: parseChord('C').notes,
    });
    assert.equal(phrase.ok, true);
    if (!phrase.ok) return;
    const tail = phrase.phrase.notes[phrase.phrase.notes.length - 1];
    assert.ok(tail);
    assert.equal(tail.beat + tail.duration, phrasePeriodBeats(bars));
    const loopBeats = bars * 4;
    assert.equal(phraseLoopBeats(phrase.phrase.notes), loopBeats);
    assert.equal(
      phraseClosingIndex(phrase.phrase.notes),
      phrase.phrase.notes.length - 1,
    );
    assert.equal(
      phrase.phrase.notes[phrase.phrase.notes.length - 1]?.beat,
      loopBeats,
    );
    for (const tempo of [40, 96, 240]) {
      assert.equal(
        phraseLoopSeconds(phrase.phrase.notes, tempo),
        onsetSeconds(loopBeats, tempo, 'swing'),
      );
    }
    const played = loopDownbeats(
      phrase.phrase.notes.map((note) => note.beat),
      96,
      0,
      phraseLoopSeconds(phrase.phrase.notes, 96),
      3,
      loopBeats,
    );
    assert.equal(played.length, 3);
  }
});

void test('loop off plays one pass on the bar grid and then stops', () => {
  const notes = [
    { beat: 0, duration: 2.5 },
    { beat: 2.5, duration: 0.25 },
  ];
  const tempo = 73;
  const swing: SwingInput = 'swing';
  const period = onsetSeconds(phrasePeriodBeats(2), tempo, swing);
  const clock = new AudioClock();
  const cues: { index: number; intended: number; scheduled: number }[] = [];
  let ended = 0;
  new LookaheadScheduler(
    clock,
    notes.map((note) => note.beat),
    tempo,
    swing,
    0,
    period,
    false,
    (cue) => cues.push(cue),
    () => {
      ended += 1;
    },
  ).start();
  let steps = 0;
  while (ended === 0) {
    clock.advance(clock.currentTime + PHRASE_TICK_SEC);
    assert.ok(++steps < 20000, 'the single pass never ended');
  }
  const endedAt = clock.currentTime;
  clock.advance(clock.currentTime + period);
  assert.equal(ended, 1);
  assert.equal(cues.length, notes.length);
  for (const [index, note] of notes.entries()) {
    const cue = cues[index];
    assert.ok(cue);
    assert.equal(cue.scheduled, onsetSeconds(note.beat, tempo, swing));
  }
  assert.ok(period > phraseLoopSeconds(notes, tempo));
  assert.ok(endedAt <= period);
  assert.ok(endedAt + PHRASE_LOOKAHEAD_SEC + 1e-9 >= period);
});

void test('loop off keeps the 10-beat and 18-beat cadence hold', () => {
  for (const bars of [2, 4] as const) {
    const hold = phrasePeriodBeats(bars);
    assert.equal(hold, bars * 4 + 2);
    const tempo = 120;
    const swing: SwingInput = 0;
    const period = onsetSeconds(hold, tempo, swing);
    const notes = [
      { beat: 0, duration: 1 },
      { beat: bars * 4 - 1, duration: 1 },
      { beat: bars * 4, duration: 2 },
    ];
    assert.equal(phraseLoopBeats(notes), bars * 4);
    assert.ok(period > phraseLoopSeconds(notes, tempo));
    const clock = new AudioClock();
    const cues: { index: number; scheduled: number }[] = [];
    let endedAt = -1;
    new LookaheadScheduler(
      clock,
      notes.map((note) => note.beat),
      tempo,
      swing,
      0,
      period,
      false,
      (cue) => cues.push(cue),
      () => {
        endedAt = clock.currentTime;
      },
    ).start();
    let steps = 0;
    while (endedAt < 0) {
      clock.advance(clock.currentTime + PHRASE_TICK_SEC);
      assert.ok(++steps < 20000, `${bars} bars never stopped`);
    }
    const loopAt = phraseLoopSeconds(notes, tempo);
    while (clock.currentTime < loopAt + period) {
      clock.advance(clock.currentTime + PHRASE_TICK_SEC);
      assert.ok(++steps < 40000, `${bars} bars kept spinning`);
    }
    assert.equal(cues.length, notes.length);
    assert.equal(cues[0]?.scheduled, 0);
    assert.equal(cues[2]?.scheduled, onsetSeconds(bars * 4, tempo, swing));
    assert.ok(endedAt <= period);
    assert.ok(
      endedAt + PHRASE_LOOKAHEAD_SEC + 1e-9 >= period,
      `${bars} bars stopped at ${endedAt}s, before the ${period}s hold`,
    );
    assert.ok(endedAt > loopAt);
  }
});

void test('an onset exactly on a bar line fills the next bar', () => {
  // Ceil of an exact bar line was one bar short, so the note on that
  // line was skipped (beat >= loop length). The whole note at beat 4
  // has to sit inside an 8-beat loop; the cadence at 8 stays outside.
  const wholeOnTheBar = [
    { beat: 0, duration: 2 },
    { beat: 2, duration: 2 },
    { beat: 4, duration: 4 },
    { beat: 8, duration: 2 },
  ];
  assert.equal(phraseClosingIndex(wholeOnTheBar), wholeOnTheBar.length - 1);
  assert.equal(phraseLoopBeats(wholeOnTheBar), 8);
  assert.ok(
    wholeOnTheBar[2] && wholeOnTheBar[2].beat < phraseLoopBeats(wholeOnTheBar),
  );

  const threeFour = [
    { beat: 0, duration: 1.5 },
    { beat: 1.5, duration: 1.5 },
    { beat: 3, duration: 3 },
    { beat: 6, duration: 2 },
  ];
  assert.equal(phraseClosingIndex(threeFour, 3), threeFour.length - 1);
  assert.equal(phraseLoopBeats(threeFour, 3), 6);
  assert.ok(threeFour[2] && threeFour[2].beat < phraseLoopBeats(threeFour, 3));
});

void test('a 3/4 loop uses bars of three and a 4/4 phrase loops at 8 or 16', () => {
  assert.equal(phraseLoopBeats([{ beat: 0, duration: 3 }], 3), 3);
  const pastTheBar = [
    { beat: 0, duration: 3 },
    { beat: 4, duration: 0.5 },
  ];
  assert.equal(phraseLoopBeats(pastTheBar, 3), 6);
  assert.equal(
    phraseLoopBeats(
      [
        { beat: 0, duration: 1 },
        { beat: 5, duration: 1 },
      ],
      4,
    ),
    8,
  );
  const twoBars = [
    { beat: 0, duration: 2 },
    { beat: 2, duration: 1 },
    { beat: 3, duration: 2 },
    { beat: 5, duration: 1 },
    { beat: 6, duration: 2 },
  ];
  assert.equal(phraseClosingIndex(twoBars, 3), twoBars.length - 1);
  assert.equal(phraseLoopBeats(twoBars, 3), 6);
  const tempo = 90;
  const length = phraseLoopSeconds(twoBars, tempo, 3);
  assert.equal(length, 6 * (60 / tempo));
  const downs = loopDownbeats(
    twoBars.map((note) => note.beat),
    tempo,
    0,
    length,
    4,
    6,
  );
  assert.equal(downs[0], 0);
  for (let pass = 0; pass < downs.length - 1; pass++) {
    const gap = (downs[pass + 1] ?? NaN) - (downs[pass] ?? NaN);
    assert.ok(Math.abs(gap - length) < 1e-10, `3/4 pass ${pass} gap ${gap}`);
  }
  const scale = SCALES.find((entry) => entry.id === 'major');
  assert.ok(scale);
  for (const bars of [2, 4] as const) {
    const phrase = generatePhrase({
      seed: 4,
      bars,
      scaleNotes: spell('C', scale.formula),
      chordNotes: parseChord('C').notes,
    });
    assert.equal(phrase.ok, true);
    if (!phrase.ok) return;
    assert.equal(phraseLoopBeats(phrase.phrase.notes), bars * 4);
    assert.equal(phraseLoopBeats(phrase.phrase.notes, 4), bars * 4);
  }
});

function pitchHz(fret: number): number {
  const midi = voicingMidi(melodyFrets({ string: 0, fret }))[0] ?? 0;
  return 440 * 2 ** ((midi - 69) / 12);
}

void test('turning loop off mid-pass lands on the closing note and schedules no new pass', async () => {
  const tempo = 120;
  const swing: SwingInput = 0;
  const sample = new OfflineAudioContext(1, RATE, RATE).createGain();
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
  try {
    for (const bars of [2, 4] as const) {
      ramps.length = 0;
      const endBeat = bars * 4;
      const landingFret = 8;
      const notes: FingeredNote[] = [
        { ...finger, string: 0, fret: 0, beat: 0, duration: 1 },
        { ...finger, string: 0, fret: 3, beat: endBeat - 1, duration: 1 },
        {
          ...finger,
          string: 0,
          fret: landingFret,
          beat: endBeat,
          duration: 2,
        },
      ];
      assert.equal(phraseLoopBeats(notes), endBeat);
      const loopSec = phraseLoopSeconds(notes, tempo);
      const hold = onsetSeconds(phrasePeriodBeats(bars), tempo, swing);
      assert.equal(hold, (endBeat + 2) * (60 / tempo));
      assert.ok(hold > loopSec);
      const context = new OfflineAudioContext(1, RATE * 20, RATE);
      context.resume = () => Promise.resolve();
      const destination = context.createGain();
      const clock = new AudioClock();
      const starts: {
        when: number;
        frequency: number;
        oscillator: OscillatorNode;
      }[] = [];
      const dropped = new Set<OscillatorNode>();
      const create = context.createOscillator.bind(context);
      context.createOscillator = () => {
        const oscillator = create();
        const start = oscillator.start.bind(oscillator);
        const disconnect = oscillator.disconnect.bind(oscillator);
        oscillator.start = (when = 0) => {
          starts.push({
            when,
            frequency: oscillator.frequency.value,
            oscillator,
          });
          return start(when);
        };
        oscillator.disconnect = () => {
          dropped.add(oscillator);
          return disconnect();
        };
        return oscillator;
      };
      const states: string[] = [];
      const player = new PhrasePlayer((state) => states.push(state));
      await player.start({
        notes,
        bars,
        tempo,
        swing,
        loop: true,
        context,
        destination,
        clock,
      });
      const lead = 0.05;
      const boundary = lead + loopSec;
      const holdEnd = lead + hold;
      const roll = (target: AudioClock, to: number) => {
        let steps = 0;
        while (target.currentTime + 1e-9 < to) {
          target.advance(Math.min(to, target.currentTime + PHRASE_TICK_SEC));
          assert.ok(++steps < 40000, 'the clock spun');
        }
      };
      roll(clock, lead + 60 / tempo);
      const queued = starts.filter(
        (item) => Math.abs(item.when - boundary) < 1e-9,
      );
      assert.equal(
        queued.length,
        1,
        `${bars} bars did not queue the next downbeat`,
      );
      assert.ok(Math.abs((queued[0]?.frequency ?? 0) - pitchHz(0)) < 1e-3);
      assert.equal(
        starts.some(
          (item) =>
            Math.abs(item.when - boundary) < 1e-9 &&
            Math.abs(item.frequency - pitchHz(landingFret)) < 1e-3,
        ),
        false,
      );
      player.finishPass();
      assert.equal(states.at(-1), 'playing');
      for (const item of queued) assert.ok(dropped.has(item.oscillator));
      roll(clock, holdEnd - 0.5);
      assert.equal(
        states.at(-1),
        'playing',
        `${bars} bars ended before the cadence hold`,
      );
      roll(clock, holdEnd + 1);
      assert.equal(states.at(-1), 'idle');
      const landing = starts.filter(
        (item) =>
          !dropped.has(item.oscillator) &&
          Math.abs(item.when - boundary) < 1e-9,
      );
      assert.equal(landing.length, 1);
      assert.ok(
        Math.abs((landing[0]?.frequency ?? 0) - pitchHz(landingFret)) < 1e-3,
      );
      const approach = starts.find(
        (item) => Math.abs(item.frequency - pitchHz(3)) < 1e-3,
      );
      assert.ok(approach, `${bars} bars dropped the note before the landing`);
      assert.equal(dropped.has(approach.oscillator), false);
      assert.equal(
        starts.filter((item) => item.when > boundary + 1e-6).length,
        0,
        `${bars} bars scheduled a note after the landing`,
      );
      assert.equal(
        starts.some(
          (item) => Math.abs(item.when - (lead + loopSec * 2)) < 1e-6,
        ),
        false,
      );
      const releaseAt = holdEnd + PHRASE_END_RELEASE_SEC;
      assert.ok(
        ramps.some(
          (ramp) => ramp.value === 0 && Math.abs(ramp.when - releaseAt) < 1e-9,
        ),
        `${bars} bars did not release at the loop-off end`,
      );

      ramps.length = 0;
      const plain = new OfflineAudioContext(1, RATE * 20, RATE);
      plain.resume = () => Promise.resolve();
      const plainClock = new AudioClock();
      const plainStarts: number[] = [];
      const plainCreate = plain.createOscillator.bind(plain);
      plain.createOscillator = () => {
        const oscillator = plainCreate();
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when = 0) => {
          plainStarts.push(when);
          return start(when);
        };
        return oscillator;
      };
      const plainPlayer = new PhrasePlayer(() => {});
      await plainPlayer.start({
        notes,
        bars,
        tempo,
        swing,
        loop: false,
        context: plain,
        destination: plain.createGain(),
        clock: plainClock,
      });
      roll(plainClock, holdEnd + 1);
      assert.ok(
        plainStarts.some((when) => Math.abs(when - boundary) < 1e-9),
        `${bars} bars loop-off missed the landing`,
      );
      assert.equal(
        plainStarts.some((when) => when > boundary + 1e-6),
        false,
      );
      assert.ok(
        ramps.some(
          (ramp) => ramp.value === 0 && Math.abs(ramp.when - releaseAt) < 1e-9,
        ),
        `${bars} bars loop-off released at a different time`,
      );
      plainPlayer.stop();
      player.stop();
    }
  } finally {
    proto.linearRampToValueAtTime = original;
  }
});

void test('every generated phrase has a note on beat 1', () => {
  // Beat 1 of the bar is onset 0. The loop seam uses that onset as the
  // landing, so a phrase that starts later would open a gap.
  const rhythms = [
    undefined,
    'quarters',
    'eighths',
    'long-short',
    'push',
  ] as const;
  const roots = ['C', 'F#', 'Bb', 'E'] as const;
  const scaleIds = ['major', 'dorian', 'mixolydian', 'minor'] as const;
  let count = 0;
  for (const rhythm of rhythms) {
    for (const root of roots) {
      for (const scaleId of scaleIds) {
        const scale = SCALES.find((item) => item.id === scaleId);
        assert.ok(scale);
        if (!scale) continue;
        const chord =
          scaleId === 'major'
            ? root
            : scaleId === 'mixolydian'
              ? `${root}7`
              : `${root}m`;
        for (const bars of [2, 4] as const) {
          for (let seed = 1; seed <= 8; seed += 1) {
            const result = generatePhrase({
              seed,
              bars,
              scaleNotes: spell(root, scale.formula),
              chordNotes: parseChord(chord).notes,
              locks: rhythm ? { rhythm } : undefined,
            });
            assert.equal(
              result.ok,
              true,
              `${root} ${scaleId} ${chord} ${rhythm ?? 'free'} ${bars} bars seed ${seed}`,
            );
            if (!result.ok) continue;
            const label = `${root} ${scaleId} ${rhythm ?? 'free'} ${bars} bars seed ${seed}`;
            assert.equal(
              result.phrase.notes.some((note) => note.beat === 0),
              true,
              `${label} misses beat 1`,
            );
            assert.equal(
              phraseLoopBeats(result.phrase.notes),
              bars * 4,
              `${label} loop is not ${bars * 4} beats`,
            );
            count += 1;
          }
        }
      }
    }
  }
  assert.equal(count, rhythms.length * roots.length * scaleIds.length * 2 * 8);
});

void test('stop and regenerate cancel every note still waiting on the clock', async () => {
  const context = new OfflineAudioContext(1, RATE * 8, RATE);
  context.resume = () => Promise.resolve();
  const destination = context.createGain();
  const starts: number[] = [];
  const oscillators: OscillatorNode[] = [];
  const dropped = new Set<OscillatorNode>();
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    oscillators.push(oscillator);
    const start = oscillator.start.bind(oscillator);
    const disconnect = oscillator.disconnect.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push(when);
      return start(when);
    };
    oscillator.disconnect = () => {
      dropped.add(oscillator);
      return disconnect();
    };
    return oscillator;
  };
  const near = (when: number, target: number) => Math.abs(when - target) < 1e-9;
  const player = new PhrasePlayer(() => {});
  const first = [slotNote(0, 1), slotNote(1, 2.5)];
  await player.start({
    notes: first,
    bars: 2,
    tempo: 96,
    swing: 'swing',
    loop: true,
    context,
    destination,
  });
  const length = phraseLoopSeconds(first, 96);
  const lead = 0.05;
  assert.ok(starts.some((when) => near(when, lead)));
  assert.ok(starts.some((when) => near(when, lead + length)));
  assert.equal(
    starts.filter((when) => near(when, lead + length * 2)).length,
    0,
  );
  const armed = oscillators.length;
  const armedStarts = starts.length;
  player.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(starts.length, armedStarts);
  assert.equal(player.pendingTimers(), 0);
  assert.equal(player.connectedNodes(), 0);
  for (const oscillator of oscillators) assert.ok(dropped.has(oscillator));

  const second = [slotNote(0, 0.5), slotNote(3, 0.5)];
  await player.start({
    notes: second,
    bars: 2,
    tempo: 120,
    swing: 0,
    loop: true,
    context,
    destination,
  });
  const regenAt = starts.length;
  assert.ok(regenAt > armedStarts);
  const kept = oscillators.slice(armed);
  await player.start({
    notes: [slotNote(0, 4), slotNote(4, 2)],
    bars: 2,
    tempo: 40,
    swing: 'straight',
    loop: true,
    context,
    destination,
  });
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.ok(starts.length > regenAt);
  for (const oscillator of kept) assert.ok(dropped.has(oscillator));
  const beforeStop = starts.length;
  player.stop();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(starts.length, beforeStop);
  assert.equal(player.pendingTimers(), 0);
  assert.equal(player.connectedNodes(), 0);

  const raceFrom = oscillators.length;
  await player.start({
    notes: first,
    bars: 2,
    tempo: 96,
    swing: 0,
    loop: true,
    context,
    destination,
  });
  const raceTo = oscillators.length;
  assert.ok(raceTo > raceFrom);
  const racedStarts = starts.length;
  player.stop();
  assert.equal(starts.length, racedStarts);
  await player.start({
    notes: second,
    bars: 2,
    tempo: 120,
    swing: 0,
    loop: true,
    context,
    destination,
  });
  assert.ok(starts.length > racedStarts);
  const faded = oscillators.slice(raceFrom, raceTo);
  for (const oscillator of faded) assert.equal(dropped.has(oscillator), false);
  const afterRace = starts.length;
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(starts.length, afterRace);
  for (const oscillator of faded) assert.ok(dropped.has(oscillator));
  for (const oscillator of oscillators.slice(raceTo)) {
    assert.equal(dropped.has(oscillator), false);
  }
  player.stop();
});

void test('play within 50 ms lets the stop fade finish on its own timer', async () => {
  const context = new OfflineAudioContext(1, RATE * 4, RATE);
  context.resume = () => Promise.resolve();
  const destination = context.createGain();
  const oscillators: OscillatorNode[] = [];
  const dropped = new Set<OscillatorNode>();
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    oscillators.push(oscillator);
    const disconnect = oscillator.disconnect.bind(oscillator);
    oscillator.disconnect = () => {
      dropped.add(oscillator);
      return disconnect();
    };
    return oscillator;
  };
  const player = new PhrasePlayer(() => {});
  const notes = [slotNote(0, 1), slotNote(4, 2)];
  await player.start({
    notes,
    bars: 2,
    tempo: 96,
    swing: 0,
    loop: true,
    context,
    destination,
  });
  const first = oscillators.slice();
  assert.ok(first.length > 0);
  const stopped = performance.now();
  player.stop();
  await player.start({
    notes: [slotNote(0, 2), slotNote(2, 2)],
    bars: 2,
    tempo: 120,
    swing: 0,
    loop: true,
    context,
    destination,
  });
  const elapsed = performance.now() - stopped;
  assert.ok(elapsed < 50, `play began ${elapsed.toFixed(1)} ms after stop`);
  for (const oscillator of first) assert.equal(dropped.has(oscillator), false);
  await new Promise((resolve) => setTimeout(resolve, 70));
  for (const oscillator of first) assert.ok(dropped.has(oscillator));
  for (const oscillator of oscillators.slice(first.length)) {
    assert.equal(dropped.has(oscillator), false);
  }
  assert.equal(player.connectedNodes() > 0, true);
  player.stop();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(player.pendingTimers(), 0);
  assert.equal(player.connectedNodes(), 0);
});

function queuedNote(fret: number, beat: number, duration = 1): FingeredNote {
  return { ...finger, string: 0, fret, beat, duration };
}

function spyPhrase(context: OfflineAudioContext) {
  const starts: {
    when: number;
    frequency: number;
    oscillator: OscillatorNode;
  }[] = [];
  const stops: { when: number; oscillator: OscillatorNode }[] = [];
  const dropped = new Set<OscillatorNode>();
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    const start = oscillator.start.bind(oscillator);
    const disconnect = oscillator.disconnect.bind(oscillator);
    oscillator.start = (when = 0) => {
      starts.push({
        when,
        frequency: oscillator.frequency.value,
        oscillator,
      });
      return start(when);
    };
    const stop = oscillator.stop.bind(oscillator);
    oscillator.stop = (when = 0) => {
      stops.push({ when, oscillator });
      return stop(when);
    };
    oscillator.disconnect = () => {
      dropped.add(oscillator);
      return disconnect();
    };
    return oscillator;
  };
  return { starts, stops, dropped };
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

function nearPitch(start: { frequency: number }, fret: number): boolean {
  return Math.abs(start.frequency - pitchHz(fret)) < 1e-3;
}

/** Odd on purpose, so an anchor pinned to PHRASE_TRIM fails. */
const SPY_GAIN = 0.137;

function reportCurrentGain(gain: AudioParam): void {
  const proto = Object.getPrototypeOf(gain) as AudioParam;
  const desc =
    Object.getOwnPropertyDescriptor(gain, 'value') ??
    Object.getOwnPropertyDescriptor(proto, 'value');
  Object.defineProperty(gain, 'value', {
    configurable: true,
    enumerable: true,
    get: () => SPY_GAIN,
    set(next: number) {
      desc?.set?.call(gain, next);
    },
  });
}

function spyGains(context: OfflineAudioContext) {
  const ramps: {
    node: GainNode;
    value: number;
    end: number;
    anchor: number;
    anchorValue: number;
  }[] = [];
  const cancels: { node: GainNode; time: number }[] = [];
  const disconnected = new Set<GainNode>();
  const anchors = new WeakMap<AudioParam, { time: number; value: number }>();
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const node = createGain();
    const gain = node.gain;
    reportCurrentGain(gain);
    const setValue = gain.setValueAtTime.bind(gain);
    const ramp = gain.linearRampToValueAtTime.bind(gain);
    const cancel = gain.cancelScheduledValues.bind(gain);
    const disconnect = node.disconnect.bind(node);
    gain.setValueAtTime = (value: number, time: number) => {
      anchors.set(gain, { time, value });
      return setValue(value, time);
    };
    gain.cancelScheduledValues = (time: number) => {
      cancels.push({ node, time });
      return cancel(time);
    };
    gain.linearRampToValueAtTime = (value: number, time: number) => {
      const anchor = anchors.get(gain);
      ramps.push({
        node,
        value,
        end: time,
        anchor: anchor?.time ?? Number.NaN,
        anchorValue: anchor?.value ?? Number.NaN,
      });
      return ramp(value, time);
    };
    node.disconnect = () => {
      disconnected.add(node);
      return disconnect();
    };
    return node;
  };
  return { ramps, cancels, disconnected };
}

void test('the next bar line keeps a start lead and skips a closer one', () => {
  const tempo = 120;
  const startedAt = PHRASE_START_LEAD_SEC;
  const bar = 4 * (60 / tempo);
  assert.equal(
    nextPhraseBarLine(startedAt, startedAt + 0.5, tempo),
    startedAt + bar,
  );
  assert.equal(
    nextPhraseBarLine(
      startedAt,
      startedAt + bar - PHRASE_START_LEAD_SEC,
      tempo,
    ),
    startedAt + bar,
  );
  assert.equal(
    nextPhraseBarLine(
      startedAt,
      startedAt + bar - PHRASE_START_LEAD_SEC + 0.01,
      tempo,
    ),
    startedAt + bar * 2,
  );
  assert.equal(
    nextPhraseBarLine(startedAt, startedAt + bar, tempo),
    startedAt + bar * 2,
  );
});

void test('a looping phrase switches to the latest request on the next bar line', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped, stops } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [
    queuedNote(0, 0),
    queuedNote(2, 2),
    queuedNote(4, 6),
    queuedNote(8, 8, 2),
  ];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const seam = lead + phraseLoopSeconds(playing, tempo);
  await rollClock(clock, lead + 60 / tempo);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  assert.ok(boundary < seam - 1, 'the switch waited for the loop seam');
  const kept = starts.find(
    (item) => nearPitch(item, 2) && Math.abs(item.when - (lead + 1)) < 1e-6,
  );
  assert.ok(kept, 'the note before the bar line was not scheduled');
  const later = starts.find(
    (item) => nearPitch(item, 4) && Math.abs(item.when - (lead + 3)) < 1e-6,
  );
  assert.ok(later, 'the note after the bar line was not scheduled');
  player.queuePhrase({
    notes: [queuedNote(7, 0), queuedNote(7, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(10, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary - 0.02);
  assert.equal(dropped.has(kept.oscillator), false);
  assert.equal(
    dropped.has(later.oscillator),
    true,
    'a note from the old phrase was left past the bar line',
  );
  assert.equal(
    starts.some(
      (item) =>
        (nearPitch(item, 10) || nearPitch(item, 7)) &&
        item.when < boundary - 1e-6,
    ),
    false,
    'a queued phrase restarted mid-bar',
  );
  await rollClock(clock, boundary + 0.05);
  const switched = starts.filter((item) => nearPitch(item, 10));
  assert.equal(switched.length >= 1, true);
  assert.ok(
    switched.some((item) => Math.abs(item.when - boundary) < 1e-6),
    'the new phrase did not start on the bar line',
  );
  assert.equal(
    starts.some((item) => nearPitch(item, 7)),
    false,
    'an earlier queued phrase still sounded',
  );
  for (const item of starts) {
    if (item.when < boundary - 1e-4) continue;
    if (nearPitch(item, 10) || nearPitch(item, 12)) continue;
    assert.equal(
      dropped.has(item.oscillator),
      true,
      `an old note stayed at ${item.when}s`,
    );
  }
  assert.ok(
    stops.some(
      (item) =>
        item.oscillator === kept.oscillator &&
        Math.abs(item.when - (boundary + PHRASE_END_RELEASE_SEC)) < 1e-3,
    ),
    'the note already sounding was cut instead of faded',
  );
  const after = starts.filter((item) => item.when > seam + 1e-6);
  assert.equal(
    after.some((item) => !nearPitch(item, 10) && !dropped.has(item.oscillator)),
    false,
    'the old phrase continued past the seam',
  );
  player.stop();
});

void test('a key or scale change while looping lands on the next downbeat', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [
    queuedNote(0, 0),
    queuedNote(2, 3),
    queuedNote(4, 6),
    queuedNote(1, 8, 2),
  ];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  await rollClock(clock, lead + 0.75);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  const seam = lead + phraseLoopSeconds(playing, tempo);
  assert.ok(seam - boundary > 1);
  player.queuePhrase({
    notes: [queuedNote(9, 0), queuedNote(11, 2), queuedNote(9, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary + 0.05);
  const arrived = starts.filter((item) => nearPitch(item, 9));
  assert.ok(
    arrived.some((item) => Math.abs(item.when - boundary) < 1e-6),
    'the new key did not start on the bar line',
  );
  assert.equal(
    arrived.some((item) => item.when < boundary - 1e-6),
    false,
    'the new key started before the bar line',
  );
  const carried = starts.find(
    (item) => nearPitch(item, 4) && item.when > boundary - 1e-4,
  );
  assert.ok(carried, 'the old phrase had no note past the bar line');
  assert.equal(dropped.has(carried.oscillator), true);
  player.stop();
});

void test('a 4-bar loop switches on the next bar, not at the seam', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 24, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [
    queuedNote(0, 0),
    queuedNote(2, 6),
    queuedNote(3, 10),
    queuedNote(4, 14),
    queuedNote(1, 16, 2),
  ];
  await player.start({
    notes: playing,
    bars: 4,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const seam = lead + phraseLoopSeconds(playing, tempo);
  assert.equal(seam, lead + 8);
  await rollClock(clock, lead + 0.4);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  assert.equal(boundary, lead + 2);
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(10, 16, 2)],
    bars: 4,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary + 0.05);
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 10) && Math.abs(item.when - boundary) < 1e-6,
    ),
    'the 4-bar phrase did not switch on the next bar',
  );
  assert.equal(
    starts.some((item) => nearPitch(item, 10) && item.when < boundary - 1e-6),
    false,
  );
  player.stop();
});

void test('a change inside the start lead waits for the following bar', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [
    queuedNote(0, 0),
    queuedNote(3, 4),
    queuedNote(5, 6),
    queuedNote(8, 8, 2),
  ];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const imminent = lead + 2;
  await rollClock(clock, imminent - 0.04);
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(10, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  assert.equal(boundary, imminent + 2);
  await rollClock(clock, imminent + 0.05);
  const downbeat = starts.find(
    (item) => nearPitch(item, 3) && Math.abs(item.when - imminent) < 1e-6,
  );
  assert.ok(downbeat, 'the skipped bar did not play its downbeat');
  assert.equal(dropped.has(downbeat.oscillator), false);
  assert.equal(
    starts.some((item) => nearPitch(item, 10)),
    false,
    'the new phrase landed on the bar that was already too close',
  );
  await rollClock(clock, boundary + 0.05);
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 10) && Math.abs(item.when - boundary) < 1e-6,
    ),
    'the new phrase did not take the following bar',
  );
  player.stop();
});

void test('a change exactly one start lead before a bar still takes that bar', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 16, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [
    queuedNote(0, 0),
    queuedNote(6, 4),
    queuedNote(4, 6),
    queuedNote(8, 8, 2),
  ];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const imminent = lead + 2;
  await rollClock(clock, imminent - PHRASE_START_LEAD_SEC);
  player.queuePhrase({
    notes: [queuedNote(11, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, imminent + 0.05);
  const struck = starts.filter((item) => Math.abs(item.when - imminent) < 1e-6);
  assert.equal(struck.length, 2);
  const oldDownbeat = struck.find((item) => nearPitch(item, 6));
  const arrived = struck.find((item) => nearPitch(item, 11));
  assert.ok(oldDownbeat, 'the old downbeat was not scheduled');
  assert.ok(arrived, 'a bar one start lead ahead was skipped');
  assert.equal(
    dropped.has(oldDownbeat.oscillator),
    true,
    'the old downbeat struck with the new phrase',
  );
  assert.equal(dropped.has(arrived.oscillator), false);
  player.stop();
});

void test('a later request before the lead replaces the phrase armed for that bar', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 16, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(4, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  await rollClock(clock, lead + 0.4);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  player.queuePhrase({
    notes: [queuedNote(5, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary - 0.08);
  player.queuePhrase({
    notes: [queuedNote(11, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary + 0.05);
  const stale = starts.filter((item) => nearPitch(item, 5));
  assert.ok(stale.length >= 1, 'the armed phrase was not scheduled');
  for (const item of stale) {
    assert.equal(
      dropped.has(item.oscillator),
      true,
      'a replaced phrase struck on the bar it never got to keep',
    );
  }
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 11) && Math.abs(item.when - boundary) < 1e-6,
    ),
    'the latest phrase missed the bar already armed',
  );
  player.stop();
});

void test('a request inside the lead leaves the armed downbeat and takes the next bar', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(4, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  await rollClock(clock, lead + 0.4);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  player.queuePhrase({
    notes: [queuedNote(5, 0), queuedNote(5, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary - 0.03);
  player.queuePhrase({
    notes: [queuedNote(11, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary + 0.05);
  const armed = starts.find(
    (item) => nearPitch(item, 5) && Math.abs(item.when - boundary) < 1e-6,
  );
  assert.ok(armed, 'the armed downbeat did not play');
  assert.equal(dropped.has(armed.oscillator), false);
  assert.equal(
    starts.some((item) => nearPitch(item, 11) && item.when < boundary + 1),
    false,
    'a late request took the bar that was already inside the lead',
  );
  const following = boundary + 4 * (60 / tempo);
  await rollClock(clock, following + 0.05);
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 11) && Math.abs(item.when - following) < 1e-6,
    ),
    'the late request did not take the following bar',
  );
  player.stop();
});

void test('the bar line stays on the sounding grid and the new phrase uses its own tempo and swing', async () => {
  const soundingTempo = 120;
  const incomingTempo = 90;
  const incomingSwing = 0.5;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [
    queuedNote(0, 0),
    queuedNote(2, 0.5),
    queuedNote(4, 6),
    queuedNote(1, 8, 2),
  ];
  await player.start({
    notes: playing,
    bars: 2,
    tempo: soundingTempo,
    swing: 1,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = PHRASE_START_LEAD_SEC;
  const straightOffbeat = lead + 0.25;
  const swungOffbeat = lead + onsetSeconds(0.5, soundingTempo, 1);
  assert.ok(swungOffbeat > straightOffbeat + 0.01);
  await rollClock(clock, lead + 0.2);
  const offbeat = starts.find(
    (item) => nearPitch(item, 2) && Math.abs(item.when - swungOffbeat) < 1e-6,
  );
  assert.ok(offbeat, 'the sounding offbeat left the straight grid');
  const boundary = nextPhraseBarLine(lead, clock.currentTime, soundingTempo);
  assert.equal(boundary, lead + 2);
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(12, 0.5), queuedNote(10, 8, 2)],
    bars: 2,
    tempo: incomingTempo,
    swing: incomingSwing,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary + 1);
  const downbeat = starts.find(
    (item) => nearPitch(item, 10) && Math.abs(item.when - boundary) < 1e-6,
  );
  assert.ok(downbeat, 'beat 1 did not land on the sounding bar line');
  const swung = boundary + onsetSeconds(0.5, incomingTempo, incomingSwing);
  assert.ok(
    Math.abs(swung - (boundary + 0.25)) > 0.01,
    'the incoming swing was straight',
  );
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 12) && Math.abs(item.when - swung) < 1e-6,
    ),
    'the incoming phrase did not swing from its own downbeat',
  );
  player.stop();
});

void test('a finishing pass plays the closing note before the latest queued phrase', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  const playing = [queuedNote(0, 0), queuedNote(3, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  const holdEnd = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await rollClock(clock, lead + 60 / tempo);
  player.finishPass();
  player.queuePhrase({
    notes: [queuedNote(5, 0), queuedNote(5, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  player.queuePhrase({
    notes: [queuedNote(11, 0), queuedNote(11, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, holdEnd - 0.05);
  const landing = starts.filter(
    (item) => nearPitch(item, 8) && Math.abs(item.when - boundary) < 1e-6,
  );
  assert.equal(landing.length, 1);
  assert.equal(dropped.has(landing[0]?.oscillator), false);
  assert.equal(
    starts.some(
      (item) =>
        (nearPitch(item, 11) || nearPitch(item, 5)) &&
        item.when < holdEnd - 1e-6,
    ),
    false,
    'the next phrase started before the closing note finished',
  );
  assert.equal(states.at(-1), 'playing');
  await rollClock(clock, holdEnd + 0.05);
  const next = starts.filter((item) => nearPitch(item, 11));
  assert.ok(
    next.some((item) => Math.abs(item.when - holdEnd) < 1e-6),
    'the queued phrase did not start when the closing note finished',
  );
  assert.equal(
    starts.some((item) => nearPitch(item, 5)),
    false,
  );
  player.stop();
});

void test('stop during a queued phrase starts nothing afterwards', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts } = spyPhrase(context);
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  const playing = [queuedNote(0, 0), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  await rollClock(clock, lead + 60 / tempo);
  player.queuePhrase({
    notes: [queuedNote(9, 0), queuedNote(9, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    starts.some((item) => nearPitch(item, 9)),
    false,
    'stop was still waiting, but the new phrase had already started',
  );
  player.stop();
  assert.equal(states.at(-1), 'idle');
  await rollClock(clock, boundary + 2);
  assert.equal(
    starts.some((item) => nearPitch(item, 9)),
    false,
  );
  assert.equal(states.at(-1), 'idle');
  player.stop();
});

void test('a phrase change starts immediately when no pass boundary is waiting', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(1, 4), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 60 / tempo);
  const at = clock.currentTime;
  player.queuePhrase({
    notes: [queuedNote(6, 0), queuedNote(6, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await Promise.resolve();
  await Promise.resolve();
  const next = starts.filter((item) => nearPitch(item, 6));
  assert.ok(next.length >= 1, 'the phrase did not start');
  const first = next[0];
  assert.ok(first);
  assert.ok(
    Math.abs(first.when - (at + lead)) < 1e-6,
    `started at ${first.when}s instead of the request`,
  );
  const holdEnd = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  assert.ok(first.when < holdEnd - 1);
  player.stop();
});

void test('a phrase switch fades the outgoing notes across the release', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const ramps: {
    value: number;
    end: number;
    anchor: number;
    anchorValue: number;
  }[] = [];
  const cancels: { time: number }[] = [];
  const anchors = new WeakMap<AudioParam, { time: number; value: number }>();
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const node = createGain();
    const gain = node.gain;
    reportCurrentGain(gain);
    const setValue = gain.setValueAtTime.bind(gain);
    const ramp = gain.linearRampToValueAtTime.bind(gain);
    const cancel = gain.cancelScheduledValues.bind(gain);
    gain.setValueAtTime = (value: number, time: number) => {
      anchors.set(gain, { time, value });
      return setValue(value, time);
    };
    gain.cancelScheduledValues = (time: number) => {
      cancels.push({ time });
      return cancel(time);
    };
    gain.linearRampToValueAtTime = (value: number, time: number) => {
      const anchor = anchors.get(gain);
      ramps.push({
        value,
        end: time,
        anchor: anchor?.time ?? Number.NaN,
        anchorValue: anchor?.value ?? Number.NaN,
      });
      return ramp(value, time);
    };
    return node;
  };
  const { starts, stops } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(4, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 0.5);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  assert.ok(
    boundary < lead + phraseLoopSeconds(playing, tempo) - 1,
    'the fade waited for the loop seam',
  );
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(10, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary - PHRASE_LOOKAHEAD_SEC + 0.03);
  const release = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.end - item.anchor - PHRASE_END_RELEASE_SEC) < 0.02 &&
      Math.abs(item.anchor - boundary) < 1e-4,
  );
  assert.ok(release, 'the outgoing phrase did not fade across the release');
  // The spy reports the gain's current value as 0.137. The anchor is that read.
  assert.equal(
    release.anchorValue,
    SPY_GAIN,
    `the fade anchored at ${release.anchorValue}, not the current gain`,
  );
  assert.ok(
    cancels.some((item) => Math.abs(item.time - release.anchor) < 1e-4),
    'the fade did not cancel from the anchor',
  );
  assert.ok(
    stops.some((item) => item.when >= release.end - 1e-4),
    'the outgoing oscillator stopped before the fade ended',
  );
  assert.equal(
    stops.some(
      (item) =>
        item.when < release.end - 1e-3 &&
        Math.abs(item.when - release.anchor) < 1e-3,
    ),
    false,
    'the outgoing oscillator stopped before the fade ended',
  );
  const next = starts.filter((item) => nearPitch(item, 10));
  assert.ok(
    next.some((item) => Math.abs(item.when - boundary) < 1e-6),
    'the new phrase did not start as the fade began',
  );

  player.stop();
  await player.start({
    notes: [queuedNote(1, 0), queuedNote(1, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, clock.currentTime + 0.4);
  const at = clock.currentTime;
  player.queuePhrase({
    notes: [queuedNote(6, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await Promise.resolve();
  await Promise.resolve();
  const immediate = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.end - item.anchor - PHRASE_END_RELEASE_SEC) < 0.02 &&
      Math.abs(item.anchor - (at + lead)) < 1e-4,
  );
  assert.ok(immediate, 'an immediate switch did not fade the outgoing phrase');
  // The spy reports the gain's current value as 0.137. The anchor is that read.
  assert.equal(
    immediate.anchorValue,
    SPY_GAIN,
    `an immediate switch anchored at ${immediate.anchorValue}, not the current gain`,
  );
  const arrived = starts.filter((item) => nearPitch(item, 6));
  assert.ok(
    arrived.some((item) => Math.abs(item.when - (at + lead)) < 1e-6),
    'an immediate switch did not start the new phrase on time',
  );
  player.stop();
});

void test('an immediate switch drops notes that have not started', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  // The old phrase starts at 0.05. The switch is taken at 0.25, so the
  // new downbeat is 0.30 and the release runs until 0.60. Beat 0.45
  // sounds at 0.275, in the 50 ms before that downbeat. Beat 0.8 sounds
  // at 0.45, inside the 0.3 s release.
  const playing = [
    queuedNote(0, 0),
    queuedNote(3, 0.45),
    queuedNote(5, 0.8),
    queuedNote(2, 2),
    queuedNote(8, 8, 2),
  ];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 0.2);
  const now = clock.currentTime;
  await player.start({
    notes: [queuedNote(10, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  const downbeat = now + lead;
  const inside = starts.find((item) => nearPitch(item, 5));
  assert.ok(inside, 'the note inside the release was not scheduled');
  assert.ok(
    inside.when >= downbeat - 1e-4 &&
      inside.when < downbeat + PHRASE_END_RELEASE_SEC - 1e-3,
    `the release note is at ${inside.when}s, outside the 0.3 s fade`,
  );
  assert.equal(
    dropped.has(inside.oscillator),
    true,
    'a note inside the release played',
  );
  const gap = starts.find((item) => nearPitch(item, 3));
  assert.ok(gap, 'the note in the lead was not scheduled');
  assert.ok(
    gap.when > now + 1e-4 && gap.when < downbeat - 1e-4,
    `the lead note is at ${gap.when}s, not inside the 50 ms gap`,
  );
  assert.equal(
    dropped.has(gap.oscillator),
    true,
    'a note in the 50 ms before the downbeat played at full level',
  );
  const sounding = starts.filter(
    (item) => !nearPitch(item, 10) && item.when <= now + 1e-4,
  );
  assert.ok(
    sounding.some((item) => nearPitch(item, 0)),
    'the outgoing phrase had no sounding note',
  );
  for (const item of sounding) {
    assert.equal(
      dropped.has(item.oscillator),
      false,
      'a note that had already started was cut instead of faded',
    );
  }
  player.stop();
});

void test('play during the release tail anchors the fade at the current time', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(4, 4), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const releaseAt = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await rollClock(clock, releaseAt + 0.12);
  const now = clock.currentTime;
  await player.start({
    notes: [queuedNote(6, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  const fade = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.anchor - now) < 1e-4 &&
      Math.abs(item.end - now - PHRASE_END_RELEASE_SEC) < 0.02,
  );
  assert.ok(fade, 'play during the tail did not fade from the current time');
  // The spy reports the gain's current value as 0.137. The anchor is that read.
  assert.equal(
    fade.anchorValue,
    SPY_GAIN,
    `the tail fade anchored at ${fade.anchorValue}, not the current gain`,
  );
  assert.ok(
    Math.abs(fade.anchor - (now + lead)) > 1e-3,
    'the tail fade anchored a lead time late',
  );
  player.stop();
});

void test('a queued phrase fades the closing note across the release', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 30, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const { starts, stops } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(3, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  const holdEnd = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await rollClock(clock, lead + 0.5);
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(12, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  player.finishPass();
  await rollClock(clock, holdEnd + 0.05);
  await Promise.resolve();
  await Promise.resolve();
  // The spy reports the gain's current value as 0.137. The anchor is that read.
  const fade = ramps.find(
    (item) =>
      item.value === 0 &&
      item.anchorValue === SPY_GAIN &&
      Math.abs(item.anchor - holdEnd) < 1e-4 &&
      Math.abs(item.end - holdEnd - PHRASE_END_RELEASE_SEC) < 0.02,
  );
  assert.ok(fade, 'the closing note did not fade across the release');
  const closing = starts.find(
    (item) => nearPitch(item, 8) && Math.abs(item.when - boundary) < 1e-6,
  );
  assert.ok(closing, 'the closing note did not play');
  assert.ok(
    stops.some(
      (item) =>
        item.oscillator === closing.oscillator &&
        item.when >= holdEnd + PHRASE_END_RELEASE_SEC - 1e-4,
    ),
    'the closing note stopped before its fade ended',
  );
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 10) && Math.abs(item.when - holdEnd) < 1e-6,
    ),
    'the next phrase did not start as the closing note began to fade',
  );
  player.stop();
});

void test('stop during a switch fade releases the outgoing phrase over 20 ms', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps, cancels, disconnected } = spyGains(context);
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: [queuedNote(0, 0), queuedNote(3, 2), queuedNote(5, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 0.3);
  const at = clock.currentTime;
  player.queuePhrase({
    notes: [queuedNote(10, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await Promise.resolve();
  await Promise.resolve();
  // The spy reports the gain's current value as 0.137. The anchor is that read.
  const outgoing = ramps.find(
    (item) =>
      item.value === 0 &&
      item.anchorValue === SPY_GAIN &&
      Math.abs(item.anchor - (at + lead)) < 1e-4 &&
      Math.abs(item.end - item.anchor - PHRASE_END_RELEASE_SEC) < 1e-3,
  );
  assert.ok(outgoing, 'the switch did not fade the outgoing phrase');
  assert.equal(disconnected.has(outgoing.node), false);
  const sounding = starts.find(
    (item) => nearPitch(item, 0) && !dropped.has(item.oscillator),
  );
  assert.ok(sounding, 'the outgoing note was already gone');
  player.stop();
  const cut = ramps.find(
    (item) =>
      item.node === outgoing.node &&
      item.value === 0 &&
      Math.abs(item.end - item.anchor - 0.02) < 1e-3,
  );
  assert.ok(cut, 'stop disconnected a phrase that was still fading');
  // The spy reports the gain's current value as 0.137. The anchor is that read.
  assert.equal(
    cut.anchorValue,
    SPY_GAIN,
    `the stop fade anchored at ${cut.anchorValue}, not the current gain`,
  );
  assert.ok(
    cancels.some(
      (item) =>
        item.node === outgoing.node && Math.abs(item.time - cut.anchor) < 1e-4,
    ),
    'stop left the release ramp scheduled',
  );
  assert.equal(
    disconnected.has(outgoing.node),
    false,
    'stop cut the outgoing phrase with no fade',
  );
  assert.equal(
    dropped.has(sounding.oscillator),
    false,
    'stop cut a note that was still fading',
  );
  await new Promise((resolve) => setTimeout(resolve, 90));
  assert.equal(disconnected.has(outgoing.node), true);
  assert.equal(dropped.has(sounding.oscillator), true);
});

void test('turning Loop off after a queued phrase plays that phrase once', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 30, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(3, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  const holdEnd = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await rollClock(clock, lead + 0.5);
  player.queuePhrase({
    notes: [queuedNote(10, 0), queuedNote(12, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  player.finishPass();
  await rollClock(clock, holdEnd - 0.05);
  const through = starts.filter(
    (item) => nearPitch(item, 3) && Math.abs(item.when - (lead + 3)) < 1e-6,
  );
  assert.equal(through.length, 1);
  assert.equal(
    dropped.has(through[0]?.oscillator),
    false,
    'turning Loop off dropped the note that follows the next bar line',
  );
  const landing = starts.filter(
    (item) => nearPitch(item, 8) && Math.abs(item.when - boundary) < 1e-6,
  );
  assert.equal(landing.length, 1);
  assert.equal(dropped.has(landing[0]?.oscillator), false);
  assert.equal(
    starts.some(
      (item) =>
        (nearPitch(item, 10) || nearPitch(item, 12)) &&
        item.when < holdEnd - 1e-6,
    ),
    false,
    'the queued phrase started before the closing note finished',
  );
  await rollClock(clock, holdEnd + 8);
  const opening = starts.filter((item) => nearPitch(item, 10));
  assert.equal(
    opening.length,
    1,
    'the queued phrase kept looping after Loop was turned off',
  );
  assert.ok(
    opening.some((item) => Math.abs(item.when - holdEnd) < 1e-6),
    'the queued phrase did not start when the finishing pass ended',
  );
  const closing = starts.filter((item) => nearPitch(item, 12));
  assert.equal(closing.length, 1);
  assert.ok(
    closing.some(
      (item) =>
        Math.abs(item.when - (holdEnd + onsetSeconds(8, tempo, 0))) < 1e-6,
    ),
    'the queued phrase did not play its closing note',
  );
  assert.equal(player.isLooping, false);
  player.stop();
});

void test('a request during the queued resume replaces the phrase already in flight', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 30, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(3, 2), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  await rollClock(clock, lead + 0.5);
  player.queuePhrase({
    notes: [queuedNote(5, 0), queuedNote(5, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  let release = () => {};
  context.resume = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  await rollClock(clock, boundary - PHRASE_LOOKAHEAD_SEC + 0.03);
  player.queuePhrase({
    notes: [queuedNote(11, 0), queuedNote(11, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  release();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  context.resume = () => Promise.resolve();
  await rollClock(clock, boundary + 4 * phraseLoopSeconds(playing, tempo));
  assert.equal(
    starts.some((item) => nearPitch(item, 5)),
    false,
    'a stale phrase played after a newer request',
  );
  const latest = starts.filter((item) => nearPitch(item, 11));
  assert.ok(
    latest.some((item) => Math.abs(item.when - boundary) < 1e-6),
    'the latest phrase did not start on the seam',
  );
  player.finishPass();
  await rollClock(clock, clock.currentTime + 6);
  assert.equal(
    starts.some((item) => nearPitch(item, 5)),
    false,
    'a stale phrase started after Loop was turned off',
  );
  player.stop();
});

void test('stop before the bar line starts nothing afterwards', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts } = spyPhrase(context);
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  const playing = [queuedNote(0, 0), queuedNote(4, 6), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 60 / tempo);
  const boundary = nextPhraseBarLine(lead, clock.currentTime, tempo);
  player.queuePhrase({
    notes: [queuedNote(9, 0), queuedNote(9, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.destination,
    clock,
  });
  await rollClock(clock, boundary - PHRASE_LOOKAHEAD_SEC - 0.05);
  assert.equal(
    starts.some((item) => nearPitch(item, 9)),
    false,
    'the queued phrase started before the bar line',
  );
  player.stop();
  assert.equal(states.at(-1), 'idle');
  await rollClock(clock, boundary + 2);
  assert.equal(
    starts.some((item) => nearPitch(item, 9)),
    false,
    'stop left a queued phrase that started on the bar line',
  );
  assert.equal(states.at(-1), 'idle');
  player.stop();
});

void test('stop within 50 ms fades from the trim, not the default gain', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 8, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const ramps: {
    anchor: number;
    anchorValue: number;
    end: number;
    value: number;
  }[] = [];
  const anchors = new WeakMap<AudioParam, { time: number; value: number }>();
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const node = createGain();
    const gain = node.gain;
    reportCurrentGain(gain);
    const setValue = gain.setValueAtTime.bind(gain);
    const ramp = gain.linearRampToValueAtTime.bind(gain);
    gain.setValueAtTime = (value: number, time: number) => {
      anchors.set(gain, { time, value });
      return setValue(value, time);
    };
    gain.linearRampToValueAtTime = (value: number, time: number) => {
      const anchor = anchors.get(gain);
      ramps.push({
        value,
        end: time,
        anchor: anchor?.time ?? Number.NaN,
        anchorValue: anchor?.value ?? Number.NaN,
      });
      return ramp(value, time);
    };
    return node;
  };
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: [queuedNote(0, 0), queuedNote(0, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  player.stop();
  const cut = ramps.find(
    (item) =>
      item.value === 0 && Math.abs(item.end - item.anchor - 0.02) < 1e-3,
  );
  assert.ok(cut, 'stop did not fade the phrase');
  assert.equal(
    cut.anchorValue,
    SPY_GAIN,
    `stop faded from ${cut.anchorValue}, not the current gain`,
  );
});

void test('a failed start disconnects the phrase it replaced', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 8, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { starts, dropped } = spyPhrase(context);
  const states: string[] = [];
  const player = new PhrasePlayer((state) => states.push(state));
  await player.start({
    notes: [queuedNote(0, 0), queuedNote(2, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const sounding = starts.filter((item) => nearPitch(item, 0));
  assert.ok(sounding.length >= 1, 'the phrase did not start');
  context.resume = () => Promise.reject(new Error('resume failed'));
  await player.start({
    notes: [queuedNote(7, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  assert.equal(states.at(-1), 'error');
  for (const item of sounding) {
    assert.equal(
      dropped.has(item.oscillator),
      true,
      'the replaced phrase was left connected',
    );
  }
  player.stop();
});

void test('a second start during resume fades the phrase already sounding', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 12, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const ramps: {
    anchor: number;
    anchorValue: number;
    end: number;
    value: number;
  }[] = [];
  const anchors = new WeakMap<AudioParam, { time: number; value: number }>();
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const node = createGain();
    const gain = node.gain;
    reportCurrentGain(gain);
    const setValue = gain.setValueAtTime.bind(gain);
    const ramp = gain.linearRampToValueAtTime.bind(gain);
    gain.setValueAtTime = (value: number, time: number) => {
      anchors.set(gain, { time, value });
      return setValue(value, time);
    };
    gain.linearRampToValueAtTime = (value: number, time: number) => {
      const anchor = anchors.get(gain);
      ramps.push({
        value,
        end: time,
        anchor: anchor?.time ?? Number.NaN,
        anchorValue: anchor?.value ?? Number.NaN,
      });
      return ramp(value, time);
    };
    return node;
  };
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: [queuedNote(0, 0), queuedNote(1, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 0.2);
  const now = clock.currentTime;
  // A loop looks ahead a whole pass, so later copies of this pitch are
  // scheduled and then dropped. Only a note that has started by now stays.
  const sounding = starts.filter(
    (item) => nearPitch(item, 0) && item.when <= now + 1e-4,
  );
  assert.ok(sounding.length >= 1);
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.resume = () => gate;
  const first = player.start({
    notes: [queuedNote(4, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await Promise.resolve();
  const second = player.start({
    notes: [queuedNote(9, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  release();
  await first;
  await second;
  const fade = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.end - item.anchor - PHRASE_END_RELEASE_SEC) < 1e-3,
  );
  assert.ok(fade, 'the second start cut the sounding phrase');
  for (const item of sounding) {
    assert.equal(
      dropped.has(item.oscillator),
      false,
      'the second start disconnected the sounding phrase',
    );
  }
  assert.equal(
    starts.some((item) => nearPitch(item, 4)),
    false,
    'the start that lost resume still played',
  );
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 9) && Math.abs(item.when - (now + lead)) < 1e-6,
    ),
    'the takeover treated a sounding phrase as a seam',
  );
  player.stop();
});

void test('a second start during the release tail does not bump the fade', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(4, 4), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const releaseAt = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await rollClock(clock, releaseAt + 0.12);
  const now = clock.currentTime;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.resume = () => gate;
  const first = player.start({
    notes: [queuedNote(4, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  const second = player.start({
    notes: [queuedNote(9, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  release();
  await first;
  await second;
  const fade = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.anchor - now) < 1e-4 &&
      Math.abs(item.end - now - PHRASE_END_RELEASE_SEC) < 0.02,
  );
  assert.ok(fade, 'a second start during the tail bumped the fade');
  assert.equal(
    fade.anchorValue,
    SPY_GAIN,
    `the tail takeover anchored at ${fade.anchorValue}, not the current gain`,
  );
  assert.ok(
    Math.abs(fade.anchor - (now + lead)) > 1e-3,
    'the tail takeover anchored a lead time late',
  );
  player.stop();
});

void test('a second start during a seam resume keeps that downbeat', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 20, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(3, 2), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  await rollClock(clock, lead + 0.5);
  player.queuePhrase({
    notes: [queuedNote(5, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.resume = () => gate;
  await rollClock(clock, boundary - PHRASE_LOOKAHEAD_SEC + 0.03);
  const now = clock.currentTime;
  const sounding = starts.filter(
    (item) => nearPitch(item, 0) && item.when <= now + 1e-4,
  );
  assert.ok(
    sounding.length >= 1,
    'the phrase waiting for the seam had not started',
  );
  const takeover = player.start({
    notes: [queuedNote(11, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  release();
  await takeover;
  const fade = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.anchor - boundary) < 1e-4 &&
      Math.abs(item.end - boundary - PHRASE_END_RELEASE_SEC) < 0.02,
  );
  assert.ok(fade, 'the takeover did not fade from the seam');
  for (const item of sounding) {
    assert.equal(
      dropped.has(item.oscillator),
      false,
      'the takeover cut the phrase that was waiting for the seam',
    );
  }
  assert.equal(
    starts.some((item) => nearPitch(item, 5)),
    false,
    'the start that lost the seam still played',
  );
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 11) && Math.abs(item.when - boundary) < 1e-6,
    ),
    'the takeover did not start on the seam',
  );
  player.stop();
});

void test('stop during resume fades the parked phrase over 20 ms', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 8, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const { starts, dropped } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: [queuedNote(0, 0), queuedNote(2, 4)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  await rollClock(clock, lead + 0.2);
  const sounding = starts.filter(
    (item) => nearPitch(item, 0) && item.when <= clock.currentTime + 1e-4,
  );
  assert.ok(sounding.length >= 1, 'the phrase had not started');
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.resume = () => gate;
  const pending = player.start({
    notes: [queuedNote(7, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  await Promise.resolve();
  player.stop();
  const cut = ramps.find(
    (item) =>
      item.value === 0 && Math.abs(item.end - item.anchor - 0.02) < 1e-3,
  );
  assert.ok(cut, 'stop during resume did not fade the parked phrase');
  assert.equal(
    cut.anchorValue,
    SPY_GAIN,
    `stop during resume faded from ${cut.anchorValue}, not the current gain`,
  );
  for (const item of sounding) {
    assert.equal(
      dropped.has(item.oscillator),
      false,
      'stop during resume cut the phrase with no fade',
    );
  }
  release();
  await pending;
  for (const item of sounding) {
    assert.equal(
      dropped.has(item.oscillator),
      false,
      'the start that lost resume cut the phrase stop was fading',
    );
  }
  await new Promise((resolve) => setTimeout(resolve, 80));
  for (const item of sounding) {
    assert.equal(dropped.has(item.oscillator), true);
  }
});

void test('a finished switch does not leave the old phrase parked', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 16, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const { starts } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: [queuedNote(0, 0), queuedNote(1, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  await player.start({
    notes: [queuedNote(2, 0), queuedNote(3, 8, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  const lead = 0.05;
  const end = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  await rollClock(clock, end + PHRASE_END_RELEASE_SEC + 1);
  let waited = 0;
  while (
    (player.pendingTimers() > 0 || player.connectedNodes() > 0) &&
    waited < 2000
  ) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    waited += 20;
  }
  assert.equal(
    player.connectedNodes(),
    0,
    'the finished phrase was still connected',
  );
  const now = clock.currentTime;
  await player.start({
    notes: [queuedNote(12, 0)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  const heard = starts.filter((item) => nearPitch(item, 12));
  assert.ok(heard.length >= 1, 'the next phrase did not play');
  assert.ok(
    heard.some((item) => Math.abs(item.when - (now + lead)) < 1e-6),
    'the next phrase did not start on time',
  );
  assert.equal(
    ramps.some(
      (item) =>
        item.value === 0 &&
        Math.abs(item.anchor - (now + lead)) < 1e-4 &&
        Math.abs(item.end - item.anchor - PHRASE_END_RELEASE_SEC) < 0.02,
    ),
    false,
    'a finished switch left the old phrase parked',
  );
  player.stop();
});

void test('a late seam resume starts at now, not the old downbeat', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 30, RATE);
  context.resume = () => Promise.resolve();
  const clock = new AudioClock();
  const { ramps } = spyGains(context);
  const { starts } = spyPhrase(context);
  const player = new PhrasePlayer(() => {});
  const playing = [queuedNote(0, 0), queuedNote(3, 2), queuedNote(8, 8, 2)];
  await player.start({
    notes: playing,
    bars: 2,
    tempo,
    swing: 0,
    loop: true,
    context,
    destination: context.createGain(),
    clock,
  });
  const lead = 0.05;
  const boundary = lead + phraseLoopSeconds(playing, tempo);
  await rollClock(clock, lead + 0.5);
  player.queuePhrase({
    notes: [queuedNote(11, 0), queuedNote(11, 0.2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  context.resume = () => gate;
  await rollClock(clock, boundary - PHRASE_LOOKAHEAD_SEC + 0.03);
  await rollClock(clock, boundary + 0.5);
  const now = clock.currentTime;
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const later = now + onsetSeconds(0.2, tempo, 0);
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 11) && Math.abs(item.when - later) < 1e-4,
    ),
    'the late seam kept the old downbeat',
  );
  assert.ok(
    starts.some(
      (item) => nearPitch(item, 11) && Math.abs(item.when - now) < 1e-4,
    ),
    'the late seam did not start at now',
  );
  assert.equal(
    starts.some((item) => nearPitch(item, 11) && item.when < now - 1e-4),
    false,
    'the late seam scheduled a note in the past',
  );
  const fade = ramps.find(
    (item) =>
      item.value === 0 &&
      Math.abs(item.anchor - now) < 1e-4 &&
      Math.abs(item.end - now - PHRASE_END_RELEASE_SEC) < 0.02,
  );
  assert.ok(fade, 'the late seam faded from the old downbeat');
  player.stop();
});
