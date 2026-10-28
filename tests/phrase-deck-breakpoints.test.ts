import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DECK_BREAKPOINT_PX,
  DECK_BREAKPOINT_QUERY,
} from '../lib/deck-breakpoints.ts';

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Text between `@media` and the opening brace of that rule. */
function mediaPreludes(css: string): string[] {
  const source = stripCssComments(css);
  const preludes: string[] = [];
  for (const match of source.matchAll(/@media\b/g)) {
    const start = match.index + match[0].length;
    let depth = 0;
    let prelude = '';
    for (let index = start; index < source.length; index += 1) {
      const char = source[index];
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === '{' && depth === 0) break;
      prelude += char;
    }
    preludes.push(prelude.trim());
  }
  return preludes;
}

function widthConditionsIn(css: string): string[] {
  return mediaPreludes(css).flatMap((prelude) =>
    [
      ...prelude.matchAll(
        /\b(min-width|max-width|width)\s*(:|>=|<=|>|<)\s*(\d+)px/g,
      ),
    ].map((match) => {
      const feature = match[1];
      const operator = match[2] === ':' ? ': ' : ` ${match[2]} `;
      return `${feature}${operator}${match[3]}px`;
    }),
  );
}

void test('width media parsing ignores comments and sees every width feature', () => {
  assert.deepEqual(
    widthConditionsIn('/* @media (max-width: 960px) { .x { color: red } } */'),
    [],
  );
  assert.deepEqual(
    widthConditionsIn('@media screen and (min-width: 961px) { .x {} }'),
    ['min-width: 961px'],
  );
  assert.deepEqual(widthConditionsIn('@media (width >= 960px) { .x {} }'), [
    'width >= 960px',
  ]);
  assert.deepEqual(
    widthConditionsIn(
      '@media (max-width:420px) and (min-width: 100px) { .x {} }',
    ),
    ['max-width: 420px', 'min-width: 100px'],
  );
});

void test('deck stylesheets use the shared breakpoint widths', () => {
  const deck = readFileSync(
    new URL('../app/phrase-deck.css', import.meta.url),
    'utf8',
  );
  const tokens = readFileSync(
    new URL('../app/deck-tokens.css', import.meta.url),
    'utf8',
  );
  const phrase = readFileSync(
    new URL('../app/phrase.css', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const expected = Object.values(DECK_BREAKPOINT_PX)
    .map((px) => `max-width: ${px}px`)
    .sort();
  assert.deepEqual(widthConditionsIn(deck).sort(), expected);
  assert.deepEqual(widthConditionsIn(tokens), []);
  assert.deepEqual(widthConditionsIn(phrase), []);
  for (const px of Object.values(DECK_BREAKPOINT_PX)) {
    assert.equal(
      Object.values(DECK_BREAKPOINT_QUERY).includes(`(max-width: ${px}px)`),
      true,
      `${px}`,
    );
  }
  assert.match(panel, /import '@\/app\/phrase\.css'/);
  assert.match(panel, /import '@\/app\/phrase-deck\.css'/);
  assert.match(panel, /DECK_BREAKPOINT_QUERY\.phone/);
  assert.equal(panel.includes('(max-width:'), false);
});

/**
 * The compact deck is one plate: the settings and the four Build pins share a
 * single grid, and each pin is one `legend | options` line of it. These rules
 * are what keep the deck short without breaking tab order, so they are locked
 * here rather than left to a screenshot.
 */
void test('the deck keeps the pins inside the plate as one-line rows', () => {
  const deck = readFileSync(
    new URL('../app/phrase-deck.css', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const plate = /\.deck-plate \{([\s\S]*?)\n\}/.exec(deck)?.[1] ?? '';
  assert.match(plate, /grid-template-areas:[^;]*'pins pins pins pins'/);
  assert.match(deck, /\.phrase-pins \{[^}]*grid-area: pins/);
  /* A fieldset legend cannot take a layout track, so it is positioned over the
     row's own gutter. If it ever goes back into the grid the options collapse
     to one column and every pin clips. */
  assert.match(
    deck,
    /\.phrase-pin-row > \.deck-legend \{[^}]*position: absolute/,
  );
  /* One transport line on desktop, not a stacked 68px key. */
  assert.match(
    deck,
    /\.phrase-deck \.deck-key \{[^}]*min-height: var\(--deck-row\)/,
  );
  assert.equal(
    (panel.match(/<PhrasePins/g) ?? []).length,
    1,
    'the pins render once, inside the plate',
  );
  assert.match(
    panel,
    /<div className="deck-plate">[\s\S]*<PhrasePins[\s\S]*<\/div>/,
  );
  /* Short row names that already existed in code, now used. */
  for (const label of ['Contour', 'Rhythm', 'Register', 'Lands on']) {
    assert.match(panel, new RegExp(`label: '${label}'`), label);
  }
  assert.equal(
    panel.includes('Pin the shape'),
    false,
    'pin rows use short names',
  );
});
