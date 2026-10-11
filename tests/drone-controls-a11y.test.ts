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

const popover = { width: 220, height: 120 };

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

function placed(origin: { x: number; y: number } | null): DroneBox {
  if (!origin) throw new Error('popover origin missing');
  return { ...origin, width: popover.width, height: popover.height };
}

void test('the volume popover misses the scales tab, the pickers, the caption, and the letters', () => {
  const grown = { width: 220, height: 100 };
  const scenes: {
    viewport: { width: number; height: number };
    trigger: DroneBox;
    tab: DroneBox;
    obstacles: (DroneBox & { selector: string })[];
    origin: { x: number; y: number };
  }[] = [{"viewport":{"width":390,"height":844},"trigger":{"x":16,"y":335.375,"width":44,"height":44},"tab":{"x":110.59375,"y":275.375,"width":100.8125,"height":44},"obstacles":[{"selector":".brand","x":18,"y":18,"width":130,"height":44},{"selector":".site-header nav","x":18,"y":62,"width":354,"height":48},{"selector":".workspace-tools","x":16,"y":223.375,"width":358,"height":44},{"selector":".reference-tabs","x":16,"y":275.375,"width":358,"height":44},{"selector":".root-select","x":108.5,"y":323.375,"width":44,"height":68},{"selector":".scale-select","x":160.5,"y":323.375,"width":121,"height":68},{"selector":".scale-caption","x":85.796875,"y":395.375,"width":218.40625,"height":19.5},{"selector":".palette-note > span","x":21.796875,"y":435.875,"width":11.40625,"height":28.5},{"selector":".palette-note > span","x":77.625,"y":435.875,"width":11.40625,"height":28.5},{"selector":".palette-note > span","x":133.46875,"y":435.875,"width":11.40625,"height":28.5},{"selector":".palette-note > span","x":189.296875,"y":435.875,"width":11.40625,"height":28.5},{"selector":".palette-note > span","x":245.125,"y":435.875,"width":11.40625,"height":28.5},{"selector":".palette-note > span","x":295.265625,"y":435.875,"width":22.8125,"height":28.5},{"selector":".palette-note > span","x":356.796875,"y":435.875,"width":11.40625,"height":28.5},{"selector":".palette-note small","x":23.890625,"y":469.375,"width":7.203125,"height":18},{"selector":".palette-note small","x":79.71875,"y":469.375,"width":7.203125,"height":18},{"selector":".palette-note small","x":131.96875,"y":469.375,"width":14.40625,"height":18},{"selector":".palette-note small","x":191.390625,"y":469.375,"width":7.203125,"height":18},{"selector":".palette-note small","x":247.21875,"y":469.375,"width":7.203125,"height":18},{"selector":".palette-note small","x":303.0625,"y":469.375,"width":7.203125,"height":18},{"selector":".palette-note small","x":355.296875,"y":469.375,"width":14.40625,"height":18},{"selector":".neck-meta","x":16,"y":536.375,"width":358,"height":53},{"selector":".fret-grid","x":41,"y":625.375,"width":1200,"height":305}],"origin":{"x":8,"y":123}},{"viewport":{"width":501,"height":900},"trigger":{"x":24,"y":408.390625,"width":44,"height":44},"tab":{"x":160.484375,"y":338.390625,"width":109.203125,"height":44},"obstacles":[{"selector":".brand","x":24,"y":20,"width":135.140625,"height":37.5},{"selector":".site-header nav","x":24,"y":64,"width":453,"height":48},{"selector":".workspace-tools","x":24,"y":290.390625,"width":453,"height":44},{"selector":".reference-tabs","x":24,"y":338.390625,"width":453,"height":44},{"selector":".root-select","x":137.484375,"y":392.390625,"width":51.015625,"height":76},{"selector":".scale-select","x":200.5,"y":392.390625,"width":163.015625,"height":76},{"selector":".scale-caption","x":132.890625,"y":470.390625,"width":235.203125,"height":21},{"selector":".palette-note > span","x":78.59375,"y":511.390625,"width":13.8125,"height":34.5},{"selector":".palette-note > span","x":133.59375,"y":511.390625,"width":13.8125,"height":34.5},{"selector":".palette-note > span","x":188.59375,"y":511.390625,"width":13.8125,"height":34.5},{"selector":".palette-note > span","x":243.59375,"y":511.390625,"width":13.8125,"height":34.5},{"selector":".palette-note > span","x":298.59375,"y":511.390625,"width":13.8125,"height":34.5},{"selector":".palette-note > span","x":346.6875,"y":511.390625,"width":27.609375,"height":34.5},{"selector":".palette-note > span","x":408.59375,"y":511.390625,"width":13.8125,"height":34.5},{"selector":".palette-note small","x":81.296875,"y":554.890625,"width":8.40625,"height":21},{"selector":".palette-note small","x":136.296875,"y":554.890625,"width":8.40625,"height":21},{"selector":".palette-note small","x":187.09375,"y":554.890625,"width":16.8125,"height":21},{"selector":".palette-note small","x":246.296875,"y":554.890625,"width":8.40625,"height":21},{"selector":".palette-note small","x":301.296875,"y":554.890625,"width":8.40625,"height":21},{"selector":".palette-note small","x":356.296875,"y":554.890625,"width":8.40625,"height":21},{"selector":".palette-note small","x":407.09375,"y":554.890625,"width":16.8125,"height":21},{"selector":".neck-meta","x":24,"y":628.890625,"width":453,"height":34.5},{"selector":".fret-grid","x":64,"y":1008.578125,"width":1200,"height":305}],"origin":{"x":8,"y":190}},{"viewport":{"width":1440,"height":900},"trigger":{"x":56,"y":628,"width":44,"height":44},"tab":{"x":629.984375,"y":568,"width":109.203125,"height":44},"obstacles":[{"selector":".brand","x":28,"y":26,"width":171.015625,"height":48},{"selector":".site-header nav","x":247.015625,"y":26,"width":225.8125,"height":44},{"selector":".workspace-tools","x":56,"y":520,"width":1328,"height":44},{"selector":".reference-tabs","x":56,"y":568,"width":1328,"height":44},{"selector":".root-select","x":547,"y":612,"width":69,"height":76},{"selector":".scale-select","x":628,"y":612,"width":265,"height":76},{"selector":".scale-caption","x":577.1875,"y":690,"width":285.609375,"height":25.5},{"selector":".palette-note > span","x":515.578125,"y":729.5,"width":15.609375,"height":39},{"selector":".palette-note > span","x":580.578125,"y":729.5,"width":15.609375,"height":39},{"selector":".palette-note > span","x":645.578125,"y":729.5,"width":15.609375,"height":39},{"selector":".palette-note > span","x":710.578125,"y":729.5,"width":15.609375,"height":39},{"selector":".palette-note > span","x":775.578125,"y":729.5,"width":15.609375,"height":39},{"selector":".palette-note > span","x":834.390625,"y":729.5,"width":31.203125,"height":39},{"selector":".palette-note > span","x":908.78125,"y":729.5,"width":15.609375,"height":39},{"selector":".palette-note small","x":518.578125,"y":777.5,"width":9.609375,"height":24},{"selector":".palette-note small","x":583.578125,"y":777.5,"width":9.609375,"height":24},{"selector":".palette-note small","x":643.78125,"y":777.5,"width":19.203125,"height":24},{"selector":".palette-note small","x":713.578125,"y":777.5,"width":9.609375,"height":24},{"selector":".palette-note small","x":778.578125,"y":777.5,"width":9.609375,"height":24},{"selector":".palette-note small","x":845.1875,"y":777.5,"width":9.609375,"height":24},{"selector":".palette-note small","x":906.984375,"y":777.5,"width":19.203125,"height":24},{"selector":".neck-meta","x":56,"y":848.5,"width":1328,"height":31.5},{"selector":".fret-grid","x":96,"y":1129.6875,"width":1200,"height":293}],"origin":{"x":8,"y":680}}];
  for (const scene of scenes) {
    const origin = volumePopoverOrigin({
      trigger: scene.trigger,
      popover: grown,
      viewport: scene.viewport,
      obstacles: scene.obstacles,
    });
    assert.deepEqual(origin, scene.origin);
    const box = { ...origin!, width: grown.width, height: grown.height };
    const root = scene.obstacles.find((item) => item.selector === '.root-select');
    const type = scene.obstacles.find((item) => item.selector === '.scale-select');
    const caption = scene.obstacles.find((item) => item.selector === '.scale-caption');
    const letters = scene.obstacles.filter((item) => item.selector.startsWith('.palette-note'));
    assert.ok(root && type && caption && letters.length > 0);
    for (const obstacle of [scene.tab, root, type, caption, ...letters]) {
      assert.equal(
        boxesOverlap(box, obstacle),
        false,
        `${scene.viewport.width}px popover overlaps a reserved box`,
      );
    }
    assert.ok(box.x < scene.trigger.x + scene.trigger.width);
    assert.ok(box.x + box.width > scene.trigger.x);
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
  assert.deepEqual(origin, { x: 124, y: 572 });
  assert.equal(boxesOverlap(placed(origin), neck), false);
  assert.deepEqual(
    volumePopoverOrigin({
      trigger: { x: 360, y: 100, width: 44, height: 44 },
      popover,
      viewport: { width: 390, height: 844 },
      neck: null,
    }),
    { x: 162, y: 152 },
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
    /\.drone-toggle,\n\.drone-volume-trigger,\n\.drone-walk \{[^}]*min-width:\s*44px/,
  );
  assert.match(css, /min-height:\s*44px/);
  assert.match(
    css,
    /\.drone-toggle svg,\n\.drone-volume-trigger svg,\n\.drone-walk svg \{[^}]*width:\s*18px/,
  );
  assert.match(css, /height:\s*18px/);
  assert.match(css, /border:\s*1px solid var\(--border\)/);
  assert.match(css, /outline:\s*2px solid var\(--green\)/);
  assert.match(
    css,
    /\.drone-sound-options label:has\(input:focus-visible\)/,
  );
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
  const volumeButton = view.slice(
    view.indexOf('id="drone-volume-trigger"'),
    view.indexOf('id="drone-toggle"'),
  );
  const toggle = view.slice(view.indexOf('id="drone-toggle"'));
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
  assert.match(view, /VOLUME_POPOVER_OBSTACLE_SELECTORS/);
  assert.match(view, /addEventListener\('scroll', onScroll, true\)/);
  assert.match(
    view,
    /closest\(\s*'#drone-volume-popover, #drone-volume-trigger'\s*\)/,
  );
  assert.match(view, /min=\{0\}/);
  assert.match(view, /max=\{1\}/);
  assert.doesNotMatch(view, /aria-modal/);
  assert.doesNotMatch(view, /createPortal/);
  assert.match(
    view,
    /id="drone-volume-trigger"[\s\S]*<DroneVolumePopover[\s\S]*id="drone-toggle"/,
  );
  assert.match(view, /setTimeout\(\(\) => \{\s*leaveTimer\.current = null;/);
  assert.match(view, /setTimeout\(\(\) => \{\s*returnTimer\.current = null;/);
  assert.ok(VOLUME_POPOVER_OBSTACLE_SELECTORS.includes('.scale-caption'));
  assert.ok(VOLUME_POPOVER_OBSTACLE_SELECTORS.includes('.palette-note small'));
});
