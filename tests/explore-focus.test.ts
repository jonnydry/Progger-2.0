import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scaleReturnFocusId } from '../lib/explore-focus.ts';

void test('the scales tab does not move focus without a chord preview', () => {
  assert.equal(scaleReturnFocusId(null, 'scales-reference-tab'), null);
});

void test('Back moves to the scales tab when no chord preview was stored', () => {
  assert.equal(
    scaleReturnFocusId(null, 'return-to-scale'),
    'scales-reference-tab',
  );
});

void test('returning from a chord preview restores the control that opened it', () => {
  assert.equal(
    scaleReturnFocusId({ id: 'scale-chord-2', scroll: 480 }, 'return-to-scale'),
    'scale-chord-2',
  );
});

void test('a preview opened without an identified control returns to main', () => {
  assert.equal(
    scaleReturnFocusId({ id: 'main-content', scroll: 0 }),
    'main-content',
  );
});
