import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OfflineAudioContext } from 'node-web-audio-api';
import { parseChord } from '../lib/harmony.ts';
import { SCALES, spell } from '../lib/music.ts';
import { PHRASE_TRIM, schedulePhrase } from '../lib/phrase-audio.ts';
import { generatePhrase, onsetSeconds } from '../lib/phrase.ts';

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

async function renderNote(beat: number, feel: 'straight' | 'swing') {
  const seconds = 1;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(
    context,
    context.destination,
    [{ string: 0, fret: 0, beat }],
    120,
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
});
