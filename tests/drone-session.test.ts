import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ExploreDrone, droneCommand, droneStopFade } from '../lib/drone-session.ts';
import { REED_TIMING, type ReedDrone, type ReedRequest } from '../lib/drone-audio.ts';

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

void test('picking a sound while the drone is off does not start audio', () => {
  const calls: { play: ReedRequest[]; retune: ReedRequest[]; preload: number } = {
    play: [],
    retune: [],
    preload: 0,
  };
  const controller = new ExploreDrone(() => {
    const engine = {
      play(request: ReedRequest) {
        calls.play.push(request);
      },
      retune(request: ReedRequest) {
        calls.retune.push(request);
      },
      preloadCello() {
        calls.preload += 1;
        return Promise.resolve();
      },
      stop() {},
      setVolume() {},
      dispose() {},
      walk() {},
      stopWalk() {},
    };
    return engine as unknown as ReedDrone;
  }, aDorian);
  controller.setActive(true);
  let notices = 0;
  controller.subscribe(() => {
    notices += 1;
  });
  for (const sound of ['bow', 'cello', 'reed'] as const) {
    const before = notices;
    controller.setSound(sound);
    assert.equal(controller.snapshot().sound, sound);
    assert.equal(controller.snapshot().pressed, false);
    assert.ok(notices > before);
    assert.equal(calls.play.length, 0);
    assert.equal(calls.retune.length, 0);
  }
  assert.equal(calls.preload, 1);
  controller.toggle();
  assert.equal(controller.snapshot().pressed, true);
  assert.equal(calls.play.length, 1);
  assert.equal(calls.play[0]?.sound, 'reed');
  controller.setSound('bow');
  assert.equal(calls.play.length, 1);
  assert.equal(calls.retune.length, 1);
  assert.equal(calls.retune[0]?.sound, 'bow');
  assert.equal(controller.snapshot().sound, 'bow');
  assert.equal(controller.snapshot().pressed, true);
  controller.dispose();
});
