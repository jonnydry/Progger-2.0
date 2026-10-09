import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colorChoices, matchScales, parseProgression } from '../lib/harmony.ts';
import {
  MATCH_STARTERS,
  PROGRESSION_PLACEHOLDER,
} from '../lib/match-starters.ts';
import { matchLead } from '../lib/match-presentation.ts';

void test('the progression placeholder reads as an example', () => {
  assert.equal(PROGRESSION_PLACEHOLDER, 'e.g. Am F C G');
  assert.match(PROGRESSION_PLACEHOLDER, /^e\.g\. /);
});

void test('the blues starter has no shared scale, so A minor blues leads', () => {
  const starter = MATCH_STARTERS.find((item) => item.chords === 'A7 D7 E7');
  assert.ok(starter);
  const parsed = parseProgression(starter.chords);
  assert.deepEqual(parsed.errors, []);
  const shared = matchScales(parsed.chords, starter.home);
  const colors = colorChoices(parsed.chords, starter.home);
  assert.equal(shared.length, 0);
  assert.equal(matchLead(shared.length, colors.length), 'color');
  assert.equal(colors[0]?.candidate.root, 'A');
  assert.equal(colors[0]?.candidate.scale.id, 'minor-blues');
});

void test('a shared scale still leads when a colour suggestion also exists', () => {
  const parsed = parseProgression('Am F C G');
  assert.deepEqual(parsed.errors, []);
  const shared = matchScales(parsed.chords, '');
  const colors = colorChoices(parsed.chords, '');
  assert.ok(shared.length > 0);
  assert.ok(colors.length > 0);
  assert.equal(matchLead(shared.length, colors.length), 'shared');
});

void test('local chords lead when neither a shared scale nor a colour exists', () => {
  assert.equal(matchLead(0, 0), 'local');
});
