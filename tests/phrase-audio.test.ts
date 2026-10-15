import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import {
  PHRASE_END_RELEASE_SEC,
  PHRASE_LOOKAHEAD_SEC,
  PHRASE_TEMPO_MAX,
  PHRASE_TEMPO_MIN,
  PHRASE_TICK_SEC,
  PHRASE_TRIM,
  LookaheadScheduler,
  PhrasePlayer,
  bindPhraseLifecycle,
  clampPhraseTempo,
  schedulePhrase,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import {
  beatAtSeconds,
  generatePhrase,
  onsetSeconds,
  type FingeredNote,
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

async function renderNote(
  beat: number,
  feel: 'straight' | 'swing',
  tempo = 120,
) {
  const seconds = 1;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(
    context,
    context.destination,
    [{ string: 0, fret: 0, beat }],
    tempo,
    feel,
    0,
  );
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

void test('phrase playback trims the existing voice and swings the offbeat', async () => {
  assert.equal(PHRASE_TRIM, 0.2);
  const straight = await renderNote(0.5, 'straight');
  const swing = await renderNote(0.5, 'swing');
  const straightAt = firstAudible(straight, 0.01);
  const swingAt = firstAudible(swing, 0.01);
  assert.ok(Math.abs(straightAt - onsetSeconds(0.5, 120, 'straight')) < 0.03);
  assert.ok(Math.abs(swingAt - onsetSeconds(0.5, 120, 'swing')) < 0.03);
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

void test('scheduled onsets match 60 and 120 BPM, straight and swung', () => {
  const beats = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4];
  const measured: {
    tempo: number;
    feel: 'straight' | 'swing';
    quarterSec: number;
    bpm: number;
    maxJitterSec: number;
  }[] = [];
  for (const tempo of [60, 120] as const) {
    for (const feel of ['straight', 'swing'] as const) {
      const clock = new FakeClock();
      let spins = 0;
      const realAfter = clock.after.bind(clock);
      clock.after = (delay, fn) => {
        if (delay <= 1e-9) spins += 1;
        return realAfter(delay, fn);
      };
      const cues: { index: number; intended: number; scheduled: number }[] = [];
      new LookaheadScheduler(
        clock,
        beats,
        tempo,
        feel,
        0,
        30,
        false,
        (cue) => cues.push(cue),
        () => {},
      ).start();
      const end = onsetSeconds(4, tempo, feel) + PHRASE_TICK_SEC;
      let steps = 0;
      while (clock.now() < end) {
        clock.advance(clock.now() + PHRASE_TICK_SEC);
        assert.ok(++steps < 2000, 'the lookahead tick spun');
      }
      assert.equal(spins, 0);
      assert.equal(cues.length, beats.length);
      const quarter = 60 / tempo;
      let gapSum = 0;
      let gaps = 0;
      for (const cue of cues) {
        const beat = beats[cue.index] ?? -1;
        const expected = onsetSeconds(beat, tempo, feel);
        assert.ok(Math.abs(cue.intended - expected) < 1e-9);
        assert.ok(
          Math.abs(cue.scheduled - cue.intended) < 1e-9,
          `${feel} ${tempo} beat ${beat} moved to ${cue.scheduled}`,
        );
        if (Number.isInteger(beat) && beat > 0 && beat <= 4) {
          const previous = cues.find((item) => beats[item.index] === beat - 1);
          assert.ok(previous);
          const gap = cue.scheduled - previous.scheduled;
          assert.ok(Math.abs(gap - quarter) < 1e-9, `gap ${gap}`);
          gapSum += gap;
          gaps += 1;
        }
        if (feel === 'swing' && Math.abs((beat % 1) - 0.5) < 1e-9) {
          const swung = (Math.floor(beat) + 2 / 3) * quarter;
          assert.ok(Math.abs(cue.scheduled - swung) < 1e-9);
        }
      }
      const bpm = 60 / (gapSum / gaps);
      measured.push({
        tempo,
        feel,
        quarterSec: quarter,
        bpm,
        maxJitterSec: 0,
      });
      assert.ok(Math.abs(bpm - tempo) < 1e-6);
    }
  }
  console.log(JSON.stringify({ lookaheadSec: PHRASE_LOOKAHEAD_SEC, measured }));
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
  assert.doesNotMatch(panel, /min=\{40\}/);
  assert.doesNotMatch(panel, /max=\{200\}/);
});

void test('tempo clamps to about 20–300 and playback uses that clamp', async () => {
  assert.equal(clampPhraseTempo(5), PHRASE_TEMPO_MIN);
  assert.equal(clampPhraseTempo(20), 20);
  assert.equal(clampPhraseTempo(300), 300);
  assert.equal(clampPhraseTempo(900), PHRASE_TEMPO_MAX);
  assert.equal(clampPhraseTempo(Number.NaN), 96);
  assert.equal(PHRASE_END_RELEASE_SEC, 0.3);
  const slow = await renderNote(1, 'straight', 300);
  const fast = await renderNote(1, 'straight', 5000);
  assert.ok(
    Math.abs(firstAudible(slow, 0.01) - firstAudible(fast, 0.01)) < 0.02,
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
    [0, 2],
  );
  assert.equal(cues[1]?.scheduled, 2);
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
    feel: 'straight',
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
    feel: 'straight',
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
