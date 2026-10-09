import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROGRESSION_PLACEHOLDER } from '../lib/match-starters.ts';

function channel(hex: string, index: number) {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

function linear(value: number) {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  return (
    0.2126 * linear(channel(hex, 0)) +
    0.7152 * linear(channel(hex, 1)) +
    0.0722 * linear(channel(hex, 2))
  );
}

function contrast(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

const practice = readFileSync(
  new URL('../app/practice-view.css', import.meta.url),
  'utf8',
);
const globals = readFileSync(
  new URL('../app/globals.css', import.meta.url),
  'utf8',
);
const day = readFileSync(
  new URL('../app/day-swim.css', import.meta.url),
  'utf8',
);
const scenes = readFileSync(
  new URL('../app/scene-palettes.css', import.meta.url),
  'utf8',
);

void test('the progression example stays an example in the scene quiet ink', () => {
  assert.equal(PROGRESSION_PLACEHOLDER, 'e.g. Am F C G');
  assert.equal(globals.includes('textarea::placeholder'), false);
  assert.match(
    day,
    /textarea::placeholder \{\n  color: var\(--quiet\);\n  opacity: 1;\n\}/,
  );
  assert.match(
    scenes,
    /textarea::placeholder \{\n  color: var\(--quiet\);\n  opacity: 1;\n\}/,
  );
  assert.doesNotMatch(day, /textarea::placeholder \{[^}]*color-mix/);
  assert.doesNotMatch(scenes, /textarea::placeholder \{[^}]*color-mix/);
  const quietOnField = [
    ['#546357', '#fff8e9'],
    ['#405348', '#fff8e9'],
    ['#a2b9c4', '#102330'],
    ['#4d6967', '#fbfcf5'],
    ['#c1adca', '#22192e'],
    ['#765e79', '#fff9fd'],
  ];
  for (const [ink, field] of quietOnField) {
    assert.ok(
      contrast(ink, field) >= 4.5,
      `${ink} on ${field} is ${contrast(ink, field).toFixed(2)}`,
    );
  }
});

void test('practice neck marks stay in each scene and clear 3:1', () => {
  assert.match(
    practice,
    /html\[data-scene='pond'\] \.night-swim\.practice-view \.string-line \{\n  background: #b7ad96;/,
  );
  assert.match(
    practice,
    /html\[data-scene='pond'\]\[data-theme='day'\][\s\S]*?background: #4d5c46;/,
  );
  assert.match(
    practice,
    /html\[data-scene='pond'\]\[data-theme='day'\][\s\S]*?border-color: #4d5c46;/,
  );
  assert.match(practice, /border-color: #8d9aaa;/);
  assert.doesNotMatch(
    practice,
    /(^|\n)\.night-swim\.practice-view \.string-line \{/,
  );
  for (const color of ['#4d5c46', '#8d9aaa', '#b7ad96', '#7d806e']) {
    const hits = [...practice.matchAll(new RegExp(color, 'g'))];
    assert.ok(hits.length > 0, color);
    for (const hit of hits) {
      assert.match(
        practice.slice(Math.max(0, hit.index - 220), hit.index),
        /data-scene='pond'/,
        `${color} leaked outside the pond practice rules`,
      );
    }
  }
  assert.match(practice, /background: var\(--scene-string\);/);
  assert.match(practice, /background: var\(--quiet\);/);
  assert.match(practice, /border-color: var\(--quiet\);/);

  const marks = [
    {
      name: 'pond night string',
      color: '#b7ad96',
      backgrounds: ['#050c18', '#09131d'],
    },
    {
      name: 'pond night fret',
      color: '#7d806e',
      backgrounds: ['#050c18', '#09131d'],
    },
    {
      name: 'pond night context',
      color: '#8d9aaa',
      backgrounds: ['#050c18', '#09131d'],
    },
    {
      name: 'pond day neck',
      color: '#4d5c46',
      backgrounds: ['#fff5df', '#e8edd7'],
    },
    {
      name: 'pond day nut',
      color: '#226347',
      backgrounds: ['#fff5df', '#e8edd7'],
    },
    {
      name: 'tidepool night string',
      color: '#69818d',
      backgrounds: ['#081522', '#102632'],
    },
    {
      name: 'tidepool night context',
      color: '#a2b9c4',
      backgrounds: ['#081522', '#102632'],
    },
    {
      name: 'tidepool day neck',
      color: '#4d6967',
      backgrounds: ['#f3f7ee', '#e0ece1', '#e8edd7'],
    },
    {
      name: 'twilight night string',
      color: '#897395',
      backgrounds: ['#160f21', '#271b35'],
    },
    {
      name: 'twilight night context',
      color: '#c1adca',
      backgrounds: ['#160f21', '#271b35'],
    },
    {
      name: 'twilight day neck',
      color: '#765e79',
      backgrounds: ['#faf2f8', '#eee0ed', '#e8edd7'],
    },
  ];
  for (const mark of marks) {
    for (const background of mark.backgrounds) {
      const ratio = contrast(mark.color, background);
      assert.ok(
        ratio >= 3,
        `${mark.name} ${mark.color} on ${background} is ${ratio.toFixed(2)}`,
      );
    }
  }
});
