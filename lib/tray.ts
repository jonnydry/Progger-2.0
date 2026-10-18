import { QUALITIES } from './harmony.ts';
import { ROOTS, SCALES, pretty } from './music.ts';

/**
 * Practice tray, version 1.
 * One localStorage key. A missing key is an empty tray. Corrupt or older
 * payloads reset that key to an empty tray. This module does not import
 * the phrase generator.
 */
export const TRAY_KEY = 'progger.tray.v1';
export const TRAY_MAX_ITEMS = 80;
export const PHRASE_STOP_EVENT = 'progger-phrase-stop';

const SCALE_IDS = new Set(SCALES.map((scale) => scale.id));
const QUALITY_IDS = new Set(QUALITIES.map((quality) => quality.id));
const ROOT_SET = new Set<string>(ROOTS);
const CONTOURS = new Set(['arch', 'rise', 'fall', 'wave']);
const RHYTHMS = new Set(['quarters', 'eighths', 'long-short', 'push']);
const REGISTERS = new Set(['low', 'mid', 'high']);
const CADENCES = new Set(['root', 'third', 'fifth']);

export type TrayPlan = {
  contour: 'arch' | 'rise' | 'fall' | 'wave';
  rhythm: 'quarters' | 'eighths' | 'long-short' | 'push';
  register: 'low' | 'mid' | 'high';
  cadence: 'root' | 'third' | 'fifth';
};

/** `beat` is the onset in quarter-note beats. Playback uses it as-is. */
export type TrayPhraseNote = {
  name: string;
  pc: number;
  degree: string;
  midi: number;
  beat: number;
  duration: number;
  strong: boolean;
  chordTone: boolean;
  string: number;
  fret: number;
  finger: number;
  position: number;
  shift: boolean;
};

export type TrayChordRef = {
  symbol: string;
  root: string;
  qualityId: string;
  bass?: string;
  notes: { name: string; pc: number; degree: string }[];
  fromContext: boolean;
};

type TrayStamp = {
  id: string;
  name: string;
  savedAt: number;
};

export type TrayPhrase = TrayStamp & {
  type: 'phrase';
  notes: TrayPhraseNote[];
  key: string;
  scaleId: string;
  scaleName: string;
  chord: TrayChordRef | null;
  bars: 2 | 4;
  tempo: number;
  slow: boolean;
  swing: number;
  plan: TrayPlan;
  seed: number;
  position: number;
  view: 'map' | 'pattern';
  place: 'scale' | 'chord';
  degrees: boolean;
  left: boolean;
  chordRoot: string;
  qualityId: string;
  chordView: 'shape' | 'tones';
  voicingIndex: number;
  voicingBass: string;
  voicingStrings: string;
  voicingNearFret: number | null;
};

export type TrayScaleBookmark = TrayStamp & {
  type: 'scale';
  scaleRoot: string;
  scaleId: string;
  view: 'map' | 'pattern';
  position: number;
  degrees: boolean;
  left: boolean;
  chord: TrayChordRef | null;
};

export type TrayChordBookmark = TrayStamp & {
  type: 'chord';
  chordRoot: string;
  qualityId: string;
  chordView: 'shape' | 'tones';
  voicingIndex: number;
  voicingBass: string;
  voicingStrings: string;
  voicingNearFret: number | null;
  degrees: boolean;
  left: boolean;
  scaleRoot: string;
  scaleId: string;
};

export type TrayItem = TrayPhrase | TrayScaleBookmark | TrayChordBookmark;

export type TrayState = {
  version: 1;
  items: TrayItem[];
};

export type TrayStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type TrayPhraseCapture = {
  position: number;
  view: 'map' | 'pattern';
  place: 'scale' | 'chord';
  degrees: boolean;
  left: boolean;
  chordRoot: string;
  qualityId: string;
  chordView: 'shape' | 'tones';
  voicingIndex: number;
  voicingBass: string;
  voicingStrings: string;
  voicingNearFret: number | null;
};

export type TrayLiveView =
  | {
      kind: 'scale';
      scaleRoot: string;
      scaleId: string;
      scaleName: string;
      view: 'map' | 'pattern';
      position: number;
      degrees: boolean;
      left: boolean;
      chord: TrayChordRef | null;
    }
  | {
      kind: 'chord';
      chordRoot: string;
      qualityId: string;
      qualitySymbol: string;
      qualityName: string;
      chordView: 'shape' | 'tones';
      voicingIndex: number;
      voicingBass: string;
      voicingStrings: string;
      voicingNearFret: number | null;
      degrees: boolean;
      left: boolean;
      scaleRoot: string;
      scaleId: string;
    };

const EMPTY_TRAY: TrayState = { version: 1, items: [] };

export function emptyTray(): TrayState {
  return EMPTY_TRAY;
}

export function traySoundingTempo(tempo: number, slow: boolean): number {
  const value = slow ? tempo / 2 : tempo;
  if (!Number.isFinite(value)) return 96;
  return Math.min(240, Math.max(40, value));
}

export function defaultPhraseName(input: {
  key: string;
  scaleName: string;
  bars: 2 | 4;
}): string {
  return `${pretty(input.key)} ${input.scaleName} · ${input.bars} bars`;
}

export function defaultScaleName(input: {
  scaleRoot: string;
  scaleName: string;
  view: 'map' | 'pattern';
  position: number;
}): string {
  const where =
    input.view === 'pattern' ? `form ${input.position + 1}` : 'full neck';
  return `${pretty(input.scaleRoot)} ${input.scaleName} · ${where}`;
}

export function defaultChordName(input: {
  chordRoot: string;
  qualitySymbol: string;
  chordView: 'shape' | 'tones';
  voicingIndex: number;
}): string {
  const symbol = pretty(`${input.chordRoot}${input.qualitySymbol}`);
  const where =
    input.chordView === 'shape'
      ? `shape ${input.voicingIndex + 1}`
      : 'all tones';
  return `${symbol} · ${where}`;
}

export function trayFilename(name: string, extension: 'txt' | 'mid'): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return `${slug || 'phrase'}.${extension}`;
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

function flag(value: unknown): boolean | null {
  return value === true || value === false ? value : null;
}

function integer(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function numberIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < min || value > max) return null;
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: Set<string>,
): T | null {
  return typeof value === 'string' && allowed.has(value) ? (value as T) : null;
}

function rootOf(value: unknown): string | null {
  return typeof value === 'string' && ROOT_SET.has(value) ? value : null;
}

function scaleOf(value: unknown): string | null {
  return typeof value === 'string' && SCALE_IDS.has(value) ? value : null;
}

function qualityOf(value: unknown): string | null {
  return typeof value === 'string' && QUALITY_IDS.has(value) ? value : null;
}

function viewOf(value: unknown): 'map' | 'pattern' | null {
  return value === 'map' || value === 'pattern' ? value : null;
}

function placeOf(value: unknown): 'scale' | 'chord' | null {
  return value === 'scale' || value === 'chord' ? value : null;
}

function chordViewOf(value: unknown): 'shape' | 'tones' | null {
  return value === 'shape' || value === 'tones' ? value : null;
}

function bassOf(value: unknown): string | null {
  if (value === 'all') return 'all';
  if (typeof value !== 'string' || !/^(?:[0-9]|1[01])$/.test(value))
    return null;
  return value;
}

function stringsOf(value: unknown): string | null {
  if (value === 'all') return 'all';
  if (typeof value !== 'string' || !/^[0-5](?:,[0-5])*$/.test(value))
    return null;
  return value;
}

function nearFretOf(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = integer(value, 0, 24);
  return parsed === null ? undefined : parsed;
}

function stampOf(value: Record<string, unknown>): TrayStamp | null {
  const id = text(value.id, 80);
  const name = text(value.name, 80);
  const savedAt = integer(value.savedAt, 0, 8_640_000_000_000_000);
  if (!id || !name || savedAt === null) return null;
  return { id, name, savedAt };
}

function noteOf(value: unknown): TrayPhraseNote | null {
  if (!isRecord(value)) return null;
  const name = text(value.name, 16);
  const degree = text(value.degree, 8);
  const pc = integer(value.pc, 0, 11);
  const midi = integer(value.midi, 0, 127);
  const beat = numberIn(value.beat, 0, 64);
  const duration = numberIn(value.duration, 0.01, 32);
  const strong = flag(value.strong);
  const chordTone = flag(value.chordTone);
  const shift = flag(value.shift);
  const string = integer(value.string, 0, 5);
  const fret = integer(value.fret, 0, 24);
  const finger = integer(value.finger, 0, 4);
  const position = integer(value.position, 0, 24);
  if (
    !name ||
    !degree ||
    pc === null ||
    midi === null ||
    beat === null ||
    duration === null ||
    strong === null ||
    chordTone === null ||
    shift === null ||
    string === null ||
    fret === null ||
    finger === null ||
    position === null
  ) {
    return null;
  }
  return {
    name,
    pc,
    degree,
    midi,
    beat,
    duration,
    strong,
    chordTone,
    string,
    fret,
    finger,
    position,
    shift,
  };
}

function chordRefOf(value: unknown): TrayChordRef | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const symbol = text(value.symbol, 40);
  const root = rootOf(value.root);
  const qualityId = qualityOf(value.qualityId);
  const fromContext = flag(value.fromContext);
  if (!symbol || !root || !qualityId || fromContext === null) return undefined;
  if (!Array.isArray(value.notes) || value.notes.length > 16) return undefined;
  const notes: TrayChordRef['notes'] = [];
  for (const note of value.notes) {
    if (!isRecord(note)) return undefined;
    const name = text(note.name, 16);
    const degree = text(note.degree, 8);
    const pc = integer(note.pc, 0, 11);
    if (!name || !degree || pc === null) return undefined;
    notes.push({ name, pc, degree });
  }
  let bass: string | undefined;
  if (value.bass !== undefined) {
    const parsed = text(value.bass, 8);
    if (!parsed || !ROOT_SET.has(parsed)) return undefined;
    bass = parsed;
  }
  return bass
    ? { symbol, root, qualityId, bass, notes, fromContext }
    : { symbol, root, qualityId, notes, fromContext };
}

function planOf(value: unknown): TrayPlan | null {
  if (!isRecord(value)) return null;
  const contour = oneOf<TrayPlan['contour']>(value.contour, CONTOURS);
  const rhythm = oneOf<TrayPlan['rhythm']>(value.rhythm, RHYTHMS);
  const register = oneOf<TrayPlan['register']>(value.register, REGISTERS);
  const cadence = oneOf<TrayPlan['cadence']>(value.cadence, CADENCES);
  if (!contour || !rhythm || !register || !cadence) return null;
  return { contour, rhythm, register, cadence };
}

function handed(value: Record<string, unknown>): {
  degrees: boolean;
  left: boolean;
} | null {
  const degrees = flag(value.degrees);
  const left = flag(value.left);
  if (degrees === null || left === null) return null;
  return { degrees, left };
}

function phraseOf(value: Record<string, unknown>): TrayPhrase | null {
  const base = stampOf(value);
  const key = rootOf(value.key);
  const scaleId = scaleOf(value.scaleId);
  const scaleName = text(value.scaleName, 80);
  const bars = value.bars === 2 || value.bars === 4 ? value.bars : null;
  const tempo = integer(value.tempo, 40, 240);
  const slow = flag(value.slow);
  const swing = numberIn(value.swing, 0, 1);
  const plan = planOf(value.plan);
  const seed = integer(value.seed, 0, 0xffffffff);
  const position = integer(value.position, 0, 48);
  const view = viewOf(value.view);
  const place = placeOf(value.place);
  const hands = handed(value);
  const chordRoot = rootOf(value.chordRoot);
  const qualityId = qualityOf(value.qualityId);
  const chordView = chordViewOf(value.chordView);
  const voicingIndex = integer(value.voicingIndex, 0, 10000);
  const voicingBass = bassOf(value.voicingBass);
  const voicingStrings = stringsOf(value.voicingStrings);
  const voicingNearFret = nearFretOf(value.voicingNearFret);
  const chord = chordRefOf(value.chord);
  if (
    !base ||
    !key ||
    !scaleId ||
    !scaleName ||
    !bars ||
    tempo === null ||
    slow === null ||
    swing === null ||
    !plan ||
    seed === null ||
    position === null ||
    !view ||
    !place ||
    !hands ||
    !chordRoot ||
    !qualityId ||
    !chordView ||
    voicingIndex === null ||
    !voicingBass ||
    !voicingStrings ||
    voicingNearFret === undefined ||
    chord === undefined ||
    !Array.isArray(value.notes) ||
    value.notes.length < 1 ||
    value.notes.length > 64
  ) {
    return null;
  }
  const notes: TrayPhraseNote[] = [];
  for (const note of value.notes) {
    const parsed = noteOf(note);
    if (!parsed) return null;
    notes.push(parsed);
  }
  return {
    ...base,
    type: 'phrase',
    notes,
    key,
    scaleId,
    scaleName,
    chord,
    bars,
    tempo,
    slow,
    swing,
    plan,
    seed,
    position,
    view,
    place,
    degrees: hands.degrees,
    left: hands.left,
    chordRoot,
    qualityId,
    chordView,
    voicingIndex,
    voicingBass,
    voicingStrings,
    voicingNearFret,
  };
}

function scaleBookmarkOf(
  value: Record<string, unknown>,
): TrayScaleBookmark | null {
  const base = stampOf(value);
  const scaleRoot = rootOf(value.scaleRoot);
  const scaleId = scaleOf(value.scaleId);
  const view = viewOf(value.view);
  const position = integer(value.position, 0, 48);
  const hands = handed(value);
  const chord = chordRefOf(value.chord);
  if (
    !base ||
    !scaleRoot ||
    !scaleId ||
    !view ||
    position === null ||
    !hands ||
    chord === undefined
  ) {
    return null;
  }
  return {
    ...base,
    type: 'scale',
    scaleRoot,
    scaleId,
    view,
    position,
    degrees: hands.degrees,
    left: hands.left,
    chord,
  };
}

function chordBookmarkOf(
  value: Record<string, unknown>,
): TrayChordBookmark | null {
  const base = stampOf(value);
  const chordRoot = rootOf(value.chordRoot);
  const qualityId = qualityOf(value.qualityId);
  const chordView = chordViewOf(value.chordView);
  const voicingIndex = integer(value.voicingIndex, 0, 10000);
  const voicingBass = bassOf(value.voicingBass);
  const voicingStrings = stringsOf(value.voicingStrings);
  const voicingNearFret = nearFretOf(value.voicingNearFret);
  const hands = handed(value);
  const scaleRoot = rootOf(value.scaleRoot);
  const scaleId = scaleOf(value.scaleId);
  if (
    !base ||
    !chordRoot ||
    !qualityId ||
    !chordView ||
    voicingIndex === null ||
    !voicingBass ||
    !voicingStrings ||
    voicingNearFret === undefined ||
    !hands ||
    !scaleRoot ||
    !scaleId
  ) {
    return null;
  }
  return {
    ...base,
    type: 'chord',
    chordRoot,
    qualityId,
    chordView,
    voicingIndex,
    voicingBass,
    voicingStrings,
    voicingNearFret,
    degrees: hands.degrees,
    left: hands.left,
    scaleRoot,
    scaleId,
  };
}

function itemOf(value: unknown): TrayItem | null {
  if (!isRecord(value)) return null;
  if (value.type === 'phrase') return phraseOf(value);
  if (value.type === 'scale') return scaleBookmarkOf(value);
  if (value.type === 'chord') return chordBookmarkOf(value);
  return null;
}

/** A payload that is not version 1 in this shape asks the caller to reset. */
export function parseTray(raw: string | null): {
  state: TrayState;
  reset: boolean;
} {
  if (raw == null) return { state: EMPTY_TRAY, reset: false };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.items)
    ) {
      return { state: EMPTY_TRAY, reset: true };
    }
    if (parsed.items.length > TRAY_MAX_ITEMS)
      return { state: EMPTY_TRAY, reset: true };
    const items: TrayItem[] = [];
    const ids = new Set<string>();
    for (const entry of parsed.items) {
      const item = itemOf(entry);
      if (!item || ids.has(item.id)) return { state: EMPTY_TRAY, reset: true };
      ids.add(item.id);
      items.push(item);
    }
    return { state: { version: 1, items }, reset: false };
  } catch {
    return { state: EMPTY_TRAY, reset: true };
  }
}

export function readTray(storage: TrayStorage): TrayState {
  let raw: string | null = null;
  try {
    raw = storage.getItem(TRAY_KEY);
  } catch {
    return EMPTY_TRAY;
  }
  const parsed = parseTray(raw);
  if (parsed.reset) {
    try {
      storage.setItem(TRAY_KEY, JSON.stringify(EMPTY_TRAY));
    } catch {
      // Private mode can refuse the write. The session still shows an empty tray.
    }
  }
  return parsed.state;
}

export function writeTray(storage: TrayStorage, state: TrayState): void {
  storage.setItem(TRAY_KEY, JSON.stringify(state));
}

let cache: TrayState | null = null;
const listeners = new Set<() => void>();

function browserStorage(): TrayStorage | null {
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

export function getTray(): TrayState {
  if (!cache) {
    const storage = browserStorage();
    cache = storage ? readTray(storage) : EMPTY_TRAY;
  }
  return cache;
}

export function subscribeTray(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function commit(state: TrayState): void {
  cache = state;
  const storage = browserStorage();
  if (storage) {
    try {
      writeTray(storage, state);
    } catch {
      // The in-memory tray still updates for this visit.
    }
  }
  emit();
}

function remember(item: TrayItem): TrayItem | null {
  const checked = parseTray(JSON.stringify({ version: 1, items: [item] }));
  const stored = checked.state.items[0];
  if (checked.reset || !stored) return null;
  const items = [
    stored,
    ...getTray().items.filter((entry) => entry.id !== stored.id),
  ];
  commit({ version: 1, items: items.slice(0, TRAY_MAX_ITEMS) });
  return stored;
}

function newId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return crypto.randomUUID();
  }
  return `tray-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function savePhrase(
  input: Omit<TrayPhrase, 'id' | 'type' | 'savedAt' | 'name'> & {
    name?: string;
  },
): TrayPhrase | null {
  const name = text(input.name ?? '', 80) ?? defaultPhraseName(input);
  const saved = remember({
    ...input,
    type: 'phrase',
    id: newId(),
    name,
    savedAt: Date.now(),
  });
  return saved && saved.type === 'phrase' ? saved : null;
}

export function saveView(view: TrayLiveView): TrayItem | null {
  if (!view) return null;
  if (view.kind === 'scale') {
    return remember({
      type: 'scale',
      id: newId(),
      name: defaultScaleName(view),
      savedAt: Date.now(),
      scaleRoot: view.scaleRoot,
      scaleId: view.scaleId,
      view: view.view,
      position: view.position,
      degrees: view.degrees,
      left: view.left,
      chord: view.chord,
    });
  }
  return remember({
    type: 'chord',
    id: newId(),
    name: defaultChordName(view),
    savedAt: Date.now(),
    chordRoot: view.chordRoot,
    qualityId: view.qualityId,
    chordView: view.chordView,
    voicingIndex: view.voicingIndex,
    voicingBass: view.voicingBass,
    voicingStrings: view.voicingStrings,
    voicingNearFret: view.voicingNearFret,
    degrees: view.degrees,
    left: view.left,
    scaleRoot: view.scaleRoot,
    scaleId: view.scaleId,
  });
}

export function renameTrayItem(id: string, name: string): void {
  const next = text(name, 80);
  if (!next) return;
  commit({
    version: 1,
    items: getTray().items.map((item) =>
      item.id === id ? { ...item, name: next } : item,
    ),
  });
}

export function removeTrayItem(
  id: string,
): { item: TrayItem; index: number } | null {
  const items = getTray().items;
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) return null;
  const item = items[index];
  if (!item) return null;
  commit({ version: 1, items: items.filter((entry) => entry.id !== id) });
  return { item, index };
}

export function insertTrayItem(item: TrayItem, index: number): void {
  const items = getTray().items.filter((entry) => entry.id !== item.id);
  const at = Math.max(0, Math.min(index, items.length));
  items.splice(at, 0, item);
  commit({ version: 1, items });
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key !== TRAY_KEY) return;
    cache = null;
    emit();
  });
}
