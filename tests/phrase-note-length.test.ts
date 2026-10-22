import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import {
  PHRASE_END_RELEASE_SEC,
  PHRASE_LOOKAHEAD_SEC,
  PHRASE_NOTE_RELEASE_SEC,
  PHRASE_START_LEAD_SEC,
  PHRASE_TRIM,
  PhrasePlayer,
  schedulePhrase,
  type PhraseClock,
} from '../lib/phrase-audio.ts';
import {
  onsetSeconds,
  phrasePeriodBeats,
  type FingeredNote,
} from '../lib/phrase.ts';

const RATE = 44100;
/** scheduleVoicing's bus for one string, times the phrase trim. */
const ENVELOPE_SCALE = 0.75 * PHRASE_TRIM;

function peak(data: Float32Array, from: number, to: number): number {
  const start = Math.max(0, Math.floor(from * RATE));
  const end = Math.min(data.length, Math.floor(to * RATE));
  let level = 0;
  for (let index = start; index < end; index += 1) {
    level = Math.max(level, Math.abs(data[index] ?? 0));
  }
  return level;
}

function maxJump(data: Float32Array, from: number, to: number): number {
  const start = Math.max(0, Math.floor(from * RATE));
  const end = Math.min(data.length - 1, Math.floor(to * RATE));
  let jump = 0;
  for (let index = start; index < end; index += 1) {
    jump = Math.max(
      jump,
      Math.abs((data[index + 1] ?? 0) - (data[index] ?? 0)),
    );
  }
  return jump;
}

/**
 * The gain envelope, with the oscillator and filter out of the way.
 * A constant into the envelope makes the render the envelope times the
 * fixed bus and trim.
 */
async function renderEnvelope(
  beat: number,
  duration: number | undefined,
  tempo: number,
  swing: 'straight' | 'swing' | number,
  seconds: number,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  const { voices } = schedulePhrase(
    context,
    context.destination,
    [{ string: 0, fret: 0, beat, duration }],
    tempo,
    swing,
    0,
  );
  const part = voices[0]?.voices[0];
  assert.ok(part, 'the note did not build a voice');
  part.oscillator.disconnect();
  part.filter.disconnect();
  const constant = context.createConstantSource();
  constant.offset.value = 1;
  constant.connect(part.envelope);
  constant.start(0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

function envelopeAt(data: Float32Array, time: number): number {
  const index = Math.min(data.length - 1, Math.max(0, Math.floor(time * RATE)));
  return (data[index] ?? 0) / ENVELOPE_SCALE;
}

/** First time the envelope stays below the floor. -1 when it never does. */
function silenceAt(data: Float32Array, from: number, floor = 1e-3): number {
  const hold = Math.ceil(0.008 * RATE);
  const start = Math.floor(from * RATE);
  for (let index = start; index < data.length - hold; index += 1) {
    let quiet = true;
    for (let step = 0; step < hold; step += 1) {
      if (Math.abs(data[index + step] ?? 0) / ENVELOPE_SCALE >= floor) {
        quiet = false;
        break;
      }
    }
    if (quiet) return index / RATE;
  }
  return -1;
}

async function renderPhrase(
  notes: readonly {
    string: number;
    fret: number;
    beat: number;
    duration?: number;
  }[],
  tempo: number,
  seconds: number,
  swing: 'straight' | 'swing' | number = 0,
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(context, context.destination, notes, tempo, swing, 0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

void test('a note goes quiet at its written length plus the release, and a rest stays silent', async () => {
  assert.ok(
    PHRASE_NOTE_RELEASE_SEC >= 0.02 && PHRASE_NOTE_RELEASE_SEC <= 0.05,
    `release ${PHRASE_NOTE_RELEASE_SEC}s is not a few tens of milliseconds`,
  );
  const tempo = 120;
  const quarter = 60 / tempo;
  const durationBeats = 0.5;
  const written = durationBeats * quarter;
  const release = PHRASE_NOTE_RELEASE_SEC;
  const expectedSilence = written + release;

  const damped = await renderEnvelope(0, durationBeats, tempo, 0, 3);
  const open = await renderEnvelope(0, undefined, tempo, 0, 3);
  const reached = silenceAt(damped, written * 0.5);
  assert.ok(
    Math.abs(reached - expectedSilence) < 0.005,
    `envelope settled at ${reached}s, not ${expectedSilence}s`,
  );
  assert.ok(
    Math.abs(reached - (written + 2.5)) > 1,
    `envelope followed the 2.5 s pluck and settled at ${reached}s`,
  );
  assert.ok(
    envelopeAt(damped, written * 0.5) > 0.2,
    'the note was already quiet halfway through its written length',
  );
  assert.ok(envelopeAt(damped, expectedSilence) < 1e-3);
  assert.ok(envelopeAt(damped, expectedSilence + 0.05) < 1e-4);
  assert.ok(
    envelopeAt(damped, 1) < 1e-4,
    'the note was still up a second in, well before 2.5 s',
  );
  assert.ok(
    envelopeAt(open, 1) > 0.02,
    'the undamped pluck was already silent at 1 s, so the contrast is gone',
  );

  const tone = await renderPhrase(
    [{ string: 0, fret: 0, beat: 0, duration: durationBeats }],
    tempo,
    1,
  );
  const toneOpen = await renderPhrase(
    [{ string: 0, fret: 0, beat: 0 }],
    tempo,
    1,
  );
  let drift = 0;
  const compareUntil = Math.floor((written - 0.004) * RATE);
  for (let index = 0; index < compareUntil; index += 1) {
    drift = Math.max(
      drift,
      Math.abs((tone[index] ?? 0) - (toneOpen[index] ?? 0)),
    );
  }
  assert.ok(
    drift < 1e-4,
    `the pluck changed before the release (max sample delta ${drift})`,
  );
  const releaseJump = maxJump(tone, written, written + release);
  const bodyJump = maxJump(tone, written - release, written);
  assert.ok(
    releaseJump < 0.05 && releaseJump < bodyJump * 3 + 0.002,
    `the release clicked (jump ${releaseJump}, body ${bodyJump})`,
  );

  // A rest is a written length that ends before the next onset.
  const restBeat = 2;
  const heldBeats = 1.5;
  const notes = [
    { string: 0, fret: 0, beat: 0, duration: durationBeats },
    { string: 0, fret: 7, beat: restBeat, duration: heldBeats },
  ];
  const phrase = await renderPhrase(notes, tempo, 3);
  const next = onsetSeconds(restBeat, tempo, 0);
  const heldSilence = next + heldBeats * quarter + release;
  assert.ok(
    peak(phrase, 0.02, written - 0.01) > 0.02,
    'the first note was silent',
  );
  assert.ok(
    peak(phrase, expectedSilence + 0.02, next - 0.02) < 1e-4,
    `the rest between ${expectedSilence}s and ${next}s still had sound`,
  );
  assert.ok(
    peak(phrase, next + 0.02, heldSilence - 0.05) > 0.02,
    'the held note was silent',
  );
  assert.ok(
    peak(phrase, heldSilence + 0.02, 2.4) < 1e-4,
    'the held note kept ringing toward 2.5 s',
  );
  const ringing = await renderPhrase(
    notes.map((note) => ({
      string: note.string,
      fret: note.fret,
      beat: note.beat,
    })),
    tempo,
    3,
  );
  assert.ok(
    peak(ringing, expectedSilence + 0.02, next - 0.02) > 0.01,
    'without a written length the same gap was already silent',
  );

  // The tail of the pluck, past the 0.65 s body, still matches until the release.
  const heldWritten = 0.9;
  const heldTone = await renderPhrase(
    [{ string: 0, fret: 3, beat: 0, duration: heldWritten / quarter }],
    tempo,
    1.2,
  );
  const heldOpen = await renderPhrase(
    [{ string: 0, fret: 3, beat: 0 }],
    tempo,
    1.2,
  );
  let heldDrift = 0;
  const heldUntil = Math.floor((heldWritten - 0.004) * RATE);
  for (let index = 0; index < heldUntil; index += 1) {
    heldDrift = Math.max(
      heldDrift,
      Math.abs((heldTone[index] ?? 0) - (heldOpen[index] ?? 0)),
    );
  }
  assert.ok(
    heldDrift < 1e-4,
    `a held pluck changed before its release (${heldDrift})`,
  );
  const heldEnvelope = await renderEnvelope(
    0,
    heldWritten / quarter,
    tempo,
    0,
    2,
  );
  const heldReached = silenceAt(heldEnvelope, 0.2);
  assert.ok(Math.abs(heldReached - (heldWritten + release)) < 0.005);

  // Legacy swing length is the swung span, not a straight quarter-fraction.
  const swingBeat = 0.5;
  const swingDuration = 0.5;
  const swingStart = onsetSeconds(swingBeat, tempo, 'swing');
  const swingEnd = onsetSeconds(swingBeat + swingDuration, tempo, 'swing');
  const swingSilence = swingEnd + release;
  const swung = await renderEnvelope(
    swingBeat,
    swingDuration,
    tempo,
    'swing',
    1.5,
  );
  const swungReached = silenceAt(swung, swingStart);
  assert.ok(
    Math.abs(swungReached - swingSilence) < 0.005,
    `swung note settled at ${swungReached}s, not ${swingSilence}s`,
  );
  assert.ok(Math.abs(swingStart - swingBeat * quarter) > 0.05);
  assert.ok(
    Math.abs(swingEnd - swingStart - swingDuration * quarter) > 0.05,
    'legacy swing left the offbeat at the straight length',
  );
});

class ManualClock implements PhraseClock {
  currentTime = 0;
  private nextId = 1;
  private timers = new Map<number, { at: number; fn: () => void }>();

  now(): number {
    return this.currentTime;
  }

  after(delaySec: number, fn: () => void): number {
    const id = this.nextId;
    this.nextId += 1;
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

function played(fret: number, beat: number, duration: number): FingeredNote {
  return {
    name: 'E',
    pc: 4,
    degree: '1',
    midi: 40 + fret,
    beat,
    duration,
    strong: beat % 1 === 0,
    chordTone: true,
    string: 0,
    fret,
    finger: 0,
    position: 0,
    shift: false,
  };
}

void test('a short note leaves the graph after its release and the phrase still runs out', async () => {
  const tempo = 120;
  const context = new OfflineAudioContext(1, RATE * 12, RATE);
  context.resume = () => Promise.resolve();
  const clock = new ManualClock();
  const dropped = new Set<OscillatorNode>();
  const order: OscillatorNode[] = [];
  const create = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = create();
    order.push(oscillator);
    const disconnect = oscillator.disconnect.bind(oscillator);
    oscillator.disconnect = () => {
      dropped.add(oscillator);
      return disconnect();
    };
    return oscillator;
  };
  const states: string[] = [];
  const player = new PhrasePlayer((state) => {
    states.push(state);
  });
  await player.start({
    notes: [played(0, 0, 0.5), played(5, 4, 2)],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.createGain(),
    clock,
  });
  const first = order[0];
  const lead = PHRASE_START_LEAD_SEC;
  assert.ok(first, 'the short note was not scheduled');
  assert.equal(dropped.has(first), false);
  assert.equal(states.at(-1), 'playing');

  const later = lead + onsetSeconds(4, tempo, 0);
  clock.advance(later - PHRASE_LOOKAHEAD_SEC + 0.02);
  const second = order[1];
  assert.ok(second, 'the later note was not scheduled');
  assert.equal(
    dropped.has(first),
    true,
    'the short note was still connected when the next one started',
  );
  assert.equal(dropped.has(second), false);
  const periodEnd = lead + onsetSeconds(phrasePeriodBeats(2), tempo, 0);
  clock.advance(periodEnd - 0.25);
  assert.equal(
    states.at(-1),
    'playing',
    'the phrase ended with the short note',
  );
  clock.advance(periodEnd + PHRASE_END_RELEASE_SEC + 0.05);
  assert.equal(states.at(-1), 'idle');
  player.stop();
});

void test('a swung eighth pair meets at the offbeat and the offbeat is silent by the next downbeat', async () => {
  const tempo = 100;
  const swing = 1;
  const release = PHRASE_NOTE_RELEASE_SEC;
  const quarter = 60 / tempo;
  const offbeat = onsetSeconds(0.5, tempo, swing);
  const nextDownbeat = onsetSeconds(1, tempo, swing);
  const straightEighth = 0.5 * quarter;
  assert.ok(
    Math.abs(nextDownbeat - quarter) < 1e-9,
    'swing moved the downbeat',
  );
  assert.ok(offbeat - straightEighth > 0.05);

  const downbeat = await renderEnvelope(0, 0.5, tempo, swing, 1);
  const downbeatSilence = silenceAt(downbeat, 0.05);
  const gap = offbeat - downbeatSilence;
  assert.ok(
    Math.abs(downbeatSilence - (offbeat + release)) < 0.005,
    `downbeat eighth settled at ${downbeatSilence}s, gap to the offbeat ${gap}s`,
  );
  assert.ok(
    gap < 0,
    `the downbeat eighth went silent ${gap}s before the offbeat`,
  );
  assert.ok(
    peak(downbeat, offbeat - 0.02, offbeat - 0.004) > 0.02,
    'a silent gap opened before the offbeat',
  );

  const late = await renderEnvelope(0.5, 0.5, tempo, swing, 1);
  const lateSilence = silenceAt(late, offbeat);
  const overlap = lateSilence - nextDownbeat;
  assert.ok(
    Math.abs(lateSilence - (nextDownbeat + release)) < 0.005,
    `offbeat settled at ${lateSilence}s, ${overlap}s past the next downbeat`,
  );
  assert.ok(envelopeAt(late, nextDownbeat + release) < 1e-3);
  assert.ok(
    peak(late, nextDownbeat + release + 0.008, nextDownbeat + 0.12) < 1e-4,
    'the offbeat was still sounding after the next downbeat plus the release',
  );
  assert.ok(
    peak(late, nextDownbeat - 0.02, nextDownbeat - 0.004) > 0.02,
    'the offbeat died before the next downbeat',
  );

  const straight = await renderEnvelope(0, 0.5, tempo, 0, 1);
  const straightSilence = silenceAt(straight, 0.05);
  assert.ok(
    Math.abs(straightSilence - (straightEighth + release)) < 0.005,
    `straight eighth settled at ${straightSilence}s, not ${straightEighth + release}s`,
  );
});

void test('a rest after a short note stays silent, straight and swung', async () => {
  const tempo = 100;
  const release = PHRASE_NOTE_RELEASE_SEC;
  const cases = [
    { beat: 0, next: 0.5, swing: 0 as const },
    { beat: 0, next: 0.5, swing: 1 as const },
    { beat: 0.5, next: 1, swing: 0 as const },
    { beat: 0.5, next: 1, swing: 1 as const },
  ];
  for (const item of cases) {
    const duration = 0.25;
    const start = onsetSeconds(item.beat, tempo, item.swing);
    const writtenEnd = onsetSeconds(item.beat + duration, tempo, item.swing);
    const next = onsetSeconds(item.next, tempo, item.swing);
    const silence = writtenEnd + release;
    assert.ok(
      silence < next - 0.02,
      `swing ${item.swing} beat ${item.beat} left no rest before ${next}s`,
    );
    const phrase = await renderPhrase(
      [
        { string: 0, fret: 0, beat: item.beat, duration },
        { string: 0, fret: 7, beat: item.next, duration: 0.5 },
      ],
      tempo,
      1.2,
      item.swing,
    );
    assert.ok(
      peak(phrase, start + 0.008, Math.min(writtenEnd - 0.004, start + 0.05)) >
        0.02,
      `swing ${item.swing} beat ${item.beat} did not sound`,
    );
    assert.ok(
      peak(phrase, silence + 0.008, next - 0.008) < 1e-4,
      `swing ${item.swing} beat ${item.beat} rang through the rest`,
    );
    assert.ok(
      peak(phrase, next + 0.02, next + 0.08) > 0.02,
      `swing ${item.swing} beat ${item.beat} dropped the note after the rest`,
    );
  }
});

void test('a 2-beat note shortens just under 2.5 s and keeps the full pluck at 2.5 s', async () => {
  const underTempo = 48.01;
  const atTempo = 48;
  const underSeconds = 2 * (60 / underTempo);
  const atSeconds = 2 * (60 / atTempo);
  assert.ok(underSeconds < 2.5 && underSeconds > 2.49);
  assert.equal(atSeconds, 2.5);

  const underStops: number[] = [];
  const underContext = new OfflineAudioContext(1, RATE * 3, RATE);
  const underCreate = underContext.createOscillator.bind(underContext);
  underContext.createOscillator = () => {
    const oscillator = underCreate();
    const stop = oscillator.stop.bind(oscillator);
    oscillator.stop = (when = 0) => {
      underStops.push(when);
      return stop(when);
    };
    return oscillator;
  };
  schedulePhrase(
    underContext,
    underContext.destination,
    [{ string: 0, fret: 0, beat: 0, duration: 2 }],
    underTempo,
    0,
    0,
  );
  const under = (await underContext.startRendering()).getChannelData(0).slice();

  const atStops: number[] = [];
  const atContext = new OfflineAudioContext(1, RATE * 3, RATE);
  const atCreate = atContext.createOscillator.bind(atContext);
  atContext.createOscillator = () => {
    const oscillator = atCreate();
    const stop = oscillator.stop.bind(oscillator);
    oscillator.stop = (when = 0) => {
      atStops.push(when);
      return stop(when);
    };
    return oscillator;
  };
  schedulePhrase(
    atContext,
    atContext.destination,
    [{ string: 0, fret: 0, beat: 0, duration: 2 }],
    atTempo,
    0,
    0,
  );
  const at = (await atContext.startRendering()).getChannelData(0).slice();
  const openContext = new OfflineAudioContext(1, RATE * 3, RATE);
  schedulePhrase(
    openContext,
    openContext.destination,
    [{ string: 0, fret: 0, beat: 0 }],
    atTempo,
    0,
    0,
  );
  const open = (await openContext.startRendering()).getChannelData(0).slice();

  assert.ok(peak(under, 0.05, 0.4) > 0.02, 'the 48.01 BPM note was silent');
  assert.ok(peak(at, 0.05, 0.4) > 0.02, 'the 48 BPM note was silent');
  const releaseAt = underSeconds + PHRASE_NOTE_RELEASE_SEC;
  assert.ok(
    underStops.some((when) => Math.abs(when - (releaseAt + 0.01)) < 1e-6),
    `48.01 BPM did not release at ${releaseAt}s (stops ${underStops.join(', ')})`,
  );
  assert.ok(
    atStops.every((when) => Math.abs(when - 2.525) < 1e-6),
    `48 BPM shortened a 2.5 s note (stops ${atStops.join(', ')})`,
  );
  let drift = 0;
  const compareUntil = Math.min(at.length, open.length, Math.floor(2.4 * RATE));
  for (let index = 0; index < compareUntil; index += 1) {
    drift = Math.max(drift, Math.abs((at[index] ?? 0) - (open[index] ?? 0)));
  }
  assert.ok(
    drift < 1e-4,
    `the 2.5 s note left the full pluck (delta ${drift})`,
  );
});

void test('playback through PhrasePlayer damps on the live path and disconnects without a click', async () => {
  const tempo = 120;
  const quarter = 60 / tempo;
  const duration = 0.5;
  const release = PHRASE_NOTE_RELEASE_SEC;
  const lead = PHRASE_START_LEAD_SEC;
  const written = duration * quarter;
  const silence = lead + written + release;
  // The next cue is pumped a lookahead early. 0.312 is inside the release
  // (the note is still connected). 0.405 is the later cue, after the
  // release and the cleanup margin, which is when the note leaves.
  const duringRelease = silence - release + 0.01;
  const disconnectAt = silence + 0.075;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * 0.7), RATE);
  const resume = context.resume.bind(context);
  context.resume = () => Promise.resolve();
  const clock = new ManualClock();
  const gains: GainNode[] = [];
  const oscillators: OscillatorNode[] = [];
  const createGain = context.createGain.bind(context);
  context.createGain = () => {
    const gain = createGain();
    gains.push(gain);
    return gain;
  };
  const createOscillator = context.createOscillator.bind(context);
  context.createOscillator = () => {
    const oscillator = createOscillator();
    oscillators.push(oscillator);
    return oscillator;
  };
  const player = new PhrasePlayer(() => {});
  await player.start({
    notes: [
      played(0, 0, duration),
      played(3, 0.82, duration),
      played(5, 1, duration),
    ],
    bars: 2,
    tempo,
    swing: 0,
    loop: false,
    context,
    destination: context.destination,
    clock,
  });
  context.resume = resume;
  const envelope = gains[2];
  assert.ok(envelope, 'the live path did not build the note envelope');
  let droppedAt: number | null = null;
  const disconnect = envelope.disconnect.bind(envelope);
  envelope.disconnect = () => {
    droppedAt = context.currentTime;
    return disconnect();
  };
  const voice = oscillators[0];
  assert.ok(voice, 'the live path did not build the note');
  voice.disconnect();
  const constant = context.createConstantSource();
  constant.offset.value = 1;
  constant.connect(envelope);
  constant.start(0);

  const firstCut = context.suspend(duringRelease + 0.002);
  const secondCut = context.suspend(disconnectAt);
  const rendering = context.startRendering();
  await firstCut;
  clock.advance(context.currentTime);
  const droppedDuringRelease = droppedAt;
  await context.resume();
  await secondCut;
  clock.advance(context.currentTime);
  const droppedAfter = droppedAt;
  await context.resume();
  const rendered = (await rendering).getChannelData(0).slice();
  player.stop();

  assert.equal(
    droppedDuringRelease,
    null,
    `the note disconnected at ${droppedDuringRelease}s, during the release`,
  );
  assert.ok(
    droppedAfter != null && droppedAfter >= silence + 0.04,
    `disconnect at ${droppedAfter}s cut the release that ends at ${silence}s`,
  );
  assert.ok(
    peak(rendered, lead + 0.02, lead + written - 0.01) > 0.02,
    'the live path did not sound the note',
  );
  assert.ok(
    peak(rendered, silence + 0.008, disconnectAt - 0.02) < 1e-4,
    'the live path was still sounding after the written length plus the release',
  );
  const releaseJump = maxJump(
    rendered,
    duringRelease - 0.004,
    duringRelease + 0.008,
  );
  const disconnectJump = maxJump(
    rendered,
    disconnectAt - 0.006,
    disconnectAt + 0.006,
  );
  assert.ok(releaseJump < 0.005, `the release was cut (jump ${releaseJump})`);
  assert.ok(
    disconnectJump < 0.005,
    `disconnect clicked (jump ${disconnectJump})`,
  );
});
