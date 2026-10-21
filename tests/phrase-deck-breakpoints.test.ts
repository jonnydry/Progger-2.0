import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DECK_BREAKPOINT_PX,
  DECK_BREAKPOINT_QUERY,
} from '../lib/deck-breakpoints.ts';

function mediaMaxWidths(css: string): number[] {
  return [...css.matchAll(/@media\s*\(\s*max-width:\s*(\d+)px\s*\)/g)].map(
    (match) => Number(match[1]),
  );
}

void test('deck stylesheets use the shared breakpoint widths', () => {
  const deck = readFileSync(
    new URL('../app/phrase-deck.css', import.meta.url),
    'utf8',
  );
  const tokens = readFileSync(
    new URL('../app/deck-tokens.css', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const widths = Object.values(DECK_BREAKPOINT_PX);
  assert.deepEqual(
    mediaMaxWidths(deck).sort((a, b) => a - b),
    [...widths].sort((a, b) => a - b),
  );
  assert.deepEqual(mediaMaxWidths(tokens), []);
  assert.equal(deck.includes('@media (min-width'), false);
  assert.equal(tokens.includes('@media (min-width'), false);
  for (const px of widths) {
    assert.equal(
      Object.values(DECK_BREAKPOINT_QUERY).includes(`(max-width: ${px}px)`),
      true,
      `${px}`,
    );
  }
  assert.match(panel, /DECK_BREAKPOINT_QUERY\.phone/);
  assert.match(panel, /DECK_BREAKPOINT_QUERY\.stacked/);
  assert.match(panel, /DECK_BREAKPOINT_QUERY\.mid/);
  assert.equal(panel.includes('(max-width:'), false);
});
