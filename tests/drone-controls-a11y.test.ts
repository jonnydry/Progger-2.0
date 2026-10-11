import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRONE_ICON_PX,
  DRONE_TAP_TARGET_PX,
  boxesOverlap,
  droneControlName,
  droneVolumeOpens,
  volumePopoverKey,
  volumePopoverOrigin,
  type DroneBox,
} from '../lib/drone-controls.ts';

const popover = { width: 168, height: 88 };

void test('the toggle name says drone and whether it is on', () => {
  assert.equal(droneControlName(true), 'Drone, on');
  assert.equal(droneControlName(false), 'Drone, off');
  assert.equal(DRONE_TAP_TARGET_PX, 44);
  assert.equal(DRONE_ICON_PX, 18);
  assert.ok(DRONE_ICON_PX < DRONE_TAP_TARGET_PX);
});

void test('volume opens from a click or an arrow key, and a long-press is not required', () => {
  assert.equal(droneVolumeOpens({ kind: 'click' }), true);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: 'ArrowDown' }), true);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: 'ArrowUp' }), true);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: 'Enter' }), false);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: ' ' }), false);
  assert.equal(droneVolumeOpens({ kind: 'longpress' }), false);
});

void test('escape returns focus to the toggle and tab leaves the popover open', () => {
  assert.deepEqual(
    volumePopoverKey({ open: false, key: 'ArrowDown', focus: 'toggle' }),
    { open: true, focus: 'slider' },
  );
  assert.deepEqual(
    volumePopoverKey({ open: false, key: 'ArrowUp', focus: 'toggle' }),
    { open: true, focus: 'slider' },
  );
  assert.deepEqual(
    volumePopoverKey({ open: false, key: 'Enter', focus: 'toggle' }),
    { open: false, focus: 'toggle' },
  );
  assert.deepEqual(
    volumePopoverKey({ open: true, key: 'Escape', focus: 'slider' }),
    { open: false, focus: 'toggle' },
  );
  assert.deepEqual(
    volumePopoverKey({ open: true, key: 'Tab', focus: 'slider' }),
    { open: true, focus: 'outside' },
  );
});

function placed(origin: { x: number; y: number }): DroneBox {
  return { ...origin, width: popover.width, height: popover.height };
}

void test('the volume popover stays on a 390 screen and misses the neck', () => {
  const neck: DroneBox = { x: -187, y: 625, width: 1200, height: 305 };
  const origin = volumePopoverOrigin({
    trigger: { x: 322, y: 335, width: 44, height: 44 },
    popover,
    viewport: { width: 390, height: 844 },
    neck,
  });
  const box = placed(origin);
  assert.deepEqual(origin, { x: 198, y: 387 });
  assert.ok(box.x >= 8);
  assert.ok(box.y >= 8);
  assert.ok(box.x + box.width <= 382);
  assert.ok(box.y + box.height <= 836);
  assert.equal(boxesOverlap(box, neck), false);
});

void test('the volume popover stays clear of the neck at 501 and 1440', () => {
  const phone = volumePopoverOrigin({
    trigger: { x: 371, y: 408, width: 44, height: 44 },
    popover,
    viewport: { width: 501, height: 900 },
    neck: { x: 0, y: 1009, width: 1200, height: 400 },
  });
  const desk = volumePopoverOrigin({
    trigger: { x: 894, y: 628, width: 44, height: 44 },
    popover,
    viewport: { width: 1440, height: 900 },
    neck: { x: 0, y: 1130, width: 1440, height: 293 },
  });
  assert.deepEqual(phone, { x: 247, y: 460 });
  assert.deepEqual(desk, { x: 770, y: 680 });
  assert.equal(
    boxesOverlap(placed(phone), {
      x: 0,
      y: 1009,
      width: 1200,
      height: 400,
    }),
    false,
  );
  assert.equal(
    boxesOverlap(placed(desk), { x: 0, y: 1130, width: 1440, height: 293 }),
    false,
  );
});

void test('a popover that would cover the neck flips above it and stays on screen', () => {
  const neck: DroneBox = { x: 0, y: 760, width: 390, height: 200 };
  const origin = volumePopoverOrigin({
    trigger: { x: 300, y: 700, width: 44, height: 44 },
    popover,
    viewport: { width: 390, height: 844 },
    neck,
  });
  assert.deepEqual(origin, { x: 176, y: 604 });
  assert.equal(boxesOverlap(placed(origin), neck), false);
  assert.deepEqual(
    volumePopoverOrigin({
      trigger: { x: 360, y: 100, width: 44, height: 44 },
      popover,
      viewport: { width: 390, height: 844 },
      neck: null,
    }),
    { x: 214, y: 152 },
  );
});

void test('the control stylesheet keeps a 44px target and a smaller icon out of the flex row', () => {
  const css = readFileSync(
    new URL('../app/drone-controls.css', import.meta.url),
    'utf8',
  );
  const view = readFileSync(
    new URL('../components/drone-controls.tsx', import.meta.url),
    'utf8',
  );
  assert.match(
    css,
    /\.drone-toggle,\n\.drone-volume-trigger \{[^}]*min-width:\s*44px/,
  );
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\.drone-toggle svg \{[^}]*width:\s*18px/);
  assert.match(css, /height:\s*18px/);
  assert.match(css, /display:\s*contents/);
  assert.doesNotMatch(css, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(css, /flex:\s*1\s*0\s*100%/);
  assert.match(view, /aria-pressed=\{enabled\}/);
  assert.match(view, /aria-label=\{droneControlName\(enabled\)\}/);
  assert.match(view, /droneVolumeOpens\(\{ kind: 'click' \}\)/);
  assert.match(view, /volumePopoverKey/);
  assert.match(view, /min=\{0\}/);
  assert.match(view, /max=\{1\}/);
  assert.doesNotMatch(view, /aria-modal/);
  assert.doesNotMatch(view, /setTimeout/);
});
