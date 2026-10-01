import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patterns, SCALES, spell } from '../lib/music.ts';
import {
  formAtFret,
  formAtViewport,
  formLayers,
  scrollToForm,
  scrollToCenter,
  viewportCenter,
} from '../lib/connected-neck.ts';

const dorian = patterns(
  spell('A', SCALES.find((scale) => scale.id === 'dorian')!.formula),
);
const start5 = dorian.findIndex((form) => form.start === 5);
const start7 = dorian.findIndex((form) => form.start === 7);

void test('a moving view follows neighboring complete forms with stable boundaries', () => {
  assert.equal(formAtFret(dorian, 7.5, start5), start5);
  assert.equal(formAtFret(dorian, 8.6, start5), start5);
  assert.equal(formAtFret(dorian, 9, start5), start7);
  assert.equal(formAtFret(dorian, 8.5, start7), start7);
  assert.equal(formAtFret(dorian, 7.5, start7), start5);
  assert.equal(formAtFret(dorian, 24, start5), dorian.length - 1);
  assert.equal(formAtFret(dorian, 0, start5), 0);
  assert.equal(formAtFret([], 12, 0), -1);
});

void test('real viewport travel reaches every complete form at mobile and desktop widths', () => {
  for (const [width, cell] of [
    [240, 72],
    [480, 48],
    [960, 60],
    [960, 160],
  ]) {
    for (const left of [false, true]) {
      const travel = 25 * cell - width;
      let active = -1;
      const visited = new Set<number>();
      for (let step = 0; step <= 1000; step++) {
        const progress = step / 1000;
        active = formAtViewport(
          dorian,
          (left ? 1 - progress : progress) * travel,
          width,
          cell,
          left,
          active,
        );
        visited.add(active);
        if (step === 0) assert.equal(active, 0);
        if (step === 1000) assert.equal(active, dorian.length - 1);
      }
      assert.deepEqual(
        [...visited],
        dorian.map((_, index) => index),
      );
      for (let index = 0; index < dorian.length; index++) {
        const scroll = scrollToForm(dorian, index, width, cell, left);
        assert.equal(
          formAtViewport(dorian, scroll, width, cell, left, index),
          index,
        );
        // A one-pixel move after explicitly selecting a form must not replace it.
        assert.equal(
          formAtViewport(
            dorian,
            Math.min(travel, scroll + 1),
            width,
            cell,
            left,
            index,
          ),
          index,
        );
      }
    }
  }
});

void test('overlap preserves each full form and counts shared physical notes', () => {
  const layers = formLayers(dorian[start5], dorian[start7]);
  assert.equal(layers.active.size, 18);
  assert.equal(layers.neighbor.size, 18);
  assert.equal(layers.shared.size, 12);
  assert.deepEqual(
    [...layers.shared].filter((key) => key.startsWith('0:')),
    ['0:7', '0:8'],
  );
  assert.equal(layers.shared.has('0:5'), false);
  const pentatonic = patterns(
    spell(
      'A',
      SCALES.find((scale) => scale.id === 'minor-pentatonic')!.formula,
    ),
  );
  const form3 = pentatonic.findIndex((form) => form.start === 3);
  assert.equal(pentatonic[form3].min, 2);
  assert.equal(pentatonic[form3].max, 5);
  assert.equal(
    formLayers(pentatonic[form3], pentatonic[form3 + 1]).shared.size,
    6,
  );
  assert.equal(formLayers(dorian[0]).shared.size, 0);
});

void test('centering is mirrored and clamps the viewport at both neck boundaries', () => {
  assert.equal(scrollToCenter(7.5, 480, 48, false), 144);
  assert.equal(viewportCenter(144, 480, 48, false), 7.5);
  assert.equal(scrollToCenter(7.5, 480, 48, true), 576);
  assert.equal(viewportCenter(576, 480, 48, true), 7.5);
  assert.equal(scrollToCenter(0, 240, 48, false), 0);
  assert.equal(scrollToCenter(24, 240, 48, false), 960);
  assert.equal(scrollToCenter(0, 240, 48, true), 960);
  assert.equal(scrollToCenter(24, 240, 48, true), 0);
});
