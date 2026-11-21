import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PhrasePanel as PhrasePanelComponent } from '../components/phrase-panel.tsx';
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
 * These source rules keep the deck readable without breaking tab order, so
 * they are locked here rather than left to a screenshot.
 */
void test('the deck leads with play and keeps build folded', () => {
  const deck = readFileSync(
    new URL('../app/phrase-deck.css', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  assert.match(panel, /className="deck-transport"/);
  // Cassette bay: window is the face; Play legend is sr-only (no visible PLAY chrome).
  assert.ok(panel.includes('className={`deck-window'), 'deck-window className template');
  assert.match(panel, /<h3 className="sr-only">Play<\/h3>/);
  const windowAt = panel.indexOf('className={`deck-window');
  const zoneAt = panel.indexOf('className="deck-zone"');
  assert.ok(windowAt !== -1 && zoneAt !== -1 && windowAt < zoneAt, 'window sits above the keys');
  assert.equal(
    panel.includes('deck-build" open'),
    false,
    'Build is closed until someone opens it',
  );
  assert.equal(
    panel.includes('deck-feel" open'),
    false,
    'Feel? is closed until someone opens it',
  );
  const buildAt = panel.indexOf('<details className="deck-fold deck-build">');
  const feelAt = panel.indexOf('<details className="deck-fold deck-feel">');
  const buildClose = panel.indexOf('</details>', buildAt);
  const feelClose = panel.indexOf('</details>', feelAt);
  assert.ok(
    buildAt !== -1 && feelAt !== -1 && buildClose !== -1 && feelClose !== -1,
  );
  assert.ok(buildClose < feelAt, 'Build closes before Feel? starts');
  const buildSlice = panel.slice(buildAt, buildClose);
  const feelSlice = panel.slice(feelAt, feelClose);
  assert.match(buildSlice, /<PhrasePins/);
  assert.equal(buildSlice.includes('deck-feel'), false);
  assert.match(feelSlice, /deck-seed/);
  assert.match(feelSlice, /<span className="deck-legend">Feel\?<\/span>/);
  assert.equal(
    feelSlice.includes('deck-legend">Tempo'),
    false,
    'the feel fold summary legend is Feel?, not Tempo',
  );
  assert.match(
    panel,
    /className="deck-setting deck-setting-tempo"[\s\S]*?<span className="deck-legend">Tempo<\/span>/,
  );
  assert.match(panel, /className="phrase-pins-hint">\s*Pin any\s*<\/span>/);
  assert.equal(panel.includes('Pin one, re-roll the rest'), false);
  assert.equal(feelSlice.includes('PhrasePins'), false);
  assert.equal(
    (panel.match(/<PhrasePins/g) ?? []).length,
    1,
    'the pins render once, inside Build',
  );
  assert.equal(
    deck.includes('grid-template-areas'),
    false,
    'the plate no longer uses grid areas',
  );
  /* Wide decks pair the pin rows in two equal columns on the same gutter;
     below the plate breakpoint each row fills the full width instead. */
  const pinGrid = deck.match(/\.phrase-pin-grid\s*\{[^}]*\}/);
  assert.ok(pinGrid, 'pin grid rule');
  assert.equal(pinGrid[0].includes('repeat(2'), true);
  assert.match(
    deck,
    /@media \(max-width: 1210px\) \{[\s\S]*?\.phrase-pin-grid \{\s*grid-template-columns: minmax\(0, 1fr\);/,
    'pins drop to one column at the plate breakpoint',
  );
  assert.match(
    deck,
    /@media \(max-width: 860px\) \{[\s\S]*?\.deck-lead \{[\s\S]*?grid-template-columns: repeat\(2/,
    'below wide, lead keys share one row under the window',
  );
  assert.match(
    deck,
    /\.deck-bay \{[\s\S]*?\.deck-window \{[\s\S]*?grid-template-rows:/,
    'cassette window reserves fixed rows so keys below cannot hop',
  );
  assert.match(
    deck,
    /\.phrase-pin \{[^}]*min-width: 44px/,
    'a pin is never narrower than a finger',
  );
  assert.match(
    deck,
    /\.deck-fold-summary \{[^}]*min-height: var\(--deck-row\)/,
  );
  /* A fieldset legend cannot take a layout track, so it is positioned over the
     row's own gutter. If it ever goes back into the grid the options collapse
     to one column and every pin clips. */
  assert.match(
    deck,
    /\.phrase-pin-row > \.deck-legend \{[^}]*position: absolute/,
  );
  assert.match(
    deck,
    /\.phrase-deck \.deck-key \{[^}]*min-height: var\(--deck-row\)/,
  );
  for (const label of ['Contour', 'Rhythm', 'Register', 'Lands on']) {
    assert.match(panel, new RegExp(`label: '${label}'`), label);
  }
  assert.equal(
    panel.includes('Pin the shape'),
    false,
    'pin rows use short names',
  );
});

void test('look polish: lead specificity, reserved pins header, no dead deck code', () => {
  const deck = readFileSync(
    new URL('../app/phrase-deck.css', import.meta.url),
    'utf8',
  );
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const launcher = readFileSync(
    new URL('../components/phrase-launcher.tsx', import.meta.url),
    'utf8',
  );
  /* The lead must outrank `.phrase-deck .deck-key`, not just precede it. */
  assert.match(
    deck,
    /\.phrase-deck \.deck-transport \.deck-key-play,\s*\.phrase-deck \.deck-transport \.deck-key-new \{[^}]*min-height: 52px/,
  );
  assert.match(
    deck,
    /\.phrase-pins-title \{[^}]*min-height: var\(--deck-row\)/,
    'pins header reserves the Clear pins height',
  );
  assert.equal(deck.includes('deck-speed-short'), false);
  assert.equal(panel.includes('deck-speed-short'), false);
  assert.equal(
    panel.includes('useDeckBreakpoints'),
    false,
    'the unused phone state hook is gone; CSS owns the widths',
  );
  assert.match(
    panel,
    /matchMedia\(DECK_BREAKPOINT_QUERY\.phone\)/,
    'seed autofocus still asks the phone width, once, in the gesture',
  );
  assert.match(panel, /aria-describedby="phrase-seed-note"/);
  assert.match(panel, /id="phrase-seed-note"/);
  assert.equal(
    panel.includes('aria-describedby="phrase-seed-help"'),
    false,
    'the seed description is not the changing status line',
  );
  assert.match(panel, /tempo \/ 2 < PHRASE_TEMPO_MIN/);
  assert.equal(
    (panel.match(/half speed, minimum/g) ?? []).length >= 2,
    true,
    'the floored half speed is named in the readout and the slider text',
  );
  assert.match(
    panel,
    /matchMedia\('\(pointer: coarse\)'\)/,
    'seed autofocus also holds off for coarse pointers above phone width',
  );
  assert.match(launcher, /failed \? \(/, 'launcher states are exclusive');
  assert.match(launcher, /onClick=\{retry\}/);
  assert.equal(
    (launcher.match(/setAttempt\(\(current\) => current \+ 1\)/g) ?? []).length,
    2,
    'Retry and the open signal both re-run the load effect',
  );
  assert.match(
    launcher,
    /setFailed\(false\);\s*setPanel\(/,
    'a loaded panel clears the failure',
  );
});

void test('tablature container breakpoints, string contrast, mobile slider handle, and shared disclosure marker rule hold', () => {
  const appDir = new URL('../app/', import.meta.url);
  const phraseCss = readFileSync(new URL('phrase.css', appDir), 'utf8');
  const nightSwim = readFileSync(new URL('night-swim.css', appDir), 'utf8');
  const globals = readFileSync(new URL('globals.css', appDir), 'utf8');

  // Tablature uses @container phrase-tab at 1120px (2-col 4-bar) and 640px (1-col phone).
  assert.match(phraseCss, /container-name:\s*phrase-tab;/);
  assert.match(phraseCss, /@container\s+phrase-tab\s*\(max-width:\s*1120px\)/);
  assert.match(phraseCss, /@container\s+phrase-tab\s*\(max-width:\s*640px\)/);

  // Tablature string lines keep full --quiet contrast (matching main's 5.87:1 day contrast).
  assert.match(
    phraseCss,
    /\.phrase-string-line\s*\{[^}]*background:\s*var\(--quiet\);/,
  );

  // Mobile (<=500px) and coarse-pointer neck-slider thumbs are at least 44x44.
  const phoneMediaStart = nightSwim.indexOf('@media (max-width: 500px)');
  assert.ok(phoneMediaStart !== -1, 'missing @media (max-width: 500px) in night-swim.css');
  const phoneSlice = nightSwim.slice(phoneMediaStart, phoneMediaStart + 3500);
  for (const pseudo of ['::-webkit-slider-thumb', '::-moz-range-thumb']) {
    const match = new RegExp(
      `\\.neck-slider\\s+input${pseudo}\\s*\\{([^}]*)\\}`,
    ).exec(phoneSlice);
    assert.ok(match, `missing mobile ${pseudo} rule in @media (max-width: 500px)`);
    assert.match(match[1], /width:\s*44px;/);
    assert.match(match[1], /height:\s*44px;/);
  }
  assert.match(nightSwim, /@media\s*\(pointer:\s*coarse\)[\s\S]*?\.neck-slider\s+input::-webkit-slider-thumb/);

  // Native disclosure triangles are hidden by one shared rule in globals.css across every app/*.css file.
  assert.match(
    globals,
    /details:not\(\.note-spelling\)\s*>\s*summary::-webkit-details-marker\s*\{\s*display:\s*none;\s*\}/,
  );
  assert.equal(
    (globals.match(/::-webkit-details-marker/g) ?? []).length,
    1,
    'globals.css should define the shared disclosure marker rule once',
  );
  assert.equal(
    (globals.match(/summary::marker/g) ?? []).length,
    1,
    'globals.css should define summary::marker once',
  );
  for (const file of readdirSync(appDir)) {
    if (!file.endsWith('.css') || file === 'globals.css') continue;
    const css = readFileSync(new URL(file, appDir), 'utf8');
    assert.equal(
      css.includes('::-webkit-details-marker'),
      false,
      `${file} should not duplicate ::-webkit-details-marker rules`,
    );
    assert.equal(
      css.includes('summary::marker'),
      false,
      `${file} should not duplicate summary::marker rules`,
    );
  }
});

void test('fret 0 reads as open with WCAG 2.5.3 label-in-name, shared wording, and no leftover fret-0 strings', () => {
  const panel = readFileSync(
    new URL('../components/phrase-panel.tsx', import.meta.url),
    'utf8',
  );
  const fretboard = readFileSync(
    new URL('../components/fretboard.tsx', import.meta.url),
    'utf8',
  );
  const voicingBrowser = readFileSync(
    new URL('../components/voicing-browser.tsx', import.meta.url),
    'utf8',
  );
  const neckOverview = readFileSync(
    new URL('../components/neck-overview.tsx', import.meta.url),
    'utf8',
  );

  // Shared helper formats fret 0 as "string N, open (0)" (preserving visible "0" for WCAG 2.5.3)
  // and fretted notes as "string N, fret F".
  assert.match(panel, /function phraseNoteSpot\(/);
  assert.match(panel, /`string \$\{stringNum\}, open \(0\)`/);
  assert.match(panel, /`string \$\{stringNum\}, fret \$\{note\.fret\}`/);
  assert.match(panel, /function phraseNoteText\(/);
  assert.match(panel, /`bar \$\{barNum\}, beat \$\{beatInBar\}`/);
  assert.match(panel, /`landing, beat \$\{beatInBar\}/);

  // Both the fallback sr-only list and interactive tab buttons use phraseNoteText,
  // and the fallback list is aria-hidden while the tab buttons are rendered.
  assert.match(
    panel,
    /<ol[\s\S]*?aria-label="Phrase notes in order"[\s\S]*?aria-hidden=\{dots === 'shown' \? true : undefined\}[\s\S]*?phraseNoteText\(/,
  );
  assert.match(
    panel,
    /const spoken = phraseNoteText\([\s\S]*?aria-label=\{`Play \$\{spoken\}`\}/,
  );

  // Fretboard, Voicing Browser, and Neck Overview also read fret 0 as "open".
  assert.equal(fretboard.includes('string ${6 - string}, fret ${fret}'), false);
  assert.equal(fretboard.includes('active frets {pattern.min}–'), false);
  assert.equal(fretboard.includes('Frets {range[0]}–{range[1]}'), false);
  assert.equal(
    fretboard.includes('`Frets ${range[0]} through ${range[1]} of 24`'),
    true,
  );
  assert.match(fretboard, /`open–\$\{pattern\.max\}`/);
  assert.match(fretboard, /`open–\$\{range\[1\]\}`/);
  assert.match(fretboard, /`Frets open through \$\{range\[1\]\} of 24`/);
  assert.match(
    fretboard,
    /string \$\{6 - string\}, \$\{fret === 0 \? 'open' : `fret \$\{fret\}`\}/,
  );
  assert.equal(voicingBrowser.includes("'0 (nut)'"), false);
  assert.match(voicingBrowser, /'Open \(nut\)'/);
  assert.match(voicingBrowser, /`Frets open–\$\{voicing\.max\}`/);
  assert.equal(voicingBrowser.includes('nearest fret {nearFret} first'), false);
  assert.match(
    voicingBrowser,
    /nearest \{nearFret === 0 \? 'open' : `fret \$\{nearFret\}`\} first/,
  );
  assert.match(
    neckOverview,
    /`Visible frets open through \$\{range\[1\]\} of 24`/,
  );
});

void test('PhrasePanel renders accessible note list without buttons when dots="hidden" and hides list when dots="shown"', async () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const scratch = join(root, 'node_modules/.cache');
  mkdirSync(scratch, { recursive: true });
  const suffix = `${process.pid}-${randomUUID()}`;
  const outfile = join(scratch, `phrase-panel-ssr-${suffix}.mjs`);
  try {
    execFileSync(
      join(root, 'node_modules/esbuild/bin/esbuild'),
      [
        join(root, 'components/phrase-panel.tsx'),
        '--bundle',
        '--format=esm',
        `--outfile=${outfile}`,
        '--platform=node',
        '--packages=external',
        '--jsx=automatic',
        '--loader:.css=empty',
        `--alias:@=${root}`,
      ],
      { cwd: root, stdio: 'pipe' },
    );
    const { PhrasePanel } = (await import(pathToFileURL(outfile).href)) as {
      PhrasePanel: typeof PhrasePanelComponent;
    };
    const scaleNotes = [
      { name: 'C', pc: 0, degree: '1' },
      { name: 'D', pc: 2, degree: '2' },
      { name: 'E', pc: 4, degree: '3' },
      { name: 'F', pc: 5, degree: '4' },
      { name: 'G', pc: 7, degree: '5' },
      { name: 'A', pc: 9, degree: '6' },
      { name: 'B', pc: 11, degree: '7' },
    ];
    const capture: ComponentProps<typeof PhrasePanelComponent>['capture'] = {
      position: 0,
      view: 'pattern',
      place: 'scale',
      degrees: false,
      left: false,
      chordRoot: 'C',
      qualityId: 'major',
      chordView: 'shape',
      voicingIndex: 0,
      voicingBass: 'all',
      voicingStrings: 'all',
      voicingNearFret: null,
    };
    const held: NonNullable<
      ComponentProps<typeof PhrasePanelComponent>['held']
    > = {
      id: 'ssr-open-fixture',
      type: 'phrase',
      name: 'Open fixture',
      savedAt: 1,
      notes: [
        {
          name: 'D',
          pc: 2,
          degree: '2',
          midi: 50,
          beat: 0,
          duration: 0.5,
          strong: false,
          chordTone: false,
          string: 2,
          fret: 0,
          finger: 0,
          position: 0,
          shift: false,
        },
        {
          name: 'E',
          pc: 4,
          degree: '3',
          midi: 52,
          beat: 1,
          duration: 1,
          strong: true,
          chordTone: true,
          string: 1,
          fret: 7,
          finger: 3,
          position: 5,
          shift: false,
        },
        {
          name: 'A',
          pc: 9,
          degree: '6',
          midi: 45,
          beat: 8,
          duration: 2,
          strong: true,
          chordTone: true,
          string: 1,
          fret: 0,
          finger: 0,
          position: 0,
          shift: false,
        },
      ],
      key: 'C',
      scaleId: 'major',
      scaleName: 'Major',
      chord: null,
      bars: 2,
      tempo: 96,
      slow: false,
      swing: 0,
      plan: {
        contour: 'arch',
        rhythm: 'eighths',
        register: 'low',
        cadence: 'root',
      },
      seed: 101,
      ...capture,
    };
    const baseProps: ComponentProps<typeof PhrasePanelComponent> = {
      active: true,
      scaleRoot: 'C',
      scaleId: 'major',
      scaleName: 'Major',
      scaleNotes,
      chord: null,
      held,
      onReleaseHeld() {},
      capture,
      onMarks() {},
    };

    const hiddenHtml = renderToStaticMarkup(
      createElement(PhrasePanel, { ...baseProps, dots: 'hidden' }),
    );
    assert.equal(
      hiddenHtml.includes('phrase-staff-fret'),
      false,
      'dots="hidden" should not render interactive tab buttons',
    );
    assert.match(
      hiddenHtml,
      /<ol class="sr-only" aria-label="Phrase notes in order">/,
      'dots="hidden" should expose the sr-only note list without aria-hidden',
    );
    assert.ok(
      hiddenHtml.includes(
        '<li>D, string 4, open (0), bar 1, beat 1, eighth note</li>',
      ),
    );
    assert.ok(
      hiddenHtml.includes(
        '<li>E, string 5, fret 7, finger 3, bar 1, beat 2, quarter note, strong beat, chord tone</li>',
      ),
    );
    assert.ok(
      hiddenHtml.includes(
        '<li>A, string 5, open (0), landing, beat 1, half note, strong beat, chord tone</li>',
      ),
    );

    const shownHtml = renderToStaticMarkup(
      createElement(PhrasePanel, { ...baseProps, dots: 'shown' }),
    );
    assert.match(
      shownHtml,
      /<ol class="sr-only" aria-label="Phrase notes in order" aria-hidden="true">/,
      'dots="shown" should aria-hide the fallback note list',
    );
    assert.equal(
      (shownHtml.match(/class="phrase-staff-fret"/g) ?? []).length,
      3,
      'dots="shown" should render one interactive button per fixture note',
    );
    assert.ok(
      shownHtml.includes(
        'aria-label="Play D, string 4, open (0), bar 1, beat 1, eighth note"',
      ),
    );
    assert.ok(
      shownHtml.includes(
        'aria-label="Play E, string 5, fret 7, finger 3, bar 1, beat 2, quarter note, strong beat, chord tone"',
      ),
    );
    assert.ok(
      shownHtml.includes(
        'aria-label="Play A, string 5, open (0), landing, beat 1, half note, strong beat, chord tone"',
      ),
    );
    assert.ok(shownHtml.includes('>0</button>'));
    assert.ok(shownHtml.includes('>7</button>'));
  } finally {
    rmSync(outfile, { force: true });
  }
});
