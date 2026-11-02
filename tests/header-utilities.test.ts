import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Stash, Scene and the theme key are one row of 44px keys. A margin on the
 * Appearance group lifts Scene and the theme key above Stash on a phone,
 * which is the misalignment this locks out.
 */
void test('the phone header keys share one centre line and one gap', () => {
  const picker = stripCssComments(
    readFileSync(new URL('../app/scene-picker.css', import.meta.url), 'utf8'),
  );
  const tray = stripCssComments(
    readFileSync(new URL('../app/practice-tray.css', import.meta.url), 'utf8'),
  );
  /* Every rule that styles the group itself, not a key inside it. */
  const groupRules = [
    ...picker.matchAll(/([^{}]*)\{([^{}]*)\}/g),
  ].filter(([, selectors]) =>
    selectors
      .split(',')
      .some((selector) => selector.trim().endsWith('.appearance-controls')),
  );
  assert.ok(groupRules.length > 0, 'the Appearance group has rules');
  for (const [, selectors, body] of groupRules) {
    assert.equal(
      /margin-(top|bottom|block)/.test(body),
      false,
      `vertical margin on ${selectors.trim()}`,
    );
    for (const [, value] of body.matchAll(/(?:^|[;\s])margin:\s*([^;]+);/g)) {
      assert.equal(
        value.trim(),
        '0 0 0 auto',
        `only the auto inline-start margin on ${selectors.trim()}`,
      );
    }
  }
  assert.match(tray, /\.header-utilities \{[^}]*align-items: center/);
  assert.match(
    picker,
    /@media \(max-width: 500px\) \{\s*\.night-swim \.header-utilities,\s*\.appearance-controls \{\s*gap: 5px;/,
    'Stash keeps the same gap to Scene as Scene keeps to the theme key',
  );
});
