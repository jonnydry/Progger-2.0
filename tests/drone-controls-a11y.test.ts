import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRONE_ICON_PX,
  DRONE_POPOVER_GUARD_PX,
  DRONE_POPOVER_NUDGE_PX,
  DRONE_TAP_TARGET_PX,
  VOLUME_POPOVER_GUARD_SELECTORS,
  anchoredVolumePopover,
  boxGap,
  boxesOverlap,
  droneControlName,
  droneVolumeFocusOut,
  droneVolumeOpens,
  popoverFixedPoint,
  volumePopoverKey,
  type AnchoredPopover,
  type DroneBox,
} from '../lib/drone-controls.ts';

const popover = { width: 220, height: 120 };

void test('the toggle name says drone and whether it is on', () => {
  assert.equal(droneControlName(true), 'Drone, on');
  assert.equal(droneControlName(false), 'Drone, off');
  assert.equal(droneControlName(true, 'Reed'), 'Drone, on, Reed');
  assert.equal(droneControlName(false, 'Cello'), 'Drone, off, Cello');
  assert.equal(DRONE_TAP_TARGET_PX, 44);
  assert.equal(DRONE_ICON_PX, 18);
  assert.ok(DRONE_ICON_PX < DRONE_TAP_TARGET_PX);
  assert.equal(DRONE_POPOVER_GUARD_PX, 8);
  assert.equal(DRONE_POPOVER_NUDGE_PX, 24);
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

void test('escape returns focus to the volume button and tab is not trapped', () => {
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
    { open: false, focus: 'volume' },
  );
  assert.deepEqual(
    volumePopoverKey({ open: true, key: 'Tab', focus: 'slider' }),
    { open: true, focus: 'outside' },
  );
});

function placed(origin: AnchoredPopover): DroneBox {
  return {
    x: origin.x,
    y: origin.y,
    width: popover.width,
    height: popover.height,
  };
}

void test('the menu stays anchored at 320, 390, 501, and desktop', () => {
  const scenes: {
    width: number;
    height: number;
    trigger: DroneBox;
    tab: DroneBox;
    root: DroneBox;
    scale: DroneBox;
  }[] = [
    {
      width: 320,
      height: 844,
      trigger: { x: 16, y: 310, width: 68, height: 44 },
      tab: { x: 75.59375, y: 250, width: 100.8125, height: 44 },
      root: { x: 116, y: 298, width: 44, height: 68 },
      scale: { x: 168, y: 298, width: 36, height: 68 },
    },
    {
      width: 390,
      height: 844,
      trigger: { x: 16, y: 335.375, width: 68, height: 44 },
      tab: { x: 110.59375, y: 275.375, width: 100.8125, height: 44 },
      root: { x: 116, y: 323.375, width: 44, height: 68 },
      scale: { x: 168, y: 323.375, width: 106, height: 68 },
    },
    {
      width: 501,
      height: 844,
      trigger: { x: 24, y: 408.390625, width: 68, height: 44 },
      tab: { x: 156.484375, y: 338.390625, width: 114.8125, height: 44 },
      root: { x: 137.5, y: 392.390625, width: 51, height: 76 },
      scale: { x: 200.5, y: 392.390625, width: 163, height: 76 },
    },
    {
      width: 1440,
      height: 900,
      trigger: { x: 56, y: 628, width: 68, height: 44 },
      tab: { x: 625.984375, y: 568, width: 114.8125, height: 44 },
      root: { x: 547, y: 612, width: 69, height: 76 },
      scale: { x: 628, y: 612, width: 265, height: 76 },
    },
  ];
  for (const scene of scenes) {
    const guards = [scene.tab, scene.root, scene.scale];
    const origin = anchoredVolumePopover({
      trigger: scene.trigger,
      popover: { width: 220, height: 100 },
      viewport: { width: scene.width, height: scene.height },
      guards,
    });
    assert.equal(
      origin.side,
      'below',
      `${scene.width}px opens below the button`,
    );
    assert.equal(origin.x, scene.trigger.x);
    const gap = origin.y - (scene.trigger.y + scene.trigger.height);
    assert.ok(
      gap >= 8 && gap <= 8 + DRONE_POPOVER_NUDGE_PX,
      `${scene.width}px gap ${gap} is not next to the button`,
    );
    const box = { ...origin, width: 220, height: 100 };
    for (const guard of guards) {
      assert.ok(
        boxGap(box, guard) >= DRONE_POPOVER_GUARD_PX,
        `${scene.width}px overlaps a picker or the tab`,
      );
      assert.equal(boxesOverlap(box, guard), false);
    }
    const scrolled = anchoredVolumePopover({
      trigger: { ...scene.trigger, y: scene.trigger.y + 40 },
      popover: { width: 220, height: 100 },
      viewport: { width: scene.width, height: scene.height },
      guards: guards.map((guard) => ({ ...guard, y: guard.y + 40 })),
    });
    assert.equal(scrolled.side, 'below');
    assert.equal(scrolled.y - origin.y, 40);
    assert.equal(scrolled.x, origin.x);
  }
});

void test('the menu flips above when below leaves the viewport, and sheets when neither side fits', () => {
  const above = anchoredVolumePopover({
    trigger: { x: 16, y: 780, width: 68, height: 44 },
    popover,
    viewport: { width: 390, height: 844 },
  });
  assert.equal(above.side, 'above');
  assert.equal(above.x, 16);
  assert.equal(above.y, 780 - popover.height - 8);
  const sheet = anchoredVolumePopover({
    trigger: { x: 16, y: 40, width: 68, height: 44 },
    popover,
    viewport: { width: 320, height: 180 },
  });
  assert.equal(sheet.side, 'sheet');
  assert.equal(sheet.x, 8);
  assert.ok(sheet.y >= 8);
  assert.ok(sheet.y + popover.height <= 180 - 8 + 0.01);
  const clamped = anchoredVolumePopover({
    trigger: { x: 300, y: 200, width: 68, height: 44 },
    popover,
    viewport: { width: 390, height: 844 },
  });
  assert.equal(clamped.side, 'below');
  assert.equal(clamped.x, 390 - popover.width - 8);
});

void test('a 4px picker graze stays under the button instead of jumping up the page', () => {
  const trigger: DroneBox = { x: 16, y: 335.375, width: 68, height: 44 };
  const root: DroneBox = { x: 116, y: 323.375, width: 44, height: 68 };
  const origin = anchoredVolumePopover({
    trigger,
    popover: { width: 220, height: 100 },
    viewport: { width: 390, height: 844 },
    guards: [root],
  });
  assert.equal(origin.side, 'below');
  assert.ok(origin.y > 200);
  assert.equal(boxGap(placed({ ...origin, side: 'below' }), root) >= 8, true);
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
    /\.drone-toggle,\n\.drone-volume-trigger,\n\.drone-walk \{[^}]*min-width:\s*44px/,
  );
  assert.match(css, /min-height:\s*44px/);
  assert.match(
    css,
    /\.drone-toggle svg,\n\.drone-volume-trigger svg,\n\.drone-walk svg \{[^}]*width:\s*18px/,
  );
  assert.match(css, /height:\s*18px/);
  assert.match(css, /border:\s*1px solid var\(--border\)/);
  assert.match(css, /outline:\s*var\(--focus-ring\)/);
  assert.match(css, /outline-offset:\s*var\(--focus-offset\)/);
  assert.match(
    readFileSync(new URL('../app/deck-tokens.css', import.meta.url), 'utf8'),
    /--focus-ring:\s*3px solid var\(--amber\)/,
  );
  assert.match(css, /z-index:\s*4/);
  assert.match(css, /\.drone-toggle:hover:not\(\[aria-pressed='true'\]\)/);
  assert.match(css, /\.drone-walk:hover:not\(\[aria-pressed='true'\]\)/);
  assert.match(
    css,
    /\.drone-volume-trigger:hover:not\(\[aria-expanded='true'\]\)/,
  );
  assert.match(css, /\.drone-toggle:active/);
  assert.match(css, /\.drone-walk:active/);
  assert.match(css, /\.drone-volume-trigger:active/);
  assert.match(css, /\.drone-sound-options button:hover:not\(:disabled\)/);
  assert.match(css, /\.drone-sound-options button:active:not\(:disabled\)/);
  assert.match(css, /background:\s*var\(--green\)/);
  assert.match(css, /color:\s*var\(--primary-foreground\)/);
  assert.match(css, /data-playing='true'/);
  assert.match(css, /\.drone-sound-name/);
  assert.match(css, /--drone-side:\s*100px/);
  assert.match(css, /\.drone-sound-options button:focus-visible/);
  assert.match(css, /button\[aria-pressed='true'\]/);
  assert.match(css, /display:\s*contents/);
  assert.match(css, /flex:\s*0 0 44px/);
  assert.match(css, /text-overflow:\s*ellipsis/);
  assert.match(css, /min-width:\s*0/);
  assert.doesNotMatch(css, /calc\(100% \+ 8px\)/);
  assert.doesNotMatch(css, /left:\s*-52px/);
  assert.doesNotMatch(css, /flex-wrap:\s*wrap/);
  assert.doesNotMatch(css, /flex:\s*1\s*0\s*100%/);
  assert.match(view, /aria-pressed=\{enabled\}/);
  assert.match(view, /aria-label=\{droneControlName\(enabled, activeSound\)\}/);
  assert.match(view, /data-playing=\{enabled \? 'true' : 'false'\}/);
  assert.match(view, /data-sound=\{sound\}/);
  assert.match(view, /className="drone-sound-name"/);
  assert.match(view, /aria-label=\{`Drone sound, \$\{activeSound\}`\}/);
  assert.match(view, /anchoredVolumePopover/);
  assert.match(view, /popoverFixedPoint/);
  assert.match(view, /guards: guardBoxes\(\)/);
  assert.match(view, /VOLUME_POPOVER_GUARD_SELECTORS/);
  assert.match(view, /data-side=\{side\}/);
  assert.match(view, /initialFocus === 'slider'/);
  assert.match(
    view,
    /anchorRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.match(view, /setVolumeFocus\('trigger'\)/);
  assert.doesNotMatch(view, /onDismiss\(\)/);
  assert.doesNotMatch(view, /volumePopoverOrigin/);
  const toggleAt = view.indexOf('id="drone-toggle"');
  const volumeAt = view.indexOf('id="drone-volume-trigger"');
  const walkAt = view.indexOf('id="drone-walk"');
  assert.equal(view.includes('id="drone-level"'), false);
  assert.equal((view.match(/type="range"/g) ?? []).length, 1);
  assert.ok(volumeAt >= 0 && volumeAt < walkAt && walkAt < toggleAt);
  const volumeButton = view.slice(
    volumeAt,
    view.indexOf('<DroneVolumePopover'),
  );
  const toggle = view.slice(toggleAt, view.indexOf('</button>', toggleAt));
  assert.match(volumeButton, /aria-haspopup="dialog"/);
  assert.match(volumeButton, /aria-expanded=\{volumeOpen\}/);
  assert.match(volumeButton, /aria-controls="drone-volume-popover"/);
  assert.doesNotMatch(toggle, /aria-haspopup/);
  assert.doesNotMatch(toggle, /aria-expanded/);
  assert.doesNotMatch(toggle, /aria-controls/);
  assert.match(view, /anchorRef=\{volumeRef\}/);
  assert.doesNotMatch(view, /anchorRef=\{toggleRef\}/);
  assert.doesNotMatch(view, /anchorRef\.current = toggleRef\.current/);
  assert.match(view, /ChevronDown/);
  assert.match(view, /droneVolumeOpens\(\{ kind: 'click' \}\)/);
  assert.match(view, /volumePopoverKey/);
  assert.match(view, /droneVolumeFocusOut/);
  assert.match(view, /addEventListener\('focusout', onFocusOut\)/);
  assert.match(view, /addEventListener\('scroll', place, true\)/);
  assert.match(css, /data-side='sheet'/);
  assert.match(
    view,
    /closest\(\s*'#drone-volume-popover, #drone-volume-trigger'\s*\)/,
  );
  assert.match(view, /min=\{0\}/);
  assert.match(view, /max=\{1\}/);
  assert.match(view, /onClick=\{\(\) => onSound\(choice\.id\)\}/);
  assert.match(view, /disabled=\{unavailable\}/);
  assert.match(view, /, unavailable/);
  assert.doesNotMatch(view, /aria-modal/);
  assert.doesNotMatch(view, /createPortal/);
  assert.match(view, /id="drone-volume-trigger"[\s\S]*<DroneVolumePopover/);
  assert.match(view, /id="drone-volume-trigger"[\s\S]*id="drone-toggle"/);
  assert.match(view, /setTimeout\(\(\) => \{\s*leaveTimer\.current = null;/);
  assert.match(view, /setTimeout\(\(\) => \{\s*returnTimer\.current = null;/);
  assert.match(
    view,
    /volumeRef\.current\?\.focus\(\{ preventScroll: true \}\)/,
  );
  assert.ok(VOLUME_POPOVER_GUARD_SELECTORS.includes('#scales-reference-tab'));
  assert.ok(VOLUME_POPOVER_GUARD_SELECTORS.includes('.root-select'));
  assert.ok(VOLUME_POPOVER_GUARD_SELECTORS.includes('.scale-select'));
});

void test('hover, focus, and the on state stay visible on the three drone buttons', () => {
  const css = readFileSync(
    new URL('../app/drone-controls.css', import.meta.url),
    'utf8',
  );
  const view = readFileSync(
    new URL('../components/drone-controls.tsx', import.meta.url),
    'utf8',
  );
  for (const control of [
    '.drone-toggle',
    '.drone-walk',
    '.drone-volume-trigger',
  ]) {
    assert.match(css, new RegExp(`${control.replace('.', '\\.')}:hover`));
    assert.match(css, new RegExp(`${control.replace('.', '\\.')}:active`));
    assert.match(
      css,
      new RegExp(`${control.replace('.', '\\.')}:focus-visible`),
    );
  }
  assert.match(css, /\.drone-toggle\[aria-pressed='true'\]/);
  assert.match(css, /\.drone-walk\[aria-pressed='true'\]/);
  assert.match(css, /\.drone-volume-trigger\[data-playing='true'\]/);
  assert.match(
    view,
    /<span className="drone-sound-name">\{activeSound\}<\/span>/,
  );
  assert.equal(droneControlName(true, 'Bow'), 'Drone, on, Bow');
});

void test('a fixed popover follows its container so a shell offset cannot cover the tab', () => {
  assert.deepEqual(popoverFixedPoint({ x: 8, y: 123 }, null), { x: 8, y: 123 });
  assert.deepEqual(popoverFixedPoint({ x: 8, y: 123 }, { x: 0, y: 0 }), {
    x: 8,
    y: 123,
  });
  assert.deepEqual(popoverFixedPoint({ x: 40, y: 200 }, { x: 16, y: -80 }), {
    x: 24,
    y: 280,
  });
});

void test('the sound menu keeps 44px targets and focuses only once it is placed', () => {
  const css = readFileSync(
    new URL('../app/drone-controls.css', import.meta.url),
    'utf8',
  );
  const tokens = readFileSync(
    new URL('../app/deck-tokens.css', import.meta.url),
    'utf8',
  );
  const view = readFileSync(
    new URL('../components/drone-controls.tsx', import.meta.url),
    'utf8',
  );
  assert.match(tokens, new RegExp(`--tap:\\s*${DRONE_TAP_TARGET_PX}px`));
  assert.match(
    css,
    /\.drone-volume-popover input\[type='range'\] \{[^}]*min-height:\s*var\(--tap\)/,
  );
  assert.match(
    css,
    /\.drone-sound-options button \{[^}]*min-height:\s*var\(--tap\)/,
  );
  // A hidden slider cannot take focus, so ArrowDown waits for the position.
  assert.match(view, /if \(didFocus\.current \|\| !origin\) return;/);
  assert.match(view, /\[anchorRef, initialFocus, origin\]/);
});
