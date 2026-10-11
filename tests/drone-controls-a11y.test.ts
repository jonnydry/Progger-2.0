import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRONE_ICON_PX,
  DRONE_TAP_TARGET_PX,
  VOLUME_POPOVER_OBSTACLE_SELECTORS,
  boxesOverlap,
  droneControlName,
  droneVolumeFocusOut,
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

void test('focus leaving the volume popover closes it, and a press on the volume button does not', () => {
  assert.deepEqual(
    droneVolumeFocusOut({
      relatedInside: true,
      relatedTrigger: false,
      pointerOnTrigger: false,
    }),
    { open: true },
  );
  assert.deepEqual(
    droneVolumeFocusOut({
      relatedInside: false,
      relatedTrigger: true,
      pointerOnTrigger: true,
    }),
    { open: true },
  );
  assert.deepEqual(
    droneVolumeFocusOut({
      relatedInside: false,
      relatedTrigger: true,
      pointerOnTrigger: false,
    }),
    { open: false },
  );
  assert.deepEqual(
    droneVolumeFocusOut({
      relatedInside: false,
      relatedTrigger: false,
      pointerOnTrigger: false,
    }),
    { open: false },
  );
});

void test('volume opens from a click or an arrow key, and a long-press is not required', () => {
  assert.equal(droneVolumeOpens({ kind: 'click' }), true);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: 'ArrowDown' }), true);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: 'ArrowUp' }), true);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: 'Enter' }), false);
  assert.equal(droneVolumeOpens({ kind: 'keydown', key: ' ' }), false);
  assert.equal(droneVolumeOpens({ kind: 'longpress' }), false);
});

void test('escape closes toward the toggle and tab is not trapped', () => {
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

function placed(origin: { x: number; y: number } | null): DroneBox {
  if (!origin) throw new Error('popover origin missing');
  return { ...origin, width: popover.width, height: popover.height };
}

function misses(box: DroneBox, obstacles: DroneBox[]) {
  for (const obstacle of obstacles) {
    assert.equal(boxesOverlap(box, obstacle), false);
  }
}

void test('the volume popover opens above the caption and degree letters', () => {
  const scenes: {
    viewport: { width: number; height: number };
    trigger: DroneBox;
    caption: DroneBox;
    letters: DroneBox[];
    blocked: DroneBox[];
    origin: { x: number; y: number };
  }[] = [
    {
      viewport: { width: 390, height: 844 },
      trigger: { x: 322, y: 335.38, width: 44, height: 44 },
      caption: { x: 85.8, y: 395.38, width: 218.41, height: 19.5 },
      letters: [
        { x: 23.89, y: 469.38, width: 7.2, height: 18 },
        { x: 355.3, y: 469.38, width: 14.41, height: 18 },
      ],
      blocked: [
        { x: 21.8, y: 435.88, width: 11.41, height: 28.5 },
        { x: 356.8, y: 435.88, width: 11.41, height: 28.5 },
        { x: 18, y: 18, width: 130, height: 44 },
        { x: 18, y: 62, width: 354, height: 48 },
        { x: 16, y: 223.38, width: 358, height: 44 },
        { x: 16, y: 275.38, width: 358, height: 44 },
        { x: 16, y: 536.38, width: 358, height: 53 },
        { x: -187, y: 625.38, width: 1200, height: 305 },
      ],
      origin: { x: 198, y: 127.38 },
    },
    {
      viewport: { width: 501, height: 900 },
      trigger: { x: 371.52, y: 408.39, width: 44, height: 44 },
      caption: { x: 132.89, y: 470.39, width: 235.2, height: 21 },
      letters: [
        { x: 81.3, y: 554.89, width: 8.41, height: 21 },
        { x: 407.09, y: 554.89, width: 16.81, height: 21 },
      ],
      blocked: [
        { x: 78.59, y: 511.39, width: 13.81, height: 34.5 },
        { x: 408.59, y: 511.39, width: 13.81, height: 34.5 },
        { x: 24, y: 20, width: 135.14, height: 37.5 },
        { x: 24, y: 64, width: 453, height: 48 },
        { x: 24, y: 290.39, width: 453, height: 44 },
        { x: 24, y: 338.39, width: 453, height: 44 },
        { x: 24, y: 628.89, width: 453, height: 34.5 },
        { x: -143, y: 1008.58, width: 1200, height: 305 },
      ],
      origin: { x: 247.52, y: 194.39 },
    },
    {
      viewport: { width: 1440, height: 900 },
      trigger: { x: 893.5, y: 628, width: 44, height: 44 },
      caption: { x: 569.69, y: 690, width: 285.61, height: 25.5 },
      letters: [
        { x: 511.08, y: 777.5, width: 9.61, height: 24 },
        { x: 899.48, y: 777.5, width: 19.2, height: 24 },
      ],
      blocked: [
        { x: 508.08, y: 729.5, width: 15.61, height: 39 },
        { x: 826.89, y: 729.5, width: 31.2, height: 39 },
        { x: 901.28, y: 729.5, width: 15.61, height: 39 },
        { x: 28, y: 26, width: 171.02, height: 48 },
        { x: 247.02, y: 26, width: 225.81, height: 44 },
        { x: 56, y: 520, width: 1313, height: 44 },
        { x: 56, y: 568, width: 1313, height: 44 },
        { x: 56, y: 848.5, width: 1313, height: 31.5 },
        { x: -407, y: 1129.69, width: 3182.5, height: 293 },
      ],
      origin: { x: 769.5, y: 424 },
    },
  ];
  for (const scene of scenes) {
    const obstacles = [scene.caption, ...scene.letters, ...scene.blocked];
    const origin = volumePopoverOrigin({
      trigger: scene.trigger,
      popover,
      viewport: scene.viewport,
      obstacles,
    });
    assert.ok(origin);
    assert.ok(Math.abs(origin.x - scene.origin.x) < 0.001);
    assert.ok(Math.abs(origin.y - scene.origin.y) < 0.001);
    const box = placed(origin);
    misses(box, obstacles);
    assert.ok(box.y + box.height <= scene.caption.y);
    assert.ok(box.x >= 8);
    assert.ok(box.y >= 8);
    assert.ok(box.x + box.width <= scene.viewport.width - 8);
    assert.ok(box.y + box.height <= scene.viewport.height - 8);
  }
});

void test('a popover that cannot miss the neck stays closed', () => {
  assert.equal(
    volumePopoverOrigin({
      trigger: { x: 300, y: 40, width: 44, height: 44 },
      popover,
      viewport: { width: 390, height: 844 },
      neck: { x: 0, y: 0, width: 390, height: 844 },
    }),
    null,
  );
});

void test('a popover that would cover the neck opens above it and stays on screen', () => {
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
  assert.match(
    css,
    /\.drone-toggle svg,\n\.drone-volume-trigger svg \{[^}]*width:\s*18px/,
  );
  assert.match(css, /height:\s*18px/);
  assert.match(css, /border:\s*1px solid var\(--border\)/);
  assert.match(css, /outline:\s*2px solid var\(--green\)/);
  assert.match(css, /display:\s*contents/);
  assert.match(css, /flex:\s*0 0 44px/);
  assert.match(css, /text-overflow:\s*ellipsis/);
  assert.match(css, /min-width:\s*0/);
  assert.doesNotMatch(css, /calc\(100% \+ 8px\)/);
  assert.doesNotMatch(css, /left:\s*-52px/);
  assert.doesNotMatch(css, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(css, /flex:\s*1\s*0\s*100%/);
  assert.match(view, /aria-pressed=\{enabled\}/);
  assert.match(view, /aria-label=\{droneControlName\(enabled\)\}/);
  assert.match(view, /ChevronDown/);
  assert.match(view, /droneVolumeOpens\(\{ kind: 'click' \}\)/);
  assert.match(view, /volumePopoverKey/);
  assert.match(view, /droneVolumeFocusOut/);
  assert.match(view, /addEventListener\('focusout', onFocusOut\)/);
  assert.match(view, /VOLUME_POPOVER_OBSTACLE_SELECTORS/);
  assert.match(view, /addEventListener\('scroll', onScroll, true\)/);
  assert.match(
    view,
    /closest\(\s*'#drone-volume-popover, #drone-volume-trigger'\s*\)/,
  );
  assert.match(view, /min=\{0\}/);
  assert.match(view, /max=\{1\}/);
  assert.doesNotMatch(view, /aria-modal/);
  assert.doesNotMatch(view, /setTimeout/);
  assert.ok(VOLUME_POPOVER_OBSTACLE_SELECTORS.includes('.scale-caption'));
  assert.ok(VOLUME_POPOVER_OBSTACLE_SELECTORS.includes('.palette-note small'));
});
