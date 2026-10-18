import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  TRAY_KEY,
  emptyTray,
  parseTray,
  readTray,
  writeTray,
  type TrayChordBookmark,
  type TrayPhrase,
  type TrayScaleBookmark,
  type TrayState,
  type TrayStorage,
} from '../lib/tray.ts';
import { phraseTabText } from '../lib/tray-tab.ts';
import { encodePhraseMidi } from '../lib/tray-midi.ts';

const KNOWN_NOTES = [
  { string: 0, fret: 5, beat: 0, duration: 1, midi: 45 },
  { string: 1, fret: 7, beat: 1, duration: 1, midi: 52 },
  { string: 2, fret: 0, beat: 2, duration: 1, midi: 50 },
  { string: 5, fret: 12, beat: 3, duration: 1, midi: 76 },
] as const;

function memory(): TrayStorage & { raw(): string | null } {
  let value: string | null = null;
  return {
    getItem(key) {
      return key === TRAY_KEY ? value : null;
    },
    setItem(key, next) {
      if (key === TRAY_KEY) value = next;
    },
    raw: () => value,
  };
}

function phrase(): TrayPhrase {
  return {
    id: 'phrase-1',
    type: 'phrase',
    name: 'A Dorian phrase',
    savedAt: 1_700_000_000_000,
    notes: KNOWN_NOTES.map((note) => ({
      name: 'A',
      pc: 9,
      degree: '1',
      midi: note.midi,
      beat: note.beat,
      duration: note.duration,
      strong: note.beat % 1 === 0,
      chordTone: true,
      string: note.string,
      fret: note.fret,
      finger: note.fret === 0 ? 0 : 1,
      position: 5,
      shift: false,
    })),
    key: 'A',
    scaleId: 'dorian',
    scaleName: 'Dorian',
    chord: {
      symbol: 'Am7',
      root: 'A',
      qualityId: 'm7',
      notes: [
        { name: 'A', pc: 9, degree: '1' },
        { name: 'C', pc: 0, degree: 'b3' },
        { name: 'E', pc: 4, degree: '5' },
        { name: 'G', pc: 7, degree: 'b7' },
      ],
      fromContext: false,
    },
    bars: 2,
    tempo: 96,
    slow: false,
    swing: 0,
    plan: {
      contour: 'arch',
      rhythm: 'quarters',
      register: 'mid',
      cadence: 'root',
    },
    seed: 17,
    position: 2,
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
}

function scaleMark(): TrayScaleBookmark {
  return {
    id: 'scale-1',
    type: 'scale',
    name: 'A Dorian · form 3',
    savedAt: 1_700_000_000_100,
    scaleRoot: 'A',
    scaleId: 'dorian',
    view: 'pattern',
    position: 2,
    degrees: true,
    left: false,
    chord: null,
  };
}

function chordMark(): TrayChordBookmark {
  return {
    id: 'chord-1',
    type: 'chord',
    name: 'Cmaj7 · shape 1',
    savedAt: 1_700_000_000_200,
    chordRoot: 'C',
    qualityId: 'maj7',
    chordView: 'shape',
    voicingIndex: 0,
    voicingBass: 'all',
    voicingStrings: '0,1,2,3',
    voicingNearFret: 3,
    degrees: false,
    left: true,
    scaleRoot: 'A',
    scaleId: 'dorian',
  };
}

void test('tray storage round-trips phrases, scale bookmarks, and chord bookmarks', () => {
  const state: TrayState = {
    version: 1,
    items: [phrase(), scaleMark(), chordMark()],
  };
  const storage = memory();
  writeTray(storage, state);
  const loaded = readTray(storage);
  assert.deepEqual(loaded, state);
  assert.deepEqual(parseTray(storage.raw()).state, state);
  assert.equal(parseTray(storage.raw()).reset, false);
  assert.deepEqual(parseTray(null), { state: emptyTray(), reset: false });
});

void test('corrupt or old tray payloads reset storage to an empty tray', () => {
  const broken = [
    '{',
    '[]',
    'null',
    '"tray"',
    '',
    JSON.stringify({ version: 0, items: [] }),
    JSON.stringify({ version: 2, items: [] }),
    JSON.stringify({ version: 1, items: [{ type: 'phrase' }] }),
    JSON.stringify({
      version: 1,
      items: [phrase(), { ...phrase(), notes: [] }],
    }),
    JSON.stringify({
      version: 1,
      items: [phrase(), { ...phrase(), id: 'phrase-1' }],
    }),
  ];
  for (const raw of broken) {
    const storage = memory();
    storage.setItem(TRAY_KEY, raw);
    const loaded = readTray(storage);
    assert.deepEqual(loaded, emptyTray(), raw);
    assert.equal(storage.raw(), JSON.stringify(emptyTray()), raw);
  }
  const untouched = memory();
  assert.deepEqual(readTray(untouched), emptyTray());
  assert.equal(untouched.raw(), null);
  const valid = memory();
  const raw = JSON.stringify({ version: 1, items: [scaleMark()] });
  valid.setItem(TRAY_KEY, raw);
  assert.deepEqual(readTray(valid).items, [scaleMark()]);
  assert.equal(valid.raw(), raw);
});

void test('tab text uses the known phrase fingering and onsets', () => {
  const text = phraseTabText({
    title: 'Known phrase',
    tempo: 96,
    notes: KNOWN_NOTES,
  });
  assert.equal(
    text,
    [
      'Known phrase · 96 BPM',
      '',
      'e|------------------12-|',
      'B|---------------------|',
      'G|---------------------|',
      'D|------------0--------|',
      'A|------7--------------|',
      'E|5--------------------|',
      '',
    ].join('\n'),
  );
});

void test('MIDI bytes carry a type-0 header, tempo, and note on/off deltas', () => {
  const bytes = encodePhraseMidi({ tempo: 120, notes: KNOWN_NOTES });
  const hex = Buffer.from(bytes).toString('hex');
  assert.equal(hex.slice(0, 8), '4d546864');
  assert.equal(hex.slice(8, 16), '00000006');
  assert.equal(hex.slice(16, 20), '0000');
  assert.equal(hex.slice(20, 24), '0001');
  assert.equal(hex.slice(24, 28), '01e0');
  assert.equal(hex.slice(28, 36), '4d54726b');
  assert.equal(
    hex,
    [
      '4d546864000000060000000101e0',
      '4d54726b0000002f',
      '00ff510307a120',
      '00902d64',
      '8360802d00',
      '00903464',
      '8360803400',
      '00903264',
      '8360803200',
      '00904c64',
      '8360804c00',
      '00ff2f00',
    ].join(''),
  );
});

void test('the tray stays out of the eager phrase graph', () => {
  const page = readFileSync(
    new URL('../app/page.tsx', import.meta.url),
    'utf8',
  );
  const host = readFileSync(
    new URL('../components/practice-tray-host.tsx', import.meta.url),
    'utf8',
  );
  const tray = readFileSync(
    new URL('../components/practice-tray.tsx', import.meta.url),
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
  for (const source of [page, host, tray]) {
    assert.equal(source.includes("from '@/lib/phrase'"), false);
    assert.equal(source.includes("from '@/lib/phrase-audio'"), false);
  }
  assert.equal(launcher.includes("from '@/lib/phrase'"), false);
  assert.equal(launcher.includes('phrase-audio'), false);
  assert.equal(page.includes('phrase-audio'), false);
  assert.equal(host.includes('phrase-audio'), false);
  assert.equal(host.includes('localStorage'), false);
  assert.equal(tray.includes('localStorage'), false);
  assert.equal(panel.includes('localStorage'), false);
  assert.equal(launcher.includes('localStorage'), false);
  assert.match(host, /import\('@\/components\/practice-tray'\)/);
  assert.match(tray, /import\('@\/lib\/phrase-audio'\)/);
  assert.equal(page.includes("from '@/components/practice-tray'"), false);
  assert.match(page, /PracticeTrayHost/);
  for (const file of [
    'lib/tray.ts',
    'lib/tray-tab.ts',
    'lib/tray-midi.ts',
    'components/practice-tray.tsx',
    'components/practice-tray-host.tsx',
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal(source.includes('drone-audio'), false, file);
    assert.equal(source.includes('drone-session'), false, file);
    assert.equal(source.includes('.play('), false, file);
  }
});
