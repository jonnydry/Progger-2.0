import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  TRAY_KEY,
  emptyTray,
  getTray,
  insertTrayItem,
  onTrayStorage,
  parseTray,
  phraseStopApplies,
  readTray,
  removeTrayItem,
  renameTrayItem,
  savePhrase,
  trayFilename,
  trayFocusMove,
  traySaveMessage,
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
  assert.equal(parseTray(storage.raw()).writable, true);
  assert.deepEqual(parseTray(null), { state: emptyTray(), writable: true });
});

function futureScale(id = 'future-1') {
  return {
    type: 'scale',
    id,
    name: 'Future mode',
    savedAt: 42,
    scaleRoot: 'A',
    scaleId: 'super-lydian',
    view: 'pattern',
    position: 1,
    degrees: false,
    left: false,
    chord: null,
    extra: { keep: true },
  };
}

function phraseInput() {
  const {
    id: _id,
    type: _type,
    savedAt: _savedAt,
    name: _name,
    ...rest
  } = phrase();
  return rest;
}

void test('one unknown item among three stays in storage on read', () => {
  const unknown = futureScale();
  const raw = JSON.stringify({
    version: 1,
    items: [phrase(), unknown, chordMark()],
  });
  const storage = memory();
  storage.setItem(TRAY_KEY, raw);
  const loaded = readTray(storage);
  assert.deepEqual(
    loaded.items.map((item) => item.id),
    ['phrase-1', 'chord-1'],
  );
  assert.equal(storage.raw(), raw);
  assert.equal(parseTray(raw).writable, true);
});

void test('corrupt JSON stays byte-identical and is not written over', () => {
  for (const raw of ['{', '[]', 'null', '"tray"', '']) {
    const storage = memory();
    storage.setItem(TRAY_KEY, raw);
    assert.deepEqual(readTray(storage), emptyTray());
    assert.equal(storage.raw(), raw);
    assert.equal(parseTray(raw).writable, false);
  }
  const held = installTray('{');
  try {
    const result = savePhrase(phraseInput());
    assert.equal(result.status, 'failed');
    assert.equal(result.item, null);
    assert.equal(held.raw(), '{');
    assert.notEqual(traySaveMessage(result.status), 'Saved to tray.');
  } finally {
    held.restore();
  }
});

void test('an unknown tray version is left untouched and read-only', () => {
  for (const version of [0, 2]) {
    const raw = JSON.stringify({ version, items: [phrase(), futureScale()] });
    const storage = memory();
    storage.setItem(TRAY_KEY, raw);
    assert.deepEqual(readTray(storage), emptyTray());
    assert.equal(storage.raw(), raw);
    assert.equal(parseTray(raw).writable, false);
    const held = installTray(raw);
    try {
      const result = savePhrase(phraseInput());
      assert.equal(result.status, 'failed');
      assert.equal(held.raw(), raw);
    } finally {
      held.restore();
    }
  }
});

void test('a cross-tab update carrying a new scale never writes', () => {
  const held = installTray(JSON.stringify({ version: 1, items: [phrase()] }));
  try {
    assert.equal(getTray().items.length, 1);
    assert.equal(held.writes.length, 0);
    const unknown = futureScale();
    const next = JSON.stringify({
      version: 1,
      items: [phrase(), unknown],
    });
    held.value = next;
    onTrayStorage(TRAY_KEY);
    const shown = getTray();
    assert.equal(held.writes.length, 0);
    assert.equal(held.raw(), next);
    assert.deepEqual(
      shown.items.map((item) => item.id),
      ['phrase-1'],
    );
    assert.equal(
      JSON.stringify(JSON.parse(next).items[1]),
      JSON.stringify(unknown),
    );
  } finally {
    held.restore();
  }
});

void test('unknown items survive save, rename, and delete byte for byte', () => {
  const unknown = futureScale();
  const held = installTray(JSON.stringify({ version: 1, items: [unknown] }));
  try {
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'saved');
    assert.ok(saved.item);
    let stored = JSON.parse(held.raw() ?? '');
    assert.equal(JSON.stringify(stored.items[1]), JSON.stringify(unknown));

    renameTrayItem(saved.item.id, 'Morning line');
    stored = JSON.parse(held.raw() ?? '');
    assert.equal(stored.items[0].name, 'Morning line');
    assert.equal(JSON.stringify(stored.items[1]), JSON.stringify(unknown));

    const removed = removeTrayItem(saved.item.id);
    assert.ok(removed);
    stored = JSON.parse(held.raw() ?? '');
    assert.equal(stored.items.length, 1);
    assert.equal(JSON.stringify(stored.items[0]), JSON.stringify(unknown));
  } finally {
    held.restore();
  }
});

void test('the cap evicts the oldest known item and never an unknown one', () => {
  const oldest = { ...phrase(), id: 'old', name: 'Old', savedAt: 1 };
  const newer = { ...phrase(), id: 'newer', name: 'Newer', savedAt: 50 };
  const unknowns = Array.from({ length: 78 }, (_item, index) =>
    futureScale(`future-${index}`),
  );
  const items = [
    newer,
    ...unknowns.slice(0, 10),
    oldest,
    ...unknowns.slice(10),
  ];
  assert.equal(items.length, 80);
  const held = installTray(JSON.stringify({ version: 1, items }));
  try {
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'evicted');
    assert.equal(
      traySaveMessage(saved.status),
      'Tray full, removed the oldest phrase.',
    );
    const stored = JSON.parse(held.raw() ?? '');
    assert.equal(stored.items.length, 80);
    const ids = stored.items.map((item: { id: string }) => item.id);
    assert.equal(ids.includes('old'), false);
    assert.equal(ids.includes('newer'), true);
    assert.equal(ids[0], saved.item?.id);
    for (const unknown of unknowns) {
      const found = stored.items.find(
        (item: { id: string }) => item.id === unknown.id,
      );
      assert.equal(JSON.stringify(found), JSON.stringify(unknown));
    }
  } finally {
    held.restore();
  }
});

void test('a tray of only unknown items refuses the next save', () => {
  const items = Array.from({ length: 80 }, (_item, index) =>
    futureScale(`future-${index}`),
  );
  const raw = JSON.stringify({ version: 1, items });
  const held = installTray(raw);
  try {
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'full');
    assert.equal(saved.item, null);
    assert.equal(traySaveMessage(saved.status), 'Tray is full.');
    assert.equal(held.raw(), raw);
    assert.deepEqual(getTray().items, []);
  } finally {
    held.restore();
  }
});

void test('a storage-full throw does not report success or change data', () => {
  const raw = JSON.stringify({ version: 1, items: [phrase()] });
  const value = raw;
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem(key: string) {
        return key === TRAY_KEY ? value : null;
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    },
  });
  onTrayStorage(TRAY_KEY);
  try {
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'failed');
    assert.equal(saved.item, null);
    assert.equal(value, raw);
    assert.equal(getTray().items[0]?.id, 'phrase-1');
    assert.notEqual(traySaveMessage(saved.status), 'Saved to tray.');
  } finally {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: previous,
    });
    onTrayStorage(TRAY_KEY);
  }
});

void test('undo puts a deleted item back at its original slot', () => {
  const unknown = futureScale();
  const first = { ...phrase(), id: 'a', name: 'A' };
  const second = { ...phrase(), id: 'b', name: 'B', savedAt: 2 };
  const held = installTray(
    JSON.stringify({ version: 1, items: [first, unknown, second] }),
  );
  try {
    const removed = removeTrayItem('b');
    assert.ok(removed);
    assert.equal(removed.index, 2);
    let stored = JSON.parse(held.raw() ?? '');
    assert.deepEqual(
      stored.items.map((item: { id: string }) => item.id),
      ['a', 'future-1'],
    );
    insertTrayItem(removed.item, removed.index);
    stored = JSON.parse(held.raw() ?? '');
    assert.deepEqual(
      stored.items.map((item: { id: string }) => item.id),
      ['a', 'future-1', 'b'],
    );
    assert.equal(JSON.stringify(stored.items[1]), JSON.stringify(unknown));
  } finally {
    held.restore();
  }
});

void test('export filenames keep letters and numbers and drop path characters', () => {
  assert.equal(trayFilename('Café / ligne\n', 'txt'), 'café-ligne.txt');
  assert.equal(trayFilename('../A Dorian', 'mid'), 'a-dorian.mid');
  assert.equal(trayFilename('riffs_01', 'txt'), 'riffs-01.txt');
  assert.equal(trayFilename('   \u0000', 'mid'), 'phrase.mid');
});

void test('focus wrap moves off either end and stops a foreign player', () => {
  assert.equal(trayFocusMove({ count: 4, index: 3, shift: false }), 0);
  assert.equal(trayFocusMove({ count: 4, index: 0, shift: true }), 3);
  assert.equal(trayFocusMove({ count: 4, index: -1, shift: false }), 0);
  assert.equal(trayFocusMove({ count: 4, index: -1, shift: true }), 3);
  assert.equal(trayFocusMove({ count: 4, index: 1, shift: false }), null);
  assert.equal(trayFocusMove({ count: 4, index: 2, shift: true }), null);
  assert.equal(phraseStopApplies('panel', 'tray'), true);
  assert.equal(phraseStopApplies('panel', 'panel'), false);
  assert.equal(phraseStopApplies('tray', 'panel'), true);
  assert.equal(phraseStopApplies('tray', 'tray'), false);
});

function installTray(initial: string | null) {
  let value = initial;
  const writes: string[] = [];
  const previous = globalThis.localStorage;
  const storage = {
    getItem(key: string) {
      return key === TRAY_KEY ? value : null;
    },
    setItem(key: string, next: string) {
      if (key !== TRAY_KEY) return;
      writes.push(next);
      value = next;
    },
    writes,
    raw: () => value,
    restore() {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: previous,
      });
      onTrayStorage(TRAY_KEY);
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(storage, 'value', {
    get: () => value,
    set: (next: string) => {
      value = next;
    },
  });
  onTrayStorage(TRAY_KEY);
  return storage as typeof storage & { value: string };
}

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
  assert.match(tray, /phraseStopApplies\('tray'/);
  assert.match(tray, /detail: 'tray'/);
  assert.match(panel, /phraseStopApplies\('panel'/);
  assert.match(panel, /traySaveMessage\(saved\.status\)/);
  assert.equal(panel.includes("saved ? 'Saved to tray.'"), false);
  const trayLib = readFileSync(
    new URL('../lib/tray.ts', import.meta.url),
    'utf8',
  );
  assert.match(trayLib, /addEventListener\(\s*'storage'/);
  assert.match(trayLib, /onTrayStorage\(event\.key\)/);
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
