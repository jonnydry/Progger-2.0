import { QUALITIES } from './harmony.ts';
import { ROOTS, SCALES } from './music.ts';

/**
 * Phrase history, version 2.
 * One localStorage key. A missing key is an empty history. A blob this
 * version cannot read stays in storage and this tab does not write.
 * Version 1 blobs load as seeds with no plan words, and the next save
 * writes version 2. Version 3 and later stay read-only.
 * An entry this version does not understand is ignored. This module does
 * not import the phrase generator.
 */
export const PHRASE_HISTORY_KEY = 'progger.phrase-history.v1';
export const PHRASE_HISTORY_LIMIT = 3;

const SCALE_IDS = new Set(SCALES.map((scale) => scale.id));
const QUALITY_IDS = new Set(QUALITIES.map((quality) => quality.id));
const ROOT_SET = new Set<string>(ROOTS);
const CONTOURS = new Set(['arch', 'rise', 'fall', 'wave']);
const RHYTHMS = new Set(['quarters', 'eighths', 'long-short', 'push']);
const REGISTERS = new Set(['low', 'mid', 'high']);
const CADENCES = new Set(['root', 'third', 'fifth']);
const CELL_IDS = new Set(['q', 'ee', 'zr', 'rz', 'dq', 'qd', 'h', 'ant']);

export type PhraseHistoryLocks = {
  contour?: 'arch' | 'rise' | 'fall' | 'wave';
  rhythm?: 'quarters' | 'eighths' | 'long-short' | 'push';
  register?: 'low' | 'mid' | 'high';
  cadence?: 'root' | 'third' | 'fifth';
};

export type PhraseHistoryNote = {
  name: string;
  pc: number;
  degree: string;
};

export type PhraseHistoryPlace = 'scale' | 'chord';

/**
 * The chord control that was selected. Null is the scale's tonic triad.
 * `fromContext` is a highlighted chord on the scales tab.
 */
export type PhraseHistoryChord = {
  symbol: string;
  root: string;
  qualityId: string;
  bass?: string;
  fromContext: boolean;
  notes: PhraseHistoryNote[];
};

/**
 * Seed, bar length, and the key, scale, and chord the generator used.
 * The same seed in another key, scale, or chord is a different phrase.
 */
/** Form and the rhythm-cell id string for each bar. Absent on a version 1 seed. */
export type PhraseHistoryPlan = {
  form: 'answer' | 'sentence';
  cells: string[];
};

export type PhraseHistoryEntry = {
  seed: number;
  bars: 2 | 4;
  scaleRoot: string;
  scaleId: string;
  place: PhraseHistoryPlace;
  chord: PhraseHistoryChord | null;
  chordNotes: PhraseHistoryNote[];
  locks: PhraseHistoryLocks;
  plan?: PhraseHistoryPlan;
};

export type PhraseHistoryState = {
  version: 2;
  entries: PhraseHistoryEntry[];
  index: number;
};

export type PhraseHistoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type PhraseHistoryContext = {
  scaleRoot: string;
  scaleId: string;
  place: PhraseHistoryPlace;
  chord: PhraseHistoryChord | null;
  chordNotes: readonly PhraseHistoryNote[];
  locks?: PhraseHistoryLocks;
};

const EMPTY_PHRASE_HISTORY: PhraseHistoryState = {
  version: 2,
  entries: [],
  index: -1,
};

export function emptyPhraseHistory(): PhraseHistoryState {
  return EMPTY_PHRASE_HISTORY;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: Set<string>,
): T | null {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : null;
}

function locksOf(value: unknown): PhraseHistoryLocks | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const locks: PhraseHistoryLocks = {};
  if (value.contour !== undefined) {
    const contour = oneOf<NonNullable<PhraseHistoryLocks['contour']>>(
      value.contour,
      CONTOURS,
    );
    if (!contour) return null;
    locks.contour = contour;
  }
  if (value.rhythm !== undefined) {
    const rhythm = oneOf<NonNullable<PhraseHistoryLocks['rhythm']>>(
      value.rhythm,
      RHYTHMS,
    );
    if (!rhythm) return null;
    locks.rhythm = rhythm;
  }
  if (value.register !== undefined) {
    const register = oneOf<NonNullable<PhraseHistoryLocks['register']>>(
      value.register,
      REGISTERS,
    );
    if (!register) return null;
    locks.register = register;
  }
  if (value.cadence !== undefined) {
    const cadence = oneOf<NonNullable<PhraseHistoryLocks['cadence']>>(
      value.cadence,
      CADENCES,
    );
    if (!cadence) return null;
    locks.cadence = cadence;
  }
  return locks;
}

function planWords(value: unknown, bars: 2 | 4): PhraseHistoryPlan | null {
  if (value === undefined) return null;
  if (!isRecord(value)) return null;
  const form =
    value.form === 'answer' || value.form === 'sentence' ? value.form : null;
  if (!form || !Array.isArray(value.cells) || value.cells.length !== bars)
    return null;
  if ((form === 'answer' && bars !== 2) || (form === 'sentence' && bars !== 4))
    return null;
  const cells: string[] = [];
  for (const cell of value.cells) {
    if (typeof cell !== 'string' || !cell || cell.length > 48) return null;
    const ids = cell.split(' ');
    if (!ids.length || ids.some((id) => !CELL_IDS.has(id))) return null;
    cells.push(cell);
  }
  return { form, cells };
}

function noteOf(value: unknown): PhraseHistoryNote | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, 16);
  const degree = text(value.degree, 16);
  const pc = integer(value.pc, 0, 11);
  if (!name || !degree || pc === null) return null;
  return { name, pc, degree };
}

function notesOf(value: unknown): PhraseHistoryNote[] | null {
  if (!Array.isArray(value) || value.length > 16) return null;
  const notes: PhraseHistoryNote[] = [];
  for (const note of value) {
    const parsed = noteOf(note);
    if (!parsed) return null;
    notes.push(parsed);
  }
  return notes;
}

function chordOf(value: unknown): PhraseHistoryChord | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const symbol = text(value.symbol, 32);
  const root =
    typeof value.root === 'string' && ROOT_SET.has(value.root)
      ? value.root
      : null;
  const qualityId =
    typeof value.qualityId === 'string' && QUALITY_IDS.has(value.qualityId)
      ? value.qualityId
      : null;
  const notes = notesOf(value.notes);
  const bass = value.bass === undefined ? undefined : text(value.bass, 16);
  if (
    !symbol ||
    !root ||
    !qualityId ||
    !notes ||
    notes.length === 0 ||
    typeof value.fromContext !== 'boolean' ||
    (value.bass !== undefined && !bass)
  ) {
    return undefined;
  }
  const chord: PhraseHistoryChord = {
    symbol,
    root,
    qualityId,
    fromContext: value.fromContext,
    notes,
  };
  if (bass) chord.bass = bass;
  return chord;
}

function placeAgrees(
  place: PhraseHistoryPlace,
  chord: PhraseHistoryChord | null,
): boolean {
  if (place === 'chord') return Boolean(chord && !chord.fromContext);
  return chord === null || chord.fromContext;
}

/** A clean entry, or null when the value cannot regenerate a phrase. */
export function phraseHistoryEntry(input: {
  seed: number;
  bars: 2 | 4;
  scaleRoot: string;
  scaleId: string;
  place: PhraseHistoryPlace;
  chord: PhraseHistoryChord | null;
  chordNotes: readonly PhraseHistoryNote[];
  locks?: PhraseHistoryLocks;
  plan?: PhraseHistoryPlan;
}): PhraseHistoryEntry | null {
  const seed = integer(input.seed, 0, 0xffffffff);
  const bars = input.bars === 2 || input.bars === 4 ? input.bars : null;
  const scaleRoot =
    typeof input.scaleRoot === 'string' && ROOT_SET.has(input.scaleRoot)
      ? input.scaleRoot
      : null;
  const scaleId =
    typeof input.scaleId === 'string' && SCALE_IDS.has(input.scaleId)
      ? input.scaleId
      : null;
  const place =
    input.place === 'scale' || input.place === 'chord' ? input.place : null;
  const chord = chordOf(input.chord);
  const chordNotes = notesOf(input.chordNotes);
  const locks = locksOf(input.locks ?? {});
  const plan =
    input.plan === undefined || bars === null
      ? null
      : planWords(input.plan, bars);
  if (
    seed === null ||
    bars === null ||
    !scaleRoot ||
    !scaleId ||
    !place ||
    chord === undefined ||
    !placeAgrees(place, chord) ||
    !chordNotes ||
    !locks
  ) {
    return null;
  }
  const entry: PhraseHistoryEntry = {
    seed,
    bars,
    scaleRoot,
    scaleId,
    place,
    chord,
    chordNotes,
    locks,
  };
  if (plan) entry.plan = plan;
  return entry;
}

function sameLocks(a: PhraseHistoryLocks, b: PhraseHistoryLocks): boolean {
  return (
    a.contour === b.contour &&
    a.rhythm === b.rhythm &&
    a.register === b.register &&
    a.cadence === b.cadence
  );
}

function sameNotes(
  a: readonly PhraseHistoryNote[],
  b: readonly PhraseHistoryNote[],
): boolean {
  if (a.length !== b.length) return false;
  return a.every(
    (note, index) =>
      note.name === b[index]?.name &&
      note.pc === b[index]?.pc &&
      note.degree === b[index]?.degree,
  );
}

function sameChord(
  a: PhraseHistoryChord | null,
  b: PhraseHistoryChord | null,
): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.symbol === b.symbol &&
    a.root === b.root &&
    a.qualityId === b.qualityId &&
    a.bass === b.bass &&
    a.fromContext === b.fromContext &&
    sameNotes(a.notes, b.notes)
  );
}

function samePhraseHistoryState(
  a: PhraseHistoryState,
  b: PhraseHistoryState,
): boolean {
  if (a === b) return true;
  if (a.index !== b.index || a.entries.length !== b.entries.length)
    return false;
  return a.entries.every((entry, index) => {
    const other = b.entries[index];
    return other !== undefined && samePhraseHistoryEntry(entry, other);
  });
}

export function samePhraseHistoryEntry(
  a: PhraseHistoryEntry,
  b: PhraseHistoryEntry,
): boolean {
  return (
    a.seed === b.seed &&
    a.bars === b.bars &&
    a.scaleRoot === b.scaleRoot &&
    a.scaleId === b.scaleId &&
    a.place === b.place &&
    sameChord(a.chord, b.chord) &&
    sameNotes(a.chordNotes, b.chordNotes) &&
    sameLocks(a.locks, b.locks)
  );
}

/**
 * The phrase on screen is this entry.
 * An unplayable plan is retried at the next seed, and the panel then
 * shows that seed. It is still this phrase.
 */
export function phraseHistoryShows(
  entry: PhraseHistoryEntry,
  shown: {
    seed: number;
    bars: 2 | 4;
    scaleRoot: string;
    scaleId: string;
    place: PhraseHistoryPlace;
    chord: PhraseHistoryChord | null;
    chordNotes: readonly PhraseHistoryNote[];
  },
): boolean {
  const seed =
    shown.seed === entry.seed || shown.seed === (entry.seed + 1) >>> 0;
  return (
    seed &&
    shown.bars === entry.bars &&
    shown.scaleRoot === entry.scaleRoot &&
    shown.scaleId === entry.scaleId &&
    shown.place === entry.place &&
    sameChord(shown.chord, entry.chord) &&
    sameNotes(shown.chordNotes, entry.chordNotes)
  );
}

/**
 * Locks saved with the phrase stay in force while it is showing.
 * The page has no lock control, so there is nothing else to switch.
 */
export function phraseHistoryActiveLocks(
  entry: PhraseHistoryEntry | null,
  showing: boolean,
  active: PhraseHistoryLocks,
): PhraseHistoryLocks {
  if (!showing || !entry) return active;
  return entry.locks;
}

function clampedIndex(state: PhraseHistoryState): number {
  if (state.entries.length === 0) return -1;
  if (
    !Number.isInteger(state.index) ||
    state.index < 0 ||
    state.index >= state.entries.length
  ) {
    return state.entries.length - 1;
  }
  return state.index;
}

/**
 * Remember `entry` as the phrase now showing.
 * A phrase already in history moves to the current spot instead of being
 * copied. Anything after the current phrase is dropped, then the oldest
 * phrase past the cap of three is dropped.
 */
export function pushPhraseHistory(
  state: PhraseHistoryState,
  entry: PhraseHistoryEntry,
): PhraseHistoryState {
  const clean = phraseHistoryEntry(entry);
  if (!clean) return state;
  const index = clampedIndex(state);
  const kept = state.entries.slice(0, index + 1);
  const current = kept.length > 0 ? kept[kept.length - 1] : null;
  if (current && samePhraseHistoryEntry(current, clean)) {
    if (!current.plan && clean.plan) {
      const entries = [...kept.slice(0, -1), { ...current, plan: clean.plan }];
      return { version: 2, entries, index: entries.length - 1 };
    }
    if (kept.length === state.entries.length && index === state.index) {
      return state;
    }
    return { version: 2, entries: kept, index: kept.length - 1 };
  }
  const withoutRepeat = kept.filter(
    (item) => !samePhraseHistoryEntry(item, clean),
  );
  const entries = [...withoutRepeat, clean];
  if (entries.length > PHRASE_HISTORY_LIMIT) {
    entries.splice(0, entries.length - PHRASE_HISTORY_LIMIT);
  }
  return { version: 2, entries, index: entries.length - 1 };
}

export type PhraseHistoryStepFocus = 'previous' | 'next' | 'new';

/**
 * The step button that was just used disables at either end.
 * Focus moves to the other step, or to New phrase when both ends are closed.
 */
export function phraseHistoryStepFocus(input: {
  direction: -1 | 1;
  index: number;
  count: number;
}): PhraseHistoryStepFocus | null {
  const atStart = input.index <= 0;
  const atEnd = input.count <= 0 || input.index >= input.count - 1;
  if (input.direction === -1 && atStart) return atEnd ? 'new' : 'next';
  if (input.direction === 1 && atEnd) return atStart ? 'new' : 'previous';
  return null;
}

/** Move within the stored phrases. The ends stay put. */
export function stepPhraseHistory(
  state: PhraseHistoryState,
  direction: -1 | 1,
): PhraseHistoryState {
  const index = clampedIndex(state);
  const next = index + direction;
  if (next < 0 || next >= state.entries.length) {
    if (index === state.index) return state;
    return { version: 2, entries: state.entries, index };
  }
  return { version: 2, entries: state.entries, index: next };
}

/**
 * Seed and bar length of the current entry when the page is still in
 * that key, scale, and chord. Null leaves the caller on a fresh phrase.
 * Back then adopts this entry and restores its context.
 */
export function phraseHistoryOpening(
  state: PhraseHistoryState,
  context: PhraseHistoryContext,
): { seed: number; bars: 2 | 4 } | null {
  const index = clampedIndex(state);
  const entry = index >= 0 ? state.entries[index] : null;
  if (
    !entry ||
    !phraseHistoryShows(entry, {
      ...context,
      seed: entry.seed,
      bars: entry.bars,
    })
  ) {
    return null;
  }
  return { seed: entry.seed, bars: entry.bars };
}

function entryOf(value: unknown): PhraseHistoryEntry | null {
  if (!isRecord(value)) return null;
  const seed = integer(value.seed, 0, 0xffffffff);
  const bars = value.bars === 2 || value.bars === 4 ? value.bars : null;
  const scaleRoot =
    typeof value.scaleRoot === 'string' && ROOT_SET.has(value.scaleRoot)
      ? value.scaleRoot
      : null;
  const scaleId =
    typeof value.scaleId === 'string' && SCALE_IDS.has(value.scaleId)
      ? value.scaleId
      : null;
  const place =
    value.place === 'scale' || value.place === 'chord' ? value.place : null;
  // Entries saved before the chord control was stored cannot be restored
  // to that control. They are dropped. Guessing the current chord would
  // play the old seed in whatever chord is on screen.
  if (!('chord' in value) || !place) return null;
  const chord = chordOf(value.chord);
  const chordNotes = notesOf(value.chordNotes);
  const locks = locksOf(value.locks);
  if (
    seed === null ||
    bars === null ||
    !scaleRoot ||
    !scaleId ||
    chord === undefined ||
    !placeAgrees(place, chord) ||
    !chordNotes ||
    !locks
  ) {
    return null;
  }
  const plan = planWords(value.plan, bars);
  const entry: PhraseHistoryEntry = {
    seed,
    bars,
    scaleRoot,
    scaleId,
    place,
    chord,
    chordNotes,
    locks,
  };
  if (plan) entry.plan = plan;
  return entry;
}

type HistoryDoc = {
  writable: boolean;
  state: PhraseHistoryState;
};

function project(raw: string | null, failedRead = false): HistoryDoc {
  if (failedRead) return { writable: false, state: EMPTY_PHRASE_HISTORY };
  if (raw == null) return { writable: true, state: EMPTY_PHRASE_HISTORY };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      (parsed.version !== 1 && parsed.version !== 2) ||
      !Array.isArray(parsed.entries)
    ) {
      return { writable: false, state: EMPTY_PHRASE_HISTORY };
    }
    const entries: PhraseHistoryEntry[] = [];
    for (const entry of parsed.entries) {
      const clean = entryOf(entry);
      if (clean) entries.push(clean);
    }
    return {
      writable: true,
      state: capLoadedHistory(
        entries,
        typeof parsed.index === 'number' ? parsed.index : Number.NaN,
      ),
    };
  } catch {
    return { writable: false, state: EMPTY_PHRASE_HISTORY };
  }
}

export function parsePhraseHistory(raw: string | null): {
  state: PhraseHistoryState;
  writable: boolean;
} {
  const doc = project(raw);
  return { state: doc.state, writable: doc.writable };
}

export function readPhraseHistory(
  storage: PhraseHistoryStorage,
): PhraseHistoryState {
  try {
    return project(storage.getItem(PHRASE_HISTORY_KEY)).state;
  } catch {
    return EMPTY_PHRASE_HISTORY;
  }
}

export function writePhraseHistory(
  storage: PhraseHistoryStorage,
  state: PhraseHistoryState,
): void {
  storage.setItem(
    PHRASE_HISTORY_KEY,
    JSON.stringify({
      version: 2,
      entries: state.entries,
      index: state.index,
    }),
  );
}

let doc: HistoryDoc | null = null;
const listeners = new Set<() => void>();

function browserStorage(): PhraseHistoryStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function loadDoc(): HistoryDoc {
  const storage = browserStorage();
  if (!storage) return { writable: false, state: EMPTY_PHRASE_HISTORY };
  try {
    return project(storage.getItem(PHRASE_HISTORY_KEY));
  } catch {
    return project(null, true);
  }
}

function current(): HistoryDoc {
  if (!doc) doc = loadDoc();
  return doc;
}

export function getPhraseHistory(): PhraseHistoryState {
  return current().state;
}

export function subscribePhraseHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Storage events only refresh memory. They never write.
 * An equal list keeps the objects already in memory. A new parse would
 * otherwise rebuild lock objects and look like a new phrase.
 */
export function onPhraseHistoryStorage(key: string | null): void {
  if (key !== PHRASE_HISTORY_KEY) return;
  const previous = doc;
  const loaded = loadDoc();
  if (
    previous &&
    previous.writable === loaded.writable &&
    samePhraseHistoryState(previous.state, loaded.state)
  ) {
    doc = previous;
  } else {
    doc = loaded;
  }
  emit();
}

function storageEventKey(event: Event): string | null {
  if (!('key' in event)) return null;
  const key = (event as { key?: unknown }).key;
  return typeof key === 'string' ? key : null;
}

/** Cross-tab storage events re-read. The handler does not write. */
export function bindPhraseHistoryStorage(target: EventTarget): () => void {
  const onStorage = (event: Event) => {
    onPhraseHistoryStorage(storageEventKey(event));
  };
  target.addEventListener('storage', onStorage);
  return () => target.removeEventListener('storage', onStorage);
}

/** A saved list longer than the cap keeps the newest phrases. */
function capLoadedHistory(
  entries: PhraseHistoryEntry[],
  index: number,
): PhraseHistoryState {
  if (entries.length === 0) return EMPTY_PHRASE_HISTORY;
  const overflow = Math.max(0, entries.length - PHRASE_HISTORY_LIMIT);
  const kept = overflow > 0 ? entries.slice(overflow) : entries;
  return {
    version: 2,
    entries: kept,
    index: clampedIndex({
      version: 2,
      entries: kept,
      index: index - overflow,
    }),
  };
}

function commit(state: PhraseHistoryState): boolean {
  const open = current();
  if (!open.writable) return false;
  const storage = browserStorage();
  if (!storage) return false;
  const payload = JSON.stringify({
    version: 2,
    entries: state.entries,
    index: state.index,
  });
  let wrote = false;
  try {
    storage.setItem(PHRASE_HISTORY_KEY, payload);
    wrote = true;
  } catch {
    wrote = false;
  }
  if (!wrote) {
    doc = { writable: true, state };
    emit();
    return false;
  }
  const refreshed = project(payload);
  doc = refreshed.writable ? refreshed : { writable: true, state };
  emit();
  return true;
}

/** Remember a phrase in this browser. A closed history is left untouched. */
export function rememberPhrase(entry: PhraseHistoryEntry): PhraseHistoryState {
  const open = current();
  if (!open.writable) return open.state;
  const next = pushPhraseHistory(open.state, entry);
  if (next === open.state) return open.state;
  commit(next);
  return current().state;
}

/**
 * Step back or forward and return the phrase now showing.
 * When the screen is not the current entry, Back adopts that entry and
 * does not write. A step never adds an entry.
 */
export function movePhraseHistory(
  direction: -1 | 1,
  showing = true,
): PhraseHistoryEntry | null {
  const open = current();
  if (!open.writable) return null;
  const index = clampedIndex(open.state);
  const cursor = index >= 0 ? (open.state.entries[index] ?? null) : null;
  if (!showing && direction === -1) return cursor;
  const next = stepPhraseHistory(open.state, direction);
  if (next === open.state) return null;
  commit(next);
  const shown = current().state;
  return shown.index >= 0 ? (shown.entries[shown.index] ?? null) : null;
}

if (typeof window !== 'undefined') bindPhraseHistoryStorage(window);
