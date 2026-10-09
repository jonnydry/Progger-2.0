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
const night = readFileSync(
  new URL('../app/night-swim.css', import.meta.url),
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

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function topLevelRules(css: string) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selector: string; body: string }[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('{', cursor);
    if (open < 0) break;
    const selector = normalize(source.slice(cursor, open));
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      if (source[index] === '}') depth -= 1;
      index += 1;
    }
    if (selector && !selector.startsWith('@'))
      rules.push({ selector, body: source.slice(open + 1, index - 1) });
    cursor = index;
  }
  return rules;
}

function selectorList(selector: string) {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of selector) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(normalize(current));
      current = '';
    } else current += char;
  }
  if (current.trim()) parts.push(normalize(current));
  return parts;
}

function ruleBody(css: string, selector: string) {
  const wanted = normalize(selector);
  const rule = topLevelRules(css).find((item) =>
    selectorList(item.selector).includes(wanted),
  );
  assert.ok(rule, selector);
  return rule.body;
}

function declarations(body: string) {
  const props: Record<string, string> = {};
  for (const part of body.split(';')) {
    const split = part.indexOf(':');
    if (split < 0) continue;
    const name = part.slice(0, split).trim();
    const value = part.slice(split + 1).trim();
    if (name) props[name] = value;
  }
  return props;
}

function decl(css: string, selector: string, property: string) {
  const value = declarations(ruleBody(css, selector))[property];
  assert.ok(value, `${selector} ${property}`);
  return value;
}

function paint(value: string, behind: string) {
  const match = value.trim().match(/^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/);
  assert.ok(match, value);
  const opaque = `#${match[1].toLowerCase()}`;
  if (!match[2]) return opaque;
  const alpha = Number.parseInt(match[2], 16) / 255;
  const mixed = [0, 1, 2].map((index) =>
    Math.round(
      channel(opaque, index) * alpha + channel(behind, index) * (1 - alpha),
    ),
  );
  return `#${mixed.map((part) => part.toString(16).padStart(2, '0')).join('')}`;
}

function concrete(value: string, scope: Record<string, string>) {
  const reference = value.match(/^var\((--[\w-]+)\)$/);
  if (!reference) {
    const hex = value.match(/#[0-9a-fA-F]{6}/);
    assert.ok(hex, value);
    return hex[0].toLowerCase();
  }
  const next = scope[reference[1]];
  assert.ok(next, reference[1]);
  return concrete(next, scope);
}

function apply(
  scope: Record<string, string>,
  css: string,
  selector: string,
) {
  const next = { ...scope };
  for (const [name, value] of Object.entries(
    declarations(ruleBody(css, selector)),
  )) {
    if (!name.startsWith('--')) continue;
    next[name] = value.startsWith('var(') ? concrete(value, next) : value;
  }
  return next;
}

const sceneWater =
  "html:is([data-scene='tidepool'], [data-scene='twilight'])";
const sceneField = `${sceneWater} .night-swim .chord-entry textarea`;
const scenePlaceholder = `${sceneField}::placeholder`;
const dayField =
  "html[data-theme='day'] .night-swim .chord-entry textarea";
const dayPlaceholder = `${dayField}::placeholder`;
const nightField = '.night-swim .chord-entry textarea';
const nightPlaceholder = `${nightField}::placeholder`;

void test('the progression placeholder stays an example and clears every scene field', () => {
  assert.equal(PROGRESSION_PLACEHOLDER, 'e.g. Am F C G');
  assert.equal(globals.includes('textarea::placeholder'), false);
  for (const css of [night, day, scenes]) {
    assert.doesNotMatch(css, /textarea::placeholder \{[^}]*color-mix/);
    assert.match(css, /textarea::placeholder \{[^}]*opacity: 1;/);
  }
  const pondNight = apply({}, night, ':root');
  const pondDay = apply(
    apply({}, day, "html[data-theme='day']"),
    day,
    "html[data-theme='day'] .reference-water",
  );
  const tidepoolNight = apply(
    apply(
      apply({}, scenes, "html[data-scene='tidepool']"),
      scenes,
      sceneWater,
    ),
    scenes,
    `${sceneWater} .reference-water`,
  );
  const tidepoolDay = apply(
    apply(
      apply({}, scenes, "html[data-scene='tidepool'][data-theme='day']"),
      scenes,
      sceneWater,
    ),
    scenes,
    `${sceneWater} .reference-water`,
  );
  const twilightNight = apply(
    apply(
      apply({}, scenes, "html[data-scene='twilight']"),
      scenes,
      sceneWater,
    ),
    scenes,
    `${sceneWater} .reference-water`,
  );
  const twilightDay = apply(
    apply(
      apply({}, scenes, "html[data-scene='twilight'][data-theme='day']"),
      scenes,
      sceneWater,
    ),
    scenes,
    `${sceneWater} .reference-water`,
  );
  const pairs: [string, string, string, Record<string, string>][] = [
    ['pond night', decl(night, nightPlaceholder, 'color'), decl(night, nightField, 'background'), pondNight],
    ['pond day', decl(day, dayPlaceholder, 'color'), decl(day, dayField, 'background'), pondDay],
    ['tidepool night', decl(scenes, scenePlaceholder, 'color'), decl(scenes, sceneField, 'background'), tidepoolNight],
    ['tidepool day', decl(scenes, scenePlaceholder, 'color'), decl(scenes, sceneField, 'background'), tidepoolDay],
    ['twilight night', decl(scenes, scenePlaceholder, 'color'), decl(scenes, sceneField, 'background'), twilightNight],
    ['twilight day', decl(scenes, scenePlaceholder, 'color'), decl(scenes, sceneField, 'background'), twilightDay],
  ];
  assert.equal(pairs.length, 6);
  for (const [name, inkValue, fieldValue, scope] of pairs) {
    const ink = concrete(inkValue, scope);
    const field = concrete(fieldValue, scope);
    assert.equal(
      ink === '#546357' && field === '#fff8e9',
      false,
      `${name} used the unrendered root quiet`,
    );
    const ratio = contrast(ink, field);
    assert.ok(ratio >= 4.5, `${name} ${ink} on ${field} is ${ratio.toFixed(2)}`);
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

  const pondNight = apply({}, night, ':root');
  const pondDay = apply({}, day, "html[data-theme='day']");
  const pondPractice = "html[data-scene='pond'] .night-swim.practice-view";
  const pondDayPractice =
    "html[data-scene='pond'][data-theme='day'] .night-swim.practice-view";
  const pondInk = concrete(pondNight['--ink'], pondNight);
  const pondOpen = paint(
    decl(night, '.night-swim .open-string .string-cell', 'background'),
    pondInk,
  );
  const dayOpen = concrete(
    decl(
      day,
      "html[data-theme='day'] .night-swim .open-string .string-cell",
      'background',
    ),
    pondDay,
  );
  const practiceScene =
    "html:is([data-scene='tidepool'], [data-scene='twilight']) .night-swim.practice-view";
  const practiceDay =
    "html:is([data-scene='tidepool'], [data-scene='twilight'])[data-theme='day'] .night-swim.practice-view";
  const sceneString = decl(practice, `${practiceScene} .string-line`, 'background');
  const sceneQuiet = decl(
    practice,
    `${practiceScene} .connected-neck .fret-grid .note-dot.connection-context:not(.is-root)`,
    'border-color',
  );
  const dayQuiet = decl(practice, `${practiceDay} .string-line`, 'background');
  const sceneNut = decl(
    practice,
    `${practiceScene} .open-string .string-cell`,
    'border-right-color',
  );
  const dayNut = decl(
    practice,
    `${practiceDay} .open-string .string-cell`,
    'border-right-color',
  );
  const pondNut = decl(
    practice,
    "html[data-scene='pond'][data-theme='day'] .night-swim.practice-view .open-string .string-cell",
    'border-right-color',
  );

  function sceneNeck(scene: 'tidepool' | 'twilight', dayTheme: boolean) {
    const root = `html[data-scene='${scene}']${dayTheme ? "[data-theme='day']" : ''}`;
    return apply(apply({}, scenes, root), scenes, sceneWater);
  }

  function surfaces(scope: Record<string, string>, extra: string[] = []) {
    return [scope['--background'], scope['--scene-open'], ...extra]
      .filter((value): value is string => Boolean(value))
      .map((value) => concrete(value, scope));
  }

  const tidepoolNight = sceneNeck('tidepool', false);
  const tidepoolDay = sceneNeck('tidepool', true);
  const twilightNight = sceneNeck('twilight', false);
  const twilightDay = sceneNeck('twilight', true);
  const pondDayInk = concrete(pondDay['--background'], pondDay);
  const marks = [
    {
      name: 'pond night string',
      color: decl(practice, `${pondPractice} .string-line`, 'background'),
      backgrounds: [pondInk, pondOpen],
    },
    {
      name: 'pond night fret',
      color: decl(practice, `${pondPractice} .string-cell`, 'border-right-color'),
      backgrounds: [pondInk],
    },
    {
      name: 'pond night context',
      color: decl(
        practice,
        `${pondPractice} .connected-neck .fret-grid .note-dot.connection-context:not(.is-root)`,
        'border-color',
      ),
      backgrounds: [pondInk, pondOpen],
    },
    {
      name: 'pond day string',
      color: decl(practice, `${pondDayPractice} .string-line`, 'background'),
      backgrounds: [pondDayInk, dayOpen],
    },
    {
      name: 'pond day fret',
      color: decl(
        practice,
        `${pondDayPractice} .string-cell`,
        'border-right-color',
      ),
      backgrounds: [pondDayInk, dayOpen],
    },
    {
      name: 'pond day context',
      color: decl(
        practice,
        `${pondDayPractice} .connected-neck .fret-grid .note-dot.connection-context:not(.is-root)`,
        'border-color',
      ),
      backgrounds: [pondDayInk, dayOpen],
    },
    {
      name: 'pond day nut',
      color: concrete(pondNut, pondDay),
      backgrounds: [concrete(pondDay['--background'], pondDay), dayOpen],
    },
    {
      name: 'tidepool night string',
      color: concrete(sceneString, tidepoolNight),
      backgrounds: surfaces(tidepoolNight),
    },
    {
      name: 'tidepool night context',
      color: concrete(sceneQuiet, tidepoolNight),
      backgrounds: surfaces(tidepoolNight),
    },
    {
      name: 'tidepool night nut',
      color: concrete(sceneNut, tidepoolNight),
      backgrounds: surfaces(tidepoolNight),
    },
    {
      name: 'tidepool day neck',
      color: concrete(dayQuiet, tidepoolDay),
      backgrounds: surfaces(tidepoolDay),
    },
    {
      name: 'tidepool day nut',
      color: concrete(dayNut, tidepoolDay),
      backgrounds: surfaces(tidepoolDay),
    },
    {
      name: 'twilight night string',
      color: concrete(sceneString, twilightNight),
      backgrounds: surfaces(twilightNight),
    },
    {
      name: 'twilight night context',
      color: concrete(sceneQuiet, twilightNight),
      backgrounds: surfaces(twilightNight),
    },
    {
      name: 'twilight night nut',
      color: concrete(sceneNut, twilightNight),
      backgrounds: surfaces(twilightNight),
    },
    {
      name: 'twilight day neck',
      color: concrete(dayQuiet, twilightDay),
      backgrounds: surfaces(twilightDay),
    },
    {
      name: 'twilight day nut',
      color: concrete(dayNut, twilightDay),
      backgrounds: surfaces(twilightDay),
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
