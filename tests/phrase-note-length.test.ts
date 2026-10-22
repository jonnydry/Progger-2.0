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
): Promise<Float32Array> {
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(context, context.destination, notes, tempo, 0, 0);
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

  // Swing moves the offbeat. The written length stays a straight quarter-fraction.
  const swingBeat = 0.5;
  const swingDuration = 0.5;
  const swingStart = onsetSeconds(swingBeat, tempo, 'swing');
  const swingSilence = swingStart + swingDuration * quarter + release;
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
