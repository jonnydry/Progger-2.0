import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DRONE_MODES,
  DRONE_ROOTS,
  type DroneModeId,
  colourNote,
  droneLabel,
  droneMode,
  dronePitches,
  lowRootMidi,
  midiHz,
  modeIntervals,
  scaleWalk,
  scientificPitch,
} from '../lib/drone.ts';
import { SCALES } from '../lib/music.ts';

void test('drone roots sit on MIDI pitch classes above C2', () => {
  assert.equal(DRONE_ROOTS.length, 12);
  assert.deepEqual(
    DRONE_ROOTS.map((root) => lowRootMidi(root) - 36),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  );
});

void test('mode rows use the linked scale formulas and name the colour degree', () => {
  const rows: readonly [DroneModeId, string, string, string, string][] = [
    ['ionian', 'major', 'Ionian', '7', 'natural 7'],
    ['dorian', 'dorian', 'Dorian', '6', 'natural 6'],
    ['phrygian', 'phrygian', 'Phrygian', 'b2', 'flat 2'],
    ['lydian', 'lydian', 'Lydian', '#4', 'sharp 4'],
    ['mixolydian', 'mixolydian', 'Mixolydian', 'b7', 'flat 7'],
    ['aeolian', 'minor', 'Aeolian', 'b6', 'flat 6'],
    ['locrian', 'locrian', 'Locrian', 'b5', 'flat 5'],
  ];
  assert.deepEqual(
    DRONE_MODES.map((mode) => mode.id),
    rows.map((row) => row[0]),
  );
  for (const [id, scaleId, name, colourDegree, colourLabel] of rows) {
    const mode = DRONE_MODES.find((item) => item.id === id);
    const scale = SCALES.find((item) => item.id === scaleId);
    assert.ok(mode);
    assert.ok(scale);
    assert.equal(mode.name, name);
    assert.deepEqual([...mode.formula], scale.formula);
    assert.equal(mode.colourDegree, colourDegree);
    assert.equal(mode.colourLabel, colourLabel);
  }
  assert.throws(
    () => droneMode('hypodorian' as DroneModeId),
    /Unknown drone mode: hypodorian/,
  );
});

void test('mode intervals are the spelled semitone row', () => {
  assert.deepEqual(modeIntervals('ionian'), [0, 2, 4, 5, 7, 9, 11]);
  assert.deepEqual(modeIntervals('dorian'), [0, 2, 3, 5, 7, 9, 10]);
  assert.deepEqual(modeIntervals('phrygian'), [0, 1, 3, 5, 7, 8, 10]);
  assert.deepEqual(modeIntervals('lydian'), [0, 2, 4, 6, 7, 9, 11]);
  assert.deepEqual(modeIntervals('mixolydian'), [0, 2, 4, 5, 7, 9, 10]);
  assert.deepEqual(modeIntervals('aeolian'), [0, 2, 3, 5, 7, 8, 10]);
  assert.deepEqual(modeIntervals('locrian'), [0, 1, 3, 5, 6, 8, 10]);
});

void test('low drone MIDI, scientific pitch, and A4 line up', () => {
  assert.equal(lowRootMidi('C'), 36);
  assert.equal(lowRootMidi('E'), 40);
  assert.equal(lowRootMidi('A'), 45);
  assert.equal(lowRootMidi('B'), 47);
  assert.equal(scientificPitch('E', 40), 'E2');
  assert.equal(scientificPitch('A', 45), 'A2');
  assert.equal(midiHz(69), 440);
});

void test('every root drones a fifth, except Locrian which drones the octave', () => {
  for (const root of DRONE_ROOTS) {
    for (const mode of DRONE_MODES) {
      const low = dronePitches(root, mode.id, 'low');
      assert.equal(low.length, 2);
      assert.equal(low[0].role, 'root');
      assert.equal(low[0].layer, 'low');
      assert.equal(low[0].degree, '1');
      assert.equal(low[0].midi, lowRootMidi(root));
      assert.equal(low[1].layer, 'low');
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
      assert.equal(layered[0].layer, 'low');
      assert.equal(layered[1].layer, 'low');
      assert.equal(layered[2].layer, 'upper');
      assert.equal(layered[3].layer, 'upper');
      assert.equal(layered[2].midi, low[0].midi + 12);
      assert.equal(layered[3].midi, low[1].midi + 12);
      assert.equal(layered[2].role, low[0].role);
      assert.equal(layered[3].role, low[1].role);
    }
  }
});

void test('drone labels spell the low dyad and the phone octave', () => {
  assert.equal(droneLabel(dronePitches('A', 'dorian', 'low')), 'A2 + E3');
  assert.equal(droneLabel(dronePitches('A', 'dorian', 'layered')), 'A2 + E3, with A3 + E4');
  assert.equal(droneLabel(dronePitches('A', 'locrian', 'low')), 'A2 + A3');
  assert.equal(droneLabel(dronePitches('E', 'ionian', 'low')), 'E2 + B2');
  assert.equal(droneLabel(dronePitches('Gb', 'ionian', 'low')), 'G♭2 + D♭3');
  assert.equal(droneLabel(dronePitches('Cb', 'ionian', 'low')), 'C♭3 + G♭3');
  assert.equal(droneLabel(dronePitches('E#', 'ionian', 'low')), 'E♯2 + B♯2');
  assert.equal(droneLabel(dronePitches('Fb', 'ionian', 'low')), 'F♭2 + C♭3');
  assert.equal(scientificPitch('B#', 60), 'B♯3');
});

void test('colour notes keep the mode spelling', () => {
  assert.equal(colourNote('A', 'ionian').name, 'G#');
  assert.equal(colourNote('A', 'ionian').degree, '7');
  assert.equal(colourNote('A', 'dorian').name, 'F#');
  assert.equal(colourNote('A', 'dorian').degree, '6');
  assert.equal(colourNote('A', 'phrygian').name, 'Bb');
  assert.equal(colourNote('A', 'lydian').name, 'D#');
  assert.equal(colourNote('F#', 'lydian').name, 'B#');
  assert.equal(colourNote('A', 'mixolydian').name, 'G');
  assert.equal(colourNote('A', 'aeolian').name, 'F');
  assert.equal(colourNote('A', 'locrian').name, 'Eb');
  assert.equal(colourNote('Bb', 'locrian').name, 'Fb');
  assert.equal(colourNote('C#', 'dorian').name, 'A#');
});

void test('the scale walk climbs two octaves above the low drone and colours the characteristic degree both ways', () => {
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
  assert.equal(
    scaleWalk('F#', 'lydian').some((step) => step.colour && step.note.name === 'B#'),
    true,
  );
  const ionian = scaleWalk('A', 'ionian');
  assert.deepEqual(
    ionian.filter((step) => step.colour).map((step) => step.note.name),
    ['G#', 'G#'],
  );
  assert.equal(ionian[7].note.name, 'A');
  assert.equal(ionian[7].note.degree, '1');
  assert.equal(ionian[7].colour, false);
  const locrian = scaleWalk('A', 'locrian');
  assert.equal(locrian.find((step) => step.colour)?.note.name, 'Eb');
  assert.deepEqual(
    dronePitches('A', 'locrian', 'low').map((pitch) => pitch.name),
    ['A', 'A'],
  );
});

void test('the note module does not mention an audio context', () => {
  const source = readFileSync('lib/drone.ts', 'utf8');
  assert.equal(source.includes('AudioContext'), false);
});
