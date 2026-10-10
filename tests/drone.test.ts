import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { SCALES } from '../lib/music.ts';
import {
  CELLO_SAMPLES,
  DRONE_MODES,
  DRONE_ROOTS,
  colourNote,
  droneLabel,
  dronePitches,
  lowRootMidi,
  midiHz,
  pitchWeight,
  sampleForMidi,
  scaleWalk,
  scientificPitch,
  seamlessLoop,
  symmetricDetuneCents,
  trimEdgeSilence,
} from '../lib/drone.ts';

const CANONICAL: Record<(typeof DRONE_MODES)[number]['id'], string> = {
  ionian: 'major',
  dorian: 'dorian',
  phrygian: 'phrygian',
  lydian: 'lydian',
  mixolydian: 'mixolydian',
  aeolian: 'minor',
  locrian: 'locrian',
};

void test('the twelve drone roots are one of each pitch class', () => {
  assert.equal(DRONE_ROOTS.length, 12);
  assert.deepEqual(
    DRONE_ROOTS.map((root) => lowRootMidi(root) - 36),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

void test('mode formulas stay locked to the app scales, with Ionian and Aeolian names', () => {
  for (const mode of DRONE_MODES) {
    const scale = SCALES.find((item) => item.id === CANONICAL[mode.id]);
    assert.ok(scale);
    assert.deepEqual([...mode.formula], [...scale.formula]);
  }
  assert.equal(DRONE_MODES.find((mode) => mode.id === 'ionian')?.colourDegree, null);
  assert.equal(DRONE_MODES.find((mode) => mode.id === 'aeolian')?.colourLabel, 'flat 6');
});

void test('low drones sit in octave 2 around E2 and A2', () => {
  assert.equal(lowRootMidi('C'), 36);
  assert.equal(lowRootMidi('E'), 40);
  assert.equal(lowRootMidi('A'), 45);
  assert.equal(lowRootMidi('B'), 47);
  assert.equal(scientificPitch('E', 40), 'E2');
  assert.equal(scientificPitch('A', 45), 'A2');
  assert.equal(midiHz(69), 440);
});

void test('the drone is root and fifth, except Locrian which has no perfect fifth', () => {
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      const low = dronePitches(root, mode.id, 'low');
      assert.equal(low.length, 2);
      assert.equal(low[0].role, 'root');
      assert.equal(low[0].midi, lowRootMidi(root));
      if (mode.id === 'locrian') {
        assert.equal(low[1].role, 'octave');
        assert.equal(low[1].degree, '8');
        assert.equal(low[1].midi, low[0].midi + 12);
        assert.equal(low[1].name, low[0].name);
      } else {
        assert.equal(low[1].role, 'fifth');
        assert.equal(low[1].degree, '5');
        assert.equal(low[1].midi, low[0].midi + 7);
      }
      const layered = dronePitches(root, mode.id, 'layered');
      assert.equal(layered.length, 4);
      assert.deepEqual(
        layered.slice(2).map((pitch) => pitch.midi),
        low.map((pitch) => pitch.midi + 12),
      );
      assert.ok(layered.slice(2).every((pitch) => pitch.layer === 'upper'));
    }
  }
  assert.equal(droneLabel(dronePitches('A', 'dorian', 'low')), 'A2 + E3');
  assert.equal(
    droneLabel(dronePitches('A', 'dorian', 'layered')),
    'A2 + E3, with A3 + E4',
  );
  assert.equal(droneLabel(dronePitches('A', 'locrian', 'low')), 'A2 + A3');
  assert.equal(droneLabel(dronePitches('E', 'ionian', 'low')), 'E2 + B2');
  assert.equal(droneLabel(dronePitches('Gb', 'ionian', 'low')), 'G♭2 + D♭3');
});

void test('colour notes keep theoretical spelling', () => {
  assert.equal(colourNote('A', 'ionian'), null);
  assert.equal(colourNote('A', 'dorian')?.name, 'F#');
  assert.equal(colourNote('A', 'dorian')?.degree, '6');
  assert.equal(colourNote('A', 'phrygian')?.name, 'Bb');
  assert.equal(colourNote('A', 'lydian')?.name, 'D#');
  assert.equal(colourNote('F#', 'lydian')?.name, 'B#');
  assert.equal(colourNote('A', 'mixolydian')?.name, 'G');
  assert.equal(colourNote('A', 'aeolian')?.name, 'F');
  assert.equal(colourNote('A', 'locrian')?.name, 'Eb');
  assert.equal(colourNote('Bb', 'locrian')?.name, 'Fb');
  assert.equal(colourNote('C#', 'dorian')?.name, 'A#');
});

void test('the walk climbs the spelled mode and returns to the root', () => {
  const walk = scaleWalk('A', 'dorian');
  assert.deepEqual(
    walk.map((step) => step.note.name),
    ['A', 'B', 'C', 'D', 'E', 'F#', 'G', 'A', 'G', 'F#', 'E', 'D', 'C', 'B', 'A'],
  );
  assert.deepEqual(
    walk.map((step) => step.midi),
    [69, 71, 72, 74, 76, 78, 79, 81, 79, 78, 76, 74, 72, 71, 69],
  );
  assert.deepEqual(
    walk.map((step) => step.colour),
    [
      false,
      false,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      false,
      false,
      false,
    ],
  );
  assert.equal(walk[0].midi, lowRootMidi('A') + 24);
  assert.ok(scaleWalk('F#', 'lydian').some((step) => step.note.name === 'B#' && step.colour));
  assert.ok(scaleWalk('C', 'ionian').every((step) => step.colour === false));
  const locrian = scaleWalk('A', 'locrian');
  assert.equal(locrian.find((step) => step.colour)?.note.name, 'Eb');
});

void test('detune pairs are symmetric and centered on zero cents', () => {
  for (const sound of ['bow', 'reed'] as const) {
    const cents = symmetricDetuneCents(sound);
    assert.ok(cents.length >= 2);
    assert.equal(
      cents.reduce((sum, value) => sum + value, 0),
      0,
    );
    assert.deepEqual(
      cents.map((value) => -value).reverse(),
      [...cents],
    );
  }
});

void test('upper layers and non-roots are quieter than the low root', () => {
  assert.equal(pitchWeight('root', 'low'), 1);
  assert.ok(pitchWeight('fifth', 'low') < 1);
  assert.ok(pitchWeight('octave', 'low') < 1);
  assert.ok(pitchWeight('root', 'upper') < pitchWeight('root', 'low'));
  assert.ok(pitchWeight('fifth', 'upper') < pitchWeight('fifth', 'low'));
});

void test('every drone pitch maps to a nearby cello sample', () => {
  let worst = 0;
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      for (const octave of ['low', 'layered'] as const) {
        for (const pitch of dronePitches(root, mode.id, octave)) {
          const sample = sampleForMidi(pitch.midi);
          worst = Math.max(worst, Math.abs(sample.semitones));
          assert.ok(Math.abs(sample.semitones) <= 6, `${pitch.midi} shifts ${sample.semitones}`);
          assert.equal(sample.playbackRate, 2 ** (sample.semitones / 12));
          assert.ok(CELLO_SAMPLES.some((item) => item.file === sample.file));
        }
      }
    }
  }
  assert.ok(worst <= 6);
  assert.equal(sampleForMidi(45).file, 'cello-a2.m4a');
  assert.equal(sampleForMidi(45).playbackRate, 1);
});

void test('edge silence trim keeps interior zero crossings', () => {
  const samples = new Float32Array(12);
  samples[3] = 0.5;
  samples[4] = 0;
  samples[5] = -0.5;
  samples[8] = 0.25;
  const trimmed = trimEdgeSilence(samples, 0.01);
  assert.equal(trimmed.length, 6);
  assert.equal(trimmed[0], 0.5);
  assert.equal(trimmed[1], 0);
  assert.equal(trimmed[5], 0.25);
});

void test('the loop crossfade joins consecutive source samples', () => {
  const raw = new Float32Array(500);
  for (let i = 0; i < raw.length; i += 1) raw[i] = Math.sin(i / 8) * 0.4;
  raw[0] = 1;
  raw[raw.length - 1] = -1;
  const fade = 32;
  const loop = seamlessLoop(raw, fade);
  const outLength = raw.length - fade;
  assert.equal(loop.length, outLength);
  assert.ok(Math.abs(loop[0] - raw[outLength]) < 1e-6);
  assert.ok(Math.abs(loop[loop.length - 1] - raw[outLength - 1]) < 1e-6);
  const junction = Math.abs(loop[0] - loop[loop.length - 1]);
  assert.ok(junction < 0.2);
  assert.ok(junction < Math.abs(raw[0] - raw[raw.length - 1]));
  assert.throws(() => seamlessLoop(raw, 0));
  assert.throws(() => seamlessLoop(raw, 300));
});

void test('committed cello loops stay under the sample budget', () => {
  const directory = 'public/audio/drone';
  const files = readdirSync(directory).filter((file) => file.endsWith('.m4a'));
  assert.deepEqual(files.sort(), CELLO_SAMPLES.map((sample) => sample.file).sort());
  let total = 0;
  for (const file of files) {
    const bytes = readFileSync(`${directory}/${file}`);
    total += statSync(`${directory}/${file}`).size;
    assert.ok(bytes.includes(Buffer.from('ftyp')), `${file} is an MPEG-4 audio file`);
  }
  assert.ok(total < 600 * 1024, `${total} bytes`);
  const license = readFileSync(`${directory}/LICENSE.md`, 'utf8');
  assert.match(license, /CC0/);
  assert.match(license, /versilian-studios\.com\/vsco-community/);
  for (const sample of CELLO_SAMPLES) assert.match(license, new RegExp(sample.file));
});
