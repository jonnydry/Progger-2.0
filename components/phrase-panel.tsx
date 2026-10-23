'use client';

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  RefreshCw,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  Turtle,
} from 'lucide-react';
import { pretty, type Note } from '@/lib/music';
import {
  bindPhraseLifecycle,
  clampPhraseTempo,
  PHRASE_TEMPO_DEFAULT,
  PHRASE_TEMPO_MAX,
  PHRASE_TEMPO_MIN,
  PhrasePlayer,
  type PhrasePlayback,
} from '@/lib/phrase-audio';
import {
  beatAtSeconds,
  CADENCE_LABEL,
  CONTOUR_LABEL,
  defaultChordNotes,
  generatePhrase,
  onsetSeconds,
  parseSeed,
  phraseFocusFret,
  phraseFretMarks,
  randomSeed,
  REGISTER_LABEL,
  RHYTHM_LABEL,
  SWING_AMOUNT_DEFAULT,
  SWING_AMOUNT_MAX,
  SWING_AMOUNT_MIN,
  SWING_AMOUNT_STEP,
  type FingeredNote,
  type PhraseDotVisibility,
  type PhraseLocks,
  type PhrasePlan,
} from '@/lib/phrase';
import { publishPhrasePlayhead, type PhraseFretMark } from '@/lib/phrase-marks';
import { DECK_BREAKPOINT_QUERY } from '@/lib/deck-breakpoints';
import {
  emptyPhraseHistory,
  getPhraseHistory,
  movePhraseHistory,
  phraseHistoryActiveLocks,
  phraseHistoryEntry,
  phraseHistoryOpening,
  phraseHistoryShows,
  phraseHistoryStepFocus,
  rememberPhrase,
  subscribePhraseHistory,
  type PhraseHistoryChord,
  type PhraseHistoryPlace,
} from '@/lib/phrase-history';
import {
  bindPhraseStop,
  dispatchPhraseStop,
  savePhrase,
  traySaveMessage,
  type TrayPhrase,
  type TrayPhraseCapture,
  type TrayPlan,
} from '@/lib/tray';
import '@/app/phrase.css';
import '@/app/phrase-deck.css';

const EMPTY_LOCKS: PhraseLocks = {};

/** Tray plans have no cell words. A generated plan may. */
function historyPlanWords(
  plan: PhrasePlan | TrayPlan,
): { form: 'answer' | 'sentence'; cells: string[] } | undefined {
  const words = plan as { form?: unknown; cells?: unknown };
  if (words.form !== 'answer' && words.form !== 'sentence') return undefined;
  if (!Array.isArray(words.cells)) return undefined;
  const cells: string[] = [];
  for (const cell of words.cells) {
    if (typeof cell !== 'string') return undefined;
    cells.push(cell);
  }
  return { form: words.form, cells };
}

type DeckMatch = {
  phone: boolean;
  stacked: boolean;
  mid: boolean;
};

function sameDeckMatch(a: DeckMatch, b: DeckMatch): boolean {
  return a.phone === b.phone && a.stacked === b.stacked && a.mid === b.mid;
}

function focusLostToDocument(): boolean {
  const active = document.activeElement;
  return (
    active === null ||
    active === document.body ||
    active === document.documentElement
  );
}

function controlIsDisabled(node: HTMLElement): boolean {
  return (
    (node instanceof HTMLButtonElement ||
      node instanceof HTMLInputElement ||
      node instanceof HTMLSelectElement ||
      node instanceof HTMLTextAreaElement) &&
    node.disabled
  );
}

/**
 * Widths follow the deck's grid areas, so tab order can match the picture.
 * Moving a focused control clears it onto the document. A focus() call in
 * that same turn sticks in Chrome and can be ignored in Firefox and Safari,
 * so try again on the next frame when the document still has focus.
 */
function useDeckBreakpoints(): {
  phone: boolean;
  stacked: boolean;
  mid: boolean;
  deckRef: RefObject<HTMLDivElement | null>;
} {
  const deckRef = useRef<HTMLDivElement>(null);
  const [phone, setPhone] = useState(false);
  const [stacked, setStacked] = useState(false);
  const [mid, setMid] = useState(false);
  const pendingFocus = useRef<HTMLElement | null>(null);
  const layout = useRef<DeckMatch>({
    phone: false,
    stacked: false,
    mid: false,
  });

  useLayoutEffect(() => {
    layout.current = { phone, stacked, mid };
    const node = pendingFocus.current;
    pendingFocus.current = null;
    if (!node) return;
    let frame = 0;
    const restore = () => {
      if (!node.isConnected || controlIsDisabled(node)) return;
      if (!focusLostToDocument()) return;
      node.focus({ preventScroll: true });
    };
    restore();
    if (node.isConnected && focusLostToDocument()) {
      frame = requestAnimationFrame(restore);
    }
    return () => cancelAnimationFrame(frame);
  }, [phone, stacked, mid]);

  useLayoutEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const phoneMedia = matchMedia(DECK_BREAKPOINT_QUERY.phone);
    const stackedMedia = matchMedia(DECK_BREAKPOINT_QUERY.stacked);
    const midMedia = matchMedia(DECK_BREAKPOINT_QUERY.mid);
    const sync = () => {
      const next = {
        phone: phoneMedia.matches,
        stacked: stackedMedia.matches,
        mid: midMedia.matches,
      };
      if (sameDeckMatch(layout.current, next)) return;
      const active = document.activeElement;
      const deck = deckRef.current;
      if (active instanceof HTMLElement && deck?.contains(active)) {
        pendingFocus.current = active;
      }
      layout.current = next;
      setPhone(next.phone);
      setStacked(next.stacked);
      setMid(next.mid);
    };
    sync();
    phoneMedia.addEventListener('change', sync);
    stackedMedia.addEventListener('change', sync);
    midMedia.addEventListener('change', sync);
    return () => {
      phoneMedia.removeEventListener('change', sync);
      stackedMedia.removeEventListener('change', sync);
      midMedia.removeEventListener('change', sync);
    };
  }, []);

  return { phone, stacked, mid, deckRef };
}

const EMPTY_NOTES: readonly FingeredNote[] = [];

function sameLocks(a: PhraseLocks, b: PhraseLocks): boolean {
  return (
    a.contour === b.contour &&
    a.rhythm === b.rhythm &&
    a.register === b.register &&
    a.cadence === b.cadence
  );
}

function historyPlace(
  chord: {
    fromContext: boolean;
  } | null,
): PhraseHistoryPlace {
  return chord && !chord.fromContext ? 'chord' : 'scale';
}

function historyChord(
  chord: {
    symbol: string;
    root: string;
    qualityId: string;
    bass?: string;
    fromContext: boolean;
    notes: readonly { name: string; pc: number; degree: string }[];
  } | null,
): PhraseHistoryChord | null {
  if (!chord) return null;
  const notes = chord.notes.map((note) => ({
    name: note.name,
    pc: note.pc,
    degree: note.degree,
  }));
  const saved: PhraseHistoryChord = {
    symbol: chord.symbol,
    root: chord.root,
    qualityId: chord.qualityId,
    fromContext: chord.fromContext,
    notes,
  };
  if (chord.bass) saved.bass = chord.bass;
  return saved;
}

/** A repeated message has to change the text, or aria-live stays quiet. */
export function saveAnnouncement(previous: string, message: string): string {
  const bare = previous.replaceAll('\u200b', '');
  if (bare === message && !previous.endsWith('\u200b')) {
    return `${message}\u200b`;
  }
  return message;
}

export function PhrasePanel({
  active,
  scaleRoot,
  scaleId,
  scaleName,
  scaleNotes,
  chord,
  held = null,
  contextKey = '',
  onReleaseHeld,
  onRestoreContext,
  capture,
  dots = 'shown',
  locks = EMPTY_LOCKS,
  onMarks,
}: {
  active: boolean;
  scaleRoot: string;
  scaleId: string;
  scaleName: string;
  scaleNotes: readonly Note[];
  chord: {
    symbol: string;
    notes: readonly Note[];
    root: string;
    qualityId: string;
    bass?: string;
    fromContext: boolean;
  } | null;
  held?: TrayPhrase | null;
  contextKey?: string;
  onReleaseHeld?: () => void;
  onRestoreContext?: (context: {
    scaleRoot: string;
    scaleId: string;
    place: PhraseHistoryPlace;
    chord: PhraseHistoryChord | null;
  }) => void;
  capture: TrayPhraseCapture;
  /** Later ear-training step passes `hidden` and keeps the same phrase. */
  dots?: PhraseDotVisibility;
  /** Later songwriting step pins contour, rhythm, register, or cadence. */
  locks?: PhraseLocks;
  onMarks: (
    marks: readonly PhraseFretMark[] | null,
    focusFret: number | null,
  ) => void;
}) {
  const chordNotes = useMemo(
    () => (chord?.notes.length ? chord.notes : defaultChordNotes(scaleNotes)),
    [chord, scaleNotes],
  );
  const chordSymbol = chord?.symbol ?? `${scaleRoot} tonic`;
  const [opening] = useState(() => {
    const saved = phraseHistoryOpening(getPhraseHistory(), {
      scaleRoot,
      scaleId,
      place: historyPlace(chord),
      chord: historyChord(chord),
      chordNotes,
      locks,
    });
    return saved ?? { seed: randomSeed(), bars: 2 as const };
  });
  const [bars, setBars] = useState<2 | 4>(opening.bars);
  const [swing, setSwing] = useState(SWING_AMOUNT_DEFAULT);
  const [tempo, setTempo] = useState(PHRASE_TEMPO_DEFAULT);
  const [slow, setSlow] = useState(false);
  const [loop, setLoop] = useState(false);
  const loopRef = useRef(loop);
  const [seed, setSeed] = useState(opening.seed);
  const [seedText, setSeedText] = useState(() => String(opening.seed));
  const [status, setStatus] = useState<PhrasePlayback>('idle');
  const [notice, setNotice] = useState('');
  const player = useRef<PhrasePlayer | null>(null);
  const seenHeld = useRef<{ id: string; key: string } | null>(null);
  const [heldCursor, setHeldCursor] = useState<string | null>(null);
  const live = useRef(false);
  const tempoRef = useRef(tempo);
  const soundingTempo = useRef(tempo);
  const swingRef = useRef(swing);
  const soundingSwing = useRef(swing);
  if ((held?.id ?? null) !== heldCursor) {
    setHeldCursor(held?.id ?? null);
    if (held) {
      setBars(held.bars);
      setTempo(held.tempo);
      setSwing(held.swing);
      setSlow(held.slow);
      setSeed(held.seed);
      setSeedText(String(held.seed));
    }
  }
  useEffect(() => {
    if (!held || heldCursor !== held.id) return;
    tempoRef.current = held.tempo;
    swingRef.current = held.swing;
  }, [held, heldCursor]);
  const history = useSyncExternalStore(
    subscribePhraseHistory,
    getPhraseHistory,
    emptyPhraseHistory,
  );
  const place = historyPlace(chord);
  const savedChord = historyChord(chord);
  const cursor =
    history.index >= 0 ? (history.entries[history.index] ?? null) : null;
  const onHistory = cursor
    ? phraseHistoryShows(cursor, {
        seed,
        bars,
        scaleRoot,
        scaleId,
        place,
        chord: savedChord,
        chordNotes,
      })
    : false;
  // Saved locks stay with that phrase. A cadence the chord cannot land is
  // ignored by generatePhrase. The page has no lock control to change.
  const generationLocks = phraseHistoryActiveLocks(cursor, onHistory, locks);
  // A cross-tab read builds new lock objects for the same phrase. Keep
  // the previous object so playback does not see a new phrase.
  const [stableLocks, setStableLocks] = useState(generationLocks);
  if (!sameLocks(stableLocks, generationLocks)) setStableLocks(generationLocks);
  const phrase = useMemo(() => {
    if (held) {
      return {
        ok: true as const,
        phrase: {
          seed: held.seed,
          bars: held.bars,
          plan: held.plan,
          source: 'rules' as const,
          notes: held.notes,
        },
      };
    }
    return generatePhrase({
      seed,
      bars,
      scaleNotes,
      chordNotes,
      locks: stableLocks,
    });
  }, [held, seed, bars, scaleNotes, chordNotes, stableLocks]);
  if (phrase.ok && phrase.phrase.seed !== seed && seedText === String(seed)) {
    setSeed(phrase.phrase.seed);
    setSeedText(String(phrase.phrase.seed));
  }
  const playbackTempo = clampPhraseTempo(slow ? tempo / 2 : tempo);
  const tempoMax = slow ? PHRASE_TEMPO_MAX / 2 : PHRASE_TEMPO_MAX;
  const trueHalf = slow && playbackTempo * 2 === tempo;
  const notes = useMemo(
    () => (phrase.ok ? phrase.phrase.notes : EMPTY_NOTES),
    [phrase],
  );
  const phraseRef = useRef(phrase);
  const barsRef = useRef(bars);
  useEffect(() => {
    const current = new PhrasePlayer((next) => {
      if (next === 'idle' || next === 'error') live.current = false;
      setStatus(next);
    });
    player.current = current;
    const pause = () => {
      live.current = false;
      current.stop();
    };
    const unbind = bindPhraseLifecycle(document, window, pause);
    const unbindStop = bindPhraseStop(window, 'panel', () => {
      live.current = false;
      current.stop();
    });
    return () => {
      unbindStop();
      unbind();
      current.dispose();
      player.current = null;
      publishPhrasePlayhead(null);
    };
  }, []);
  useEffect(() => {
    if (!held) {
      seenHeld.current = null;
      return;
    }
    if (!seenHeld.current || seenHeld.current.id !== held.id) {
      seenHeld.current = { id: held.id, key: contextKey };
      return;
    }
    if (seenHeld.current.key !== contextKey) onReleaseHeld?.();
  }, [held, contextKey, onReleaseHeld]);
  useEffect(() => {
    const turnedOff = loopRef.current && !loop;
    loopRef.current = loop;
    const phraseChanged =
      phraseRef.current !== phrase || barsRef.current !== bars;
    phraseRef.current = phrase;
    barsRef.current = bars;
    if (!active) {
      live.current = false;
      player.current?.stop();
      return;
    }
    if (!live.current) return;
    if (!phrase.ok) {
      live.current = false;
      player.current?.stop();
      return;
    }
    // Loop off mid-pass keeps this pass and lands on the closing note.
    // A new start would cut that note and begin again at beat 1.
    if (turnedOff && player.current?.isLooping) {
      player.current.finishPass();
    }
    const tempoNow = clampPhraseTempo(
      slow ? tempoRef.current / 2 : tempoRef.current,
    );
    const next = {
      notes: phrase.phrase.notes,
      bars,
      tempo: tempoNow,
      swing: swingRef.current,
      loop,
    };
    // Context, regenerate, key, scale, and bar count wait while a pass
    // is sounding. Looping switches on the next bar line. A finishing
    // pass keeps its closing note. Only the latest request is kept.
    // Stop still cuts immediately. Tempo and swing are the ones above.
    if (phraseChanged && player.current?.phraseChangeWaits()) {
      soundingTempo.current = tempoNow;
      soundingSwing.current = swingRef.current;
      player.current.queuePhrase(next);
      return;
    }
    if (turnedOff) return;
    soundingTempo.current = tempoNow;
    soundingSwing.current = swingRef.current;
    void player.current?.start(next);
  }, [active, phrase, bars, slow, loop]);
  const marks = useMemo(
    () => (phrase.ok ? phraseFretMarks(notes, dots) : null),
    [phrase.ok, notes, dots],
  );
  const focus = phrase.ok ? phraseFocusFret(notes) : null;
  useEffect(() => {
    onMarks(marks, focus);
  }, [marks, focus, onMarks]);
  useEffect(() => () => onMarks(null, null), [onMarks]);

  function commitSeed(text: string) {
    const parsed = parseSeed(text);
    if (parsed === null) {
      setSeedText(String(seed));
      return;
    }
    onReleaseHeld?.();
    setSeed(parsed);
    setSeedText(String(parsed));
  }
  function historyEntry(nextSeed: number, entryLocks: PhraseLocks) {
    const remembered =
      phrase.ok && phrase.phrase.seed === nextSeed
        ? historyPlanWords(phrase.phrase.plan)
        : undefined;
    return phraseHistoryEntry({
      seed: nextSeed,
      bars,
      scaleRoot,
      scaleId,
      place,
      chord: savedChord,
      chordNotes,
      locks: entryLocks,
      plan: remembered,
    });
  }
  function showHistoryPhrase(entry: {
    seed: number;
    bars: 2 | 4;
    scaleRoot: string;
    scaleId: string;
    place: PhraseHistoryPlace;
    chord: PhraseHistoryChord | null;
  }) {
    onReleaseHeld?.();
    onRestoreContext?.({
      scaleRoot: entry.scaleRoot,
      scaleId: entry.scaleId,
      place: entry.place,
      chord: entry.chord,
    });
    setBars(entry.bars);
    setSeed(entry.seed);
    setSeedText(String(entry.seed));
    setNotice('');
  }
  function regenerate() {
    const next = randomSeed();
    const outgoing = historyEntry(seed, generationLocks);
    const incoming = historyEntry(next, locks);
    const drifted = Boolean(
      cursor &&
      !onHistory &&
      bars === cursor.bars &&
      (seed === cursor.seed || seed === (cursor.seed + 1) >>> 0),
    );
    if (!drifted && outgoing) rememberPhrase(outgoing);
    if (incoming) rememberPhrase(incoming);
    onReleaseHeld?.();
    setSeed(next);
    setSeedText(String(next));
    setNotice('');
  }
  const previousStep = useRef<HTMLButtonElement>(null);
  const nextStep = useRef<HTMLButtonElement>(null);
  const newPhraseButton = useRef<HTMLButtonElement>(null);
  const historyFocus = useRef<'previous' | 'next' | 'new' | null>(null);
  function stepHistory(direction: -1 | 1) {
    const entry = movePhraseHistory(direction, onHistory);
    if (!entry) return;
    showHistoryPhrase(entry);
    const shown = getPhraseHistory();
    historyFocus.current = phraseHistoryStepFocus({
      direction,
      index: shown.index,
      count: shown.entries.length,
    });
  }
  useLayoutEffect(() => {
    const target = historyFocus.current;
    if (!target) return;
    historyFocus.current = null;
    const node =
      target === 'previous'
        ? previousStep.current
        : target === 'next'
          ? nextStep.current
          : newPhraseButton.current;
    if (node && !node.disabled) node.focus({ preventScroll: true });
  }, [history.index, seed, bars, scaleRoot, scaleId]);
  function chooseBars(next: 2 | 4) {
    onReleaseHeld?.();
    setBars(next);
    setNotice('');
  }
  const phraseKey = `${scaleId}:${scaleRoot}:${seed}:${bars}`;
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [saveAnnounce, setSaveAnnounce] = useState('');
  const [announcedFor, setAnnouncedFor] = useState(phraseKey);
  const savedTimer = useRef<number | null>(null);
  if (announcedFor !== phraseKey) {
    setAnnouncedFor(phraseKey);
    setSaveAnnounce('');
    setSavedFor(null);
  }
  const savedMark = savedFor === phraseKey;
  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );
  function saveToTray() {
    if (!phrase.ok) return;
    const saved = savePhrase({
      notes: phrase.phrase.notes.map((note) => ({
        name: note.name,
        pc: note.pc,
        degree: note.degree,
        midi: note.midi,
        beat: note.beat,
        duration: note.duration,
        strong: note.strong,
        chordTone: note.chordTone,
        string: note.string,
        fret: note.fret,
        finger: note.finger,
        position: note.position,
        shift: note.shift,
      })),
      key: scaleRoot,
      scaleId,
      scaleName,
      chord: chord
        ? {
            symbol: chord.symbol,
            root: chord.root,
            qualityId: chord.qualityId,
            bass: chord.bass,
            notes: chord.notes.map((note) => ({
              name: note.name,
              pc: note.pc,
              degree: note.degree,
            })),
            fromContext: chord.fromContext,
          }
        : null,
      bars: phrase.phrase.bars,
      tempo,
      slow,
      swing,
      plan: phrase.phrase.plan,
      seed: phrase.phrase.seed,
      ...capture,
    });
    const message = traySaveMessage(saved.status, 'phrase', saved.removed);
    setNotice(message);
    setSaveAnnounce((current) => saveAnnouncement(current, message));
    if (saved.status !== 'saved' && saved.status !== 'evicted') {
      setSavedFor(null);
      return;
    }
    setSavedFor(phraseKey);
    if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => {
      savedTimer.current = null;
      setSavedFor(null);
    }, 1500);
  }
  function startPlayback() {
    if (!phrase.ok) return;
    dispatchPhraseStop(window, 'panel');
    const tempoNow = clampPhraseTempo(slow ? tempo / 2 : tempo);
    soundingTempo.current = tempoNow;
    soundingSwing.current = swing;
    live.current = true;
    void player.current?.start({
      notes: phrase.phrase.notes,
      bars,
      tempo: tempoNow,
      swing,
      loop,
    });
  }
  function togglePlay() {
    if (!phrase.ok) return;
    if (live.current || status === 'playing' || status === 'starting') {
      live.current = false;
      player.current?.stop();
      return;
    }
    startPlayback();
  }
  function changeTempo(event: ChangeEvent<HTMLInputElement>) {
    const sounding = clampPhraseTempo(Number(event.target.value));
    const written = clampPhraseTempo(slow ? sounding * 2 : sounding);
    tempoRef.current = written;
    setTempo(written);
  }
  function commitTempo() {
    if (live.current) startPlayback();
  }
  const busy = status === 'playing' || status === 'starting';
  const plan = phrase.ok ? phrase.phrase.plan : null;
  const {
    phone: phoneKeys,
    stacked: stackedPlate,
    mid: midPlate,
    deckRef,
  } = useDeckBreakpoints();
  const playKey = (
    <button
      key="play"
      type="button"
      className={`phrase-action deck-key deck-key-play${busy ? ' is-latched' : ''}`}
      disabled={!phrase.ok}
      onClick={togglePlay}
    >
      {busy ? (
        <Square size={18} aria-hidden="true" />
      ) : (
        <Play size={18} aria-hidden="true" />
      )}
      <span className="deck-key-label">{busy ? 'Stop' : 'Play'}</span>
    </button>
  );
  const historyBank = (
    <fieldset key="bank" className="phrase-history-steps deck-key-bank">
      <legend className="sr-only">Phrase history</legend>
      <button
        type="button"
        className="phrase-action phrase-history-step deck-key"
        aria-label="Previous phrase"
        aria-describedby="phrase-history-hint"
        disabled={onHistory ? history.index <= 0 : !cursor}
        ref={previousStep}
        onClick={() => stepHistory(-1)}
      >
        <SkipBack size={18} aria-hidden="true" />
        <span className="deck-key-label">Previous</span>
      </button>
      <button
        type="button"
        className="phrase-action deck-key"
        ref={newPhraseButton}
        onClick={regenerate}
      >
        <RefreshCw size={18} aria-hidden="true" />
        <span className="deck-key-label">New phrase</span>
      </button>
      <button
        type="button"
        className="phrase-action phrase-history-step deck-key"
        aria-label="Next phrase"
        aria-describedby="phrase-history-hint"
        disabled={
          !onHistory ||
          history.index < 0 ||
          history.index >= history.entries.length - 1
        }
        ref={nextStep}
        onClick={() => stepHistory(1)}
      >
        <SkipForward size={18} aria-hidden="true" />
        <span className="deck-key-label">Next</span>
      </button>
    </fieldset>
  );
  const loopKey = (
    <button
      key="loop"
      type="button"
      className="phrase-action deck-key deck-key-loop"
      aria-pressed={loop}
      onClick={() => setLoop((current) => !current)}
    >
      <Repeat size={18} aria-hidden="true" />
      <span className="deck-key-label">Loop</span>
    </button>
  );
  const saveKey = (
    <button
      key="save"
      type="button"
      className={`phrase-action deck-key deck-key-rec${savedMark ? ' is-saved' : ''}`}
      disabled={!phrase.ok}
      onClick={saveToTray}
    >
      <span className="deck-rec-dot" aria-hidden="true" />
      <span className="deck-key-label">
        {savedMark ? 'Saved ✓' : 'Save to stash'}
      </span>
    </button>
  );
  const lengthControl = (
    <fieldset key="length" className="deck-switch">
      <legend className="deck-legend">
        <span className="sr-only">Phrase </span>Length
      </legend>
      <button
        type="button"
        aria-pressed={bars === 2}
        onClick={() => chooseBars(2)}
      >
        2 bars
      </button>
      <button
        type="button"
        aria-pressed={bars === 4}
        onClick={() => chooseBars(4)}
      >
        4 bars
      </button>
    </fieldset>
  );
  const tempoControl = (
    <label key="tempo" className="phrase-tempo deck-fader">
      <span className="deck-legend">Tempo</span>
      <input
        type="range"
        min={PHRASE_TEMPO_MIN}
        max={tempoMax}
        step={1}
        value={playbackTempo}
        aria-valuetext={
          trueHalf
            ? `${playbackTempo} BPM, half of ${tempo}`
            : `${playbackTempo} BPM`
        }
        onChange={changeTempo}
        onPointerUp={commitTempo}
        onKeyUp={commitTempo}
      />
      <output>{playbackTempo} BPM</output>
    </label>
  );
  const speedControl = (
    <button
      key="speed"
      type="button"
      className="phrase-action deck-toggle"
      aria-pressed={slow}
      onClick={() => setSlow((current) => !current)}
    >
      <Turtle size={16} aria-hidden="true" />
      Half speed
    </button>
  );
  const swingControl = (
    <label key="swing" className="phrase-tempo phrase-swing deck-fader">
      <span className="deck-legend">Swing</span>
      <input
        type="range"
        min={SWING_AMOUNT_MIN}
        max={SWING_AMOUNT_MAX}
        step={SWING_AMOUNT_STEP}
        value={swing}
        aria-valuetext={`${Math.round(swing * 100)} percent`}
        onChange={(event) => {
          const next = Math.min(
            SWING_AMOUNT_MAX,
            Math.max(SWING_AMOUNT_MIN, Number(event.target.value)),
          );
          swingRef.current = next;
          setSwing(next);
        }}
        onPointerUp={commitTempo}
        onKeyUp={commitTempo}
      />
      <output>{Math.round(swing * 100)}%</output>
    </label>
  );
  const seedControl = (
    <label key="seed" className="phrase-seed deck-counter">
      <span className="deck-legend">Seed</span>
      <input
        value={seedText}
        inputMode="numeric"
        aria-describedby="phrase-seed-help"
        onChange={(event) => setSeedText(event.target.value)}
        onBlur={() => commitSeed(seedText)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
        }}
      />
    </label>
  );
  const transport = phoneKeys
    ? [playKey, loopKey, saveKey, historyBank]
    : [playKey, historyBank, loopKey, saveKey];
  const plate =
    phoneKeys && !stackedPlate
      ? [lengthControl, speedControl, tempoControl, swingControl, seedControl]
      : !phoneKeys && midPlate
        ? [lengthControl, tempoControl, speedControl, seedControl, swingControl]
        : [
            lengthControl,
            tempoControl,
            speedControl,
            swingControl,
            seedControl,
          ];

  return (
    <div className="phrase-panel" data-scale-id={scaleId}>
      <div className="phrase-heading">
        <h2>Phrase</h2>
        <p>
          Over {pretty(chordSymbol)} in {pretty(scaleRoot)} {scaleName}. Rules
          only: chord tones on beats 1 and 3, mostly steps, and a landing on the{' '}
          {plan ? CADENCE_LABEL[plan.cadence] : 'chord'}.
        </p>
      </div>
      <div
        ref={deckRef}
        className={`phrase-deck deck-tape${busy ? ' is-rolling' : ''}`}
      >
        <div className="deck-window">
          <span className="deck-reel" aria-hidden="true" />
          <div className="deck-window-text">
            <p id="phrase-seed-help" className="phrase-status">
              {notice
                ? notice
                : status === 'error'
                  ? 'Audio couldn’t start. Tap Play to try again.'
                  : status === 'starting'
                    ? 'Starting…'
                    : busy
                      ? loop
                        ? 'Looping this phrase.'
                        : 'Playing this phrase.'
                      : 'Same seed replays this phrase.'}
            </p>
            {!phrase.ok && (
              <p className="phrase-status">
                {phrase.reason === 'no-shared-tones'
                  ? 'This chord has no tones in the selected scale, so the phrase has nowhere to land.'
                  : 'This plan has no playable line in the register. Try a new phrase.'}
              </p>
            )}
            {plan && (
              <p className="phrase-plan">
                {bars} bars · {CONTOUR_LABEL[plan.contour]} ·{' '}
                {RHYTHM_LABEL[plan.rhythm]} · {REGISTER_LABEL[plan.register]}{' '}
                register · ends on the {CADENCE_LABEL[plan.cadence]} · swing{' '}
                {Math.round(swing * 100)}%
                {trueHalf ? ` · half of ${tempo}` : ''}
              </p>
            )}
          </div>
          <span className="deck-reel" aria-hidden="true" />
        </div>
        <div className="deck-keys">
          {transport}
          <p id="phrase-history-hint" className="phrase-history-hint">
            Last 3 phrases.
          </p>
        </div>
        <div className="deck-plate">{plate}</div>
      </div>
      <p
        id="phrase-save-announce"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {saveAnnounce}
      </p>
      {phrase.ok && dots === 'shown' && (
        <PhraseStaff
          notes={notes}
          bars={bars}
          swing={soundingSwing}
          playing={status === 'playing'}
          player={player}
          tempoRef={soundingTempo}
        />
      )}
      {phrase.ok && (
        <ol className="sr-only">
          {notes.map((note, index) => (
            <li key={`spoken-${index}`}>
              {pretty(note.name)}, string {6 - note.string}, fret{' '}
              {note.fret === 0 ? 'open' : note.fret}, finger{' '}
              {note.finger === 0 ? 'open' : note.finger}
              {note.shift ? ', shift' : ''}
              {note.strong ? ', strong beat' : ''}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

type StaffRow = {
  id: string;
  label: string;
  landing: boolean;
  notes: {
    index: number;
    note: FingeredNote;
    x: string;
    y: string;
  }[];
  lines: string[];
  beats: { label: string; x: string }[];
};

function staffRows(notes: readonly FingeredNote[], bars: 2 | 4): StaffRow[] {
  const rows: StaffRow[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const start = (bar - 1) * 4;
    rows.push({
      id: String(bar),
      label: `Bar ${bar}`,
      landing: false,
      notes: notes.flatMap((note, index) =>
        note.beat >= start && note.beat < start + 4
          ? [
              {
                index,
                note,
                x: `${((note.beat - start) / 4) * 100}%`,
                y: `${((5 - note.string + 0.5) / 6) * 100}%`,
              },
            ]
          : [],
      ),
      lines: ['0%', '25%', '50%', '75%', '100%'],
      beats: [1, 2, 3, 4].map((beat) => ({
        label: String(beat),
        x: `${((beat - 1) / 4) * 100}%`,
      })),
    });
  }
  const landing = notes.flatMap((note, index) =>
    note.beat >= bars * 4
      ? [
          {
            index,
            note,
            x: `${((note.beat - bars * 4) / 2) * 100}%`,
            y: `${((5 - note.string + 0.5) / 6) * 100}%`,
          },
        ]
      : [],
  );
  if (landing.length) {
    rows.push({
      id: 'land',
      label: 'Lands',
      landing: true,
      notes: landing,
      lines: ['0%', '50%', '100%'],
      beats: [
        { label: '1', x: '0%' },
        { label: '2', x: '50%' },
      ],
    });
  }
  return rows;
}

function PhraseStaff({
  notes,
  bars,
  swing,
  playing,
  player,
  tempoRef,
}: {
  notes: readonly FingeredNote[];
  bars: 2 | 4;
  swing: RefObject<number>;
  playing: boolean;
  player: RefObject<PhrasePlayer | null>;
  tempoRef: RefObject<number>;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(() => staffRows(notes, bars), [notes, bars]);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !playing) {
      publishPhrasePlayhead(null);
      root?.querySelectorAll('.is-current').forEach((node) => {
        node.classList.remove('is-current');
      });
      root
        ?.querySelectorAll<HTMLElement>('[data-phrase-playhead]')
        .forEach((head) => {
          head.hidden = true;
        });
      return;
    }
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    const tick = () => {
      const elapsed = player.current?.elapsed() ?? 0;
      const tempo = tempoRef.current ?? PHRASE_TEMPO_DEFAULT;
      const swingNow = swing.current ?? SWING_AMOUNT_DEFAULT;
      let index = -1;
      for (let note = 0; note < notes.length; note++) {
        if (onsetSeconds(notes[note].beat, tempo, swingNow) <= elapsed + 0.03)
          index = note;
      }
      const beat = media.matches
        ? (notes[index]?.beat ?? 0)
        : beatAtSeconds(elapsed, tempo, swingNow);
      const landing = beat >= bars * 4;
      const barId = landing
        ? 'land'
        : String(Math.min(bars, Math.max(1, Math.floor(beat / 4) + 1)));
      const local = landing ? beat - bars * 4 : beat - (Number(barId) - 1) * 4;
      const span = landing ? 2 : 4;
      const x = `${Math.min(1, Math.max(0, local / span)) * 100}%`;
      root
        .querySelectorAll<HTMLElement>('[data-phrase-playhead]')
        .forEach((head) => {
          const mine = head.dataset.phrasePlayhead === barId;
          head.hidden = !mine;
          if (mine) head.style.left = x;
        });
      root
        .querySelectorAll<HTMLElement>('[data-phrase-note]')
        .forEach((mark) => {
          mark.classList.toggle(
            'is-current',
            mark.dataset.phraseNote === String(index),
          );
        });
      const sounding = index >= 0 ? notes[index] : null;
      publishPhrasePlayhead(
        sounding ? `${sounding.string}:${sounding.fret}` : null,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      publishPhrasePlayhead(null);
    };
  }, [playing, notes, bars, player, tempoRef, swing]);
  const staff = (
    <div className="phrase-staff" ref={rootRef} aria-hidden="true">
      {rows.map((row) => (
        <div
          className={`phrase-staff-bar${row.landing ? ' is-landing' : ''}`}
          key={row.id}
          data-phrase-bar={row.id}
        >
          <div className="phrase-staff-caption">{row.label}</div>
          <div className="phrase-staff-lane">
            {row.notes.map(({ index, note, x }) => (
              <span
                key={`finger-${index}`}
                className="phrase-staff-finger"
                data-phrase-note={index}
                style={{ left: x }}
              >
                <b>{note.finger}</b>
                {note.shift ? <i>›</i> : null}
              </span>
            ))}
          </div>
          <div className="phrase-staff-neck">
            <div className="phrase-staff-names">
              {['e', 'B', 'G', 'D', 'A', 'E'].map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
            <div className="phrase-staff-sheet">
              {['e', 'B', 'G', 'D', 'A', 'E'].map((name, index) => (
                <span
                  key={`line-${name}`}
                  className="phrase-string-line"
                  style={{ top: `${((index + 0.5) / 6) * 100}%` }}
                />
              ))}
              {row.lines.map((left) => (
                <span
                  key={left}
                  className="phrase-staff-grid"
                  style={{ left }}
                />
              ))}
              <span
                className="phrase-playhead"
                data-phrase-playhead={row.id}
                hidden
              />
              {row.notes.map(({ index, note, x, y }) => (
                <span
                  key={`fret-${index}`}
                  className="phrase-staff-fret"
                  data-phrase-note={index}
                  style={{ left: x, top: y }}
                >
                  {note.fret}
                </span>
              ))}
            </div>
          </div>
          <div className="phrase-staff-beats">
            {row.beats.map((beat) => (
              <span key={beat.label} style={{ left: beat.x }}>
                {beat.label}
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
  const host =
    typeof document === 'undefined'
      ? null
      : document.getElementById('phrase-tab-host');
  return host ? createPortal(staff, host) : staff;
}
