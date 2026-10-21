import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  PHRASE_STOP_EVENT,
  TRAY_KEY,
  bindPhraseStop,
  bindTrayStorage,
  dispatchPhraseStop,
  emptyTray,
  focusTrayTab,
  getTray,
  insertTrayItem,
  TRAY_UNREADABLE_NOTE,
  trayReadable,
  onTrayStorage,
  parseTray,
  phraseStopApplies,
  readTray,
  removeTrayItem,
  renameTrayItem,
  savePhrase,
  saveView,
  settleTrayPlay,
  trayFilename,
  trayFocusMove,
  trayRenameCommand,
  trayRenameStart,
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
    assert.notEqual(traySaveMessage(result.status), 'Saved to stash.');
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

void test('an unreadable tray is left untouched and is not a fresh empty tray', () => {
  const blobs = [
    '{',
    '[]',
    'null',
    '"tray"',
    JSON.stringify({ version: 2, items: [phrase()] }),
    JSON.stringify({ version: 0, items: [] }),
    JSON.stringify({ version: 1 }),
    JSON.stringify({ version: 1, items: { id: 'nope' } }),
    JSON.stringify({ items: [phrase()] }),
  ];
  assert.equal(
    TRAY_UNREADABLE_NOTE,
    "Your saved stash couldn't be read, so it's left untouched.",
  );
  for (const raw of blobs) {
    const held = installTray(raw);
    try {
      assert.equal(trayReadable(), false, raw);
      assert.deepEqual(getTray().items, []);
      assert.equal(held.raw(), raw);
      assert.equal(held.writes.length, 0);
    } finally {
      held.restore();
    }
  }
  const missing = installTray(null);
  try {
    assert.equal(trayReadable(), true);
    assert.deepEqual(getTray().items, []);
  } finally {
    missing.restore();
  }
});

void test('reading does not trim a tray that is already over the cap', () => {
  const items = Array.from({ length: 81 }, (_item, index) => ({
    ...phrase(),
    id: `kept-${index}`,
    savedAt: index + 1,
  }));
  const raw = JSON.stringify({ version: 1, items });
  const held = installTray(raw);
  try {
    assert.equal(trayReadable(), true);
    assert.equal(getTray().items.length, 81);
    assert.equal(held.raw(), raw);
    assert.equal(held.writes.length, 0);
  } finally {
    held.restore();
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
    assert.equal(saved.removed, 'phrase');
    assert.equal(
      traySaveMessage(saved.status, 'phrase', saved.removed),
      'Stash full, removed the oldest phrase.',
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
    assert.equal(traySaveMessage(saved.status), 'Stash is full.');
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
    assert.notEqual(traySaveMessage(saved.status), 'Saved to stash.');
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
  const third = { ...phrase(), id: 'c', name: 'C', savedAt: 3 };
  const held = installTray(
    JSON.stringify({ version: 1, items: [first, unknown, second, third] }),
  );
  try {
    const removed = removeTrayItem('b');
    assert.ok(removed);
    assert.equal(removed.index, 2);
    let stored = JSON.parse(held.raw() ?? '');
    assert.deepEqual(
      stored.items.map((item: { id: string }) => item.id),
      ['a', 'future-1', 'c'],
    );
    insertTrayItem(removed.item, removed.index, removed.raw);
    stored = JSON.parse(held.raw() ?? '');
    assert.deepEqual(
      stored.items.map((item: { id: string }) => item.id),
      ['a', 'future-1', 'b', 'c'],
    );
    assert.equal(JSON.stringify(stored.items[1]), JSON.stringify(unknown));
  } finally {
    held.restore();
  }
});

void test('eviction names the bookmark that was removed', () => {
  const cases = [
    {
      oldest: { ...scaleMark(), id: 'old-scale', savedAt: 1 },
      noun: 'scale' as const,
    },
    {
      oldest: { ...chordMark(), id: 'old-chord', savedAt: 1 },
      noun: 'chord' as const,
    },
  ];
  for (const { oldest, noun } of cases) {
    const newer = { ...phrase(), id: 'newer', name: 'Newer', savedAt: 50 };
    const unknowns = Array.from({ length: 78 }, (_item, index) =>
      futureScale(`future-${noun}-${index}`),
    );
    const items = [
      newer,
      ...unknowns.slice(0, 10),
      oldest,
      ...unknowns.slice(10),
    ];
    const held = installTray(JSON.stringify({ version: 1, items }));
    try {
      const saved = savePhrase(phraseInput());
      assert.equal(saved.status, 'evicted');
      assert.equal(saved.removed, noun);
      const message = traySaveMessage(saved.status, 'phrase', saved.removed);
      assert.equal(message, `Stash full, removed the oldest ${noun}.`);
      assert.equal(message.includes('phrase'), false);
    } finally {
      held.restore();
    }
  }
  assert.equal(
    traySaveMessage('evicted'),
    'Stash full, removed the oldest item.',
  );
});

void test('unavailable storage does not report a saved phrase', () => {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage',
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('blocked');
    },
  });
  onTrayStorage(TRAY_KEY);
  try {
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'failed');
    assert.equal(saved.item, null);
    assert.equal(traySaveMessage(saved.status), 'Could not save this phrase.');
    assert.notEqual(traySaveMessage(saved.status), 'Saved to stash.');
    assert.deepEqual(getTray().items, []);
    const view = saveView({
      kind: 'scale',
      scaleRoot: 'A',
      scaleId: 'dorian',
      scaleName: 'Dorian',
      view: 'pattern',
      position: 2,
      degrees: true,
      left: false,
      chord: null,
    });
    assert.equal(view.status, 'failed');
    assert.equal(
      traySaveMessage(view.status, 'view'),
      'Could not save this view.',
    );
    assert.notEqual(traySaveMessage(view.status, 'view'), 'Saved to stash.');
  } finally {
    if (descriptor) {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
    onTrayStorage(TRAY_KEY);
  }
});

void test('rename keeps extra fields on a known item byte for byte', () => {
  const extra = { ...phrase(), extra: { keep: true }, note: 'stay' };
  const held = installTray(JSON.stringify({ version: 1, items: [extra] }));
  try {
    renameTrayItem(extra.id, 'Renamed line');
    const stored = JSON.parse(held.raw() ?? '') as {
      items: { name: string }[];
    };
    const item = stored.items[0];
    assert.ok(item);
    assert.equal(item.name, 'Renamed line');
    assert.equal(
      JSON.stringify({ ...item, name: extra.name }),
      JSON.stringify(extra),
    );
  } finally {
    held.restore();
  }
});

void test('a duplicate id stays in storage and counts once', () => {
  const first = phrase();
  const duplicate = {
    ...phrase(),
    name: 'Copy',
    savedAt: 3,
    extra: { keep: true },
  };
  const raw = JSON.stringify({ version: 1, items: [first, duplicate] });
  assert.deepEqual(
    parseTray(raw).state.items.map((item) => item.name),
    ['A Dorian phrase'],
  );
  const held = installTray(raw);
  try {
    assert.equal(getTray().items.length, 1);
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'saved');
    const stored = JSON.parse(held.raw() ?? '') as { items: unknown[] };
    assert.equal(stored.items.length, 3);
    assert.equal(JSON.stringify(stored.items[2]), JSON.stringify(duplicate));
    assert.equal(
      getTray().items.filter((item) => item.id === first.id).length,
      1,
    );
    assert.equal(getTray().items.length, 2);
  } finally {
    held.restore();
  }
});

void test('removing the known copy reveals the stored duplicate', () => {
  const first = phrase();
  const duplicate = {
    ...phrase(),
    name: 'Copy',
    savedAt: 3,
    extra: { keep: true },
  };
  const held = installTray(
    JSON.stringify({ version: 1, items: [first, duplicate] }),
  );
  try {
    const removed = removeTrayItem(first.id);
    assert.ok(removed);
    assert.equal(
      getTray()
        .items.map((item) => item.name)
        .join(),
      'Copy',
    );
    const stored = JSON.parse(held.raw() ?? '') as { items: unknown[] };
    assert.equal(stored.items.length, 1);
    assert.equal(JSON.stringify(stored.items[0]), JSON.stringify(duplicate));
    assert.ok(removeTrayItem(first.id));
    assert.deepEqual(getTray().items, []);
  } finally {
    held.restore();
  }
});

void test('evicting a known item reveals a raw duplicate of that id', () => {
  const first = { ...phrase(), id: 'old', name: 'Old', savedAt: 1 };
  const duplicate = { ...first, name: 'Copy', extra: { keep: true } };
  const unknowns = Array.from({ length: 78 }, (_item, index) =>
    futureScale(`future-dup-${index}`),
  );
  const items = [first, duplicate, ...unknowns];
  const held = installTray(JSON.stringify({ version: 1, items }));
  try {
    const saved = savePhrase(phraseInput());
    assert.equal(saved.status, 'evicted');
    assert.equal(
      getTray().items.some((item) => item.name === 'Copy'),
      true,
    );
    const stored = JSON.parse(held.raw() ?? '') as {
      items: { name?: string }[];
    };
    const found = stored.items.find((item) => item.name === 'Copy');
    assert.equal(JSON.stringify(found), JSON.stringify(duplicate));
  } finally {
    held.restore();
  }
});

void test('undo writes the original raw item back', () => {
  const extra = {
    ...phrase(),
    id: 'b',
    name: 'B',
    extra: { keep: true },
    note: 'stay',
  };
  const first = { ...phrase(), id: 'a', name: 'A' };
  const third = { ...phrase(), id: 'c', name: 'C', savedAt: 3 };
  const held = installTray(
    JSON.stringify({ version: 1, items: [first, extra, third] }),
  );
  try {
    const removed = removeTrayItem('b');
    assert.ok(removed);
    insertTrayItem(removed.item, removed.index, removed.raw);
    const stored = JSON.parse(held.raw() ?? '') as { items: { id: string }[] };
    assert.deepEqual(
      stored.items.map((item) => item.id),
      ['a', 'b', 'c'],
    );
    assert.equal(JSON.stringify(stored.items[1]), JSON.stringify(extra));
  } finally {
    held.restore();
  }
});

void test('a tray play stopped while the player loads does not start', async () => {
  let generation = 1;
  let started = 0;
  let stopped = 0;
  let release = () => {};
  const loading = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = settleTrayPlay({
    mine: 1,
    current: () => generation,
    load: () => loading,
    begin: () => {},
    start: async () => {
      started += 1;
    },
    stop: () => {
      stopped += 1;
    },
  });
  generation += 1;
  release();
  assert.equal(await pending, false);
  assert.equal(started, 0);
  assert.equal(stopped, 0);

  const duringStart = settleTrayPlay({
    mine: generation,
    current: () => generation,
    load: async () => 'ready',
    begin: () => {},
    start: async () => {
      generation += 1;
      started += 1;
    },
    stop: () => {
      stopped += 1;
    },
  });
  assert.equal(await duringStart, false);
  assert.equal(started, 1);
  assert.equal(stopped, 1);
  assert.equal(
    await settleTrayPlay({
      mine: generation,
      current: () => generation,
      load: async () => 'ready',
      begin: () => {},
      start: async () => {
        started += 1;
      },
      stop: () => {
        stopped += 1;
      },
    }),
    true,
  );
});

void test('escape then enter still commits the next rename', () => {
  const escaped = trayRenameCommand(false, 'Escape', true);
  assert.equal(escaped.commit, false);
  assert.equal(escaped.cancelled, true);
  const started = trayRenameStart();
  const blurred = trayRenameCommand(started.cancelled, 'blur', true);
  assert.equal(blurred.commit, true);
  const entered = trayRenameCommand(escaped.cancelled, 'Enter', true);
  assert.equal(entered.cancelled, false);
  assert.equal(entered.commit, true);
  const saved = trayRenameCommand(entered.cancelled, 'blur', true);
  assert.equal(saved.commit, true);
  const dropped = trayRenameCommand(escaped.cancelled, 'blur', true);
  assert.equal(dropped.commit, false);
});

void test('tab wrap focuses the other end through the tray helper', () => {
  const order: string[] = [];
  const items = ['close', 'play', 'open', 'delete'].map((id) => ({
    id,
    focus() {
      order.push(id);
    },
  }));
  assert.equal(focusTrayTab(items, 3, false), true);
  assert.deepEqual(order, ['close']);
  assert.equal(focusTrayTab(items, 0, true), true);
  assert.deepEqual(order, ['close', 'delete']);
  assert.equal(focusTrayTab(items, 1, false), false);
  assert.deepEqual(order, ['close', 'delete']);
  assert.equal(focusTrayTab([], 0, false), false);
});

void test('a storage event re-reads and does not write', () => {
  const held = installTray(JSON.stringify({ version: 1, items: [phrase()] }));
  const target = new EventTarget();
  const unbind = bindTrayStorage(target);
  try {
    const unknown = futureScale();
    const added = { ...phrase(), id: 'from-other-tab', name: 'Other tab' };
    const next = JSON.stringify({
      version: 1,
      items: [phrase(), added, unknown],
    });
    held.value = next;
    const event = new Event('storage');
    Object.defineProperty(event, 'key', { value: TRAY_KEY });
    target.dispatchEvent(event);
    assert.equal(held.writes.length, 0);
    assert.equal(held.raw(), next);
    assert.deepEqual(
      getTray().items.map((item) => item.id),
      ['phrase-1', 'from-other-tab'],
    );
    assert.equal(
      JSON.stringify(JSON.parse(next).items[2]),
      JSON.stringify(unknown),
    );
    const other = new Event('storage');
    Object.defineProperty(other, 'key', { value: 'progger.other' });
    target.dispatchEvent(other);
    assert.equal(held.writes.length, 0);
    assert.equal(getTray().items.length, 2);
  } finally {
    unbind();
    held.restore();
  }
});

void test('a tray stop leaves the tray player running and stops the panel', () => {
  const bus = new EventTarget();
  let panelStops = 0;
  let trayStops = 0;
  const unpanel = bindPhraseStop(bus, 'panel', () => {
    panelStops += 1;
  });
  const untray = bindPhraseStop(bus, 'tray', () => {
    trayStops += 1;
  });
  try {
    dispatchPhraseStop(bus, 'tray');
    assert.equal(panelStops, 1);
    assert.equal(trayStops, 0);
    dispatchPhraseStop(bus, 'panel');
    assert.equal(panelStops, 1);
    assert.equal(trayStops, 1);
    dispatchPhraseStop(bus, 'restore');
    assert.equal(panelStops, 2);
    assert.equal(trayStops, 2);
    bus.dispatchEvent(new CustomEvent(PHRASE_STOP_EVENT, { detail: 'tray' }));
    assert.equal(trayStops, 2);
    assert.equal(panelStops, 3);
  } finally {
    unpanel();
    untray();
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

void test('stash labels keep progger.tray.v1 and still load items saved under that key', () => {
  assert.equal(TRAY_KEY, 'progger.tray.v1');
  const saved = phrase();
  const blob = JSON.stringify({ version: 1, items: [saved] });
  const store = new Map<string, string>([['progger.tray.v1', blob]]);
  const loaded = readTray({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  });
  assert.equal(loaded.items.length, 1);
  assert.equal(loaded.items[0]?.id, saved.id);
  assert.equal(loaded.items[0]?.name, saved.name);
  assert.equal(store.has('progger.stash.v1'), false);
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
  assert.match(panel, /traySaveMessage\(saved\.status/);
  assert.equal(panel.includes("saved ? 'Saved to stash.'"), false);
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

void test('a stash phrase keeps a valid shape and an old plan omits the key', () => {
  const plain = phrase();
  const shape = {
    version: 1 as const,
    motif: {
      contour: 'step-up-step-down' as const,
      rhythm: 'even' as const,
    },
    variations: ['sequence-up' as const],
    question: { bar: 1 as const, degree: '4' as const },
  };
  const shaped: TrayPhrase = {
    ...phrase(),
    id: 'phrase-shaped',
    plan: { ...phrase().plan, shape },
  };
  const parsed = parseTray(
    JSON.stringify({ version: 1, items: [plain, shaped] }),
  );
  const [first, second] = parsed.state.items;
  assert.equal(first?.type, 'phrase');
  assert.equal(second?.type, 'phrase');
  if (first?.type !== 'phrase' || second?.type !== 'phrase') return;
  assert.equal('shape' in first.plan, false);
  assert.deepEqual(second.plan.shape, shape);
  assert.deepEqual(first.plan, plain.plan);
});
