import { test } from 'node:test';
import assert from 'node:assert/strict';
import { droneCommand, droneStopFade } from '../lib/drone-session.ts';
import { REED_TIMING, type ReedRequest } from '../lib/drone-audio.ts';

const aDorian: ReedRequest = { root: 'A', modeId: 'dorian', octave: 'low' };
const eIonian: ReedRequest = { root: 'E', modeId: 'ionian', octave: 'low' };

void test('leaving the scale view cuts the drone instead of letting the long fade play behind the next view', () => {
  assert.equal(droneStopFade('away'), REED_TIMING.hideFade);
  assert.equal(droneStopFade('scales'), REED_TIMING.stopFade);
  assert.ok(droneStopFade('away') < 0.05);
  assert.ok(droneStopFade('away') < droneStopFade('scales'));
});

void test('the drone stays silent until it is turned on', () => {
  assert.deepEqual(
    droneCommand({
      enabled: false,
      place: 'scales',
      phase: 'unstarted',
      current: null,
      request: aDorian,
    }),
    { type: 'silent' },
  );
});

void test('a key change while the drone is heard cross-fades, and leaving the scale view stops it', () => {
  assert.deepEqual(
    droneCommand({
      enabled: true,
      place: 'scales',
      phase: 'playing',
      current: aDorian,
      request: eIonian,
    }),
    { type: 'retune', request: eIonian },
  );
  assert.deepEqual(
    droneCommand({
      enabled: true,
      place: 'scales',
      phase: 'playing',
      current: aDorian,
      request: { ...aDorian, modeId: 'locrian' },
    }),
    {
      type: 'retune',
      request: { root: 'A', modeId: 'locrian', octave: 'low' },
    },
  );
  assert.equal(
    droneCommand({
      enabled: true,
      place: 'scales',
      phase: 'playing',
      current: aDorian,
      request: aDorian,
    }).type,
    'hold',
  );
  for (const place of ['away'] as const) {
    assert.equal(
      droneCommand({
        enabled: true,
        place,
        phase: 'playing',
        current: aDorian,
        request: aDorian,
      }).type,
      'stop',
    );
  }
  assert.equal(
    droneCommand({
      enabled: true,
      place: 'away',
      phase: 'idle',
      current: null,
      request: eIonian,
    }).type,
    'silent',
  );
  assert.deepEqual(
    droneCommand({
      enabled: true,
      place: 'scales',
      phase: 'idle',
      current: null,
      request: eIonian,
    }),
    { type: 'play', request: eIonian },
  );
});
