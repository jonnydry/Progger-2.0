'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronDown,
  Play,
  RefreshCw,
  Repeat,
  SkipBack,
  SkipForward,
  Square,
  Turtle,
} from 'lucide-react';
import { diatonicChords, parseChord } from '@/lib/harmony';
import { pretty, SCALES, type Note } from '@/lib/music';
import { noteDescription } from '@/lib/note-presentation';
import {
  auditionDecaySec,
  bindPhraseLifecycle,
  clampPhraseTempo,
  PHRASE_END_RELEASE_SEC,
  PHRASE_TEMPO_DEFAULT,
  PHRASE_TEMPO_MAX,
  PHRASE_TEMPO_MIN,
  PhrasePlayer,
  type PhrasePlayback,
} from '@/lib/phrase-audio';
import {
  availableCadences,
  beatAtSeconds,
  cadenceLabel,
  CONTOUR_LABEL,
  defaultChordNotes,
  generatePhrase,
  onsetSeconds,
  parseSeed,
  phraseFocusFret,
  RHYTHM_SHORT,
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
} from '@/lib/tray';
import '@/app/phrase.css';
import '@/app/phrase-deck.css';

const EMPTY_LOCKS: PhraseLocks = {};

const EMPTY_NOTES: readonly FingeredNote[] = [];

function sameLocks(a: PhraseLocks, b: PhraseLocks): boolean {
  return (
    a.contour === b.contour &&
    a.rhythm === b.rhythm &&
    a.register === b.register &&
    a.cadence === b.cadence &&
    Boolean(a.chromatic) === Boolean(b.chromatic) &&
    Boolean(a.pickup) === Boolean(b.pickup) &&
    a.turnaround === b.turnaround
  );
}

type TurnaroundOption = {
  symbol: string;
  notes: readonly Note[];
};

function turnaroundChoicesFor(
  scaleRoot: string,
  scaleId: string,
  scaleNotes: readonly Note[],
  chordSymbol: string,
  chordNotes: readonly Note[],
): TurnaroundOption[] {
  const scale = SCALES.find((entry) => entry.id === scaleId);
  if (!scale) return [];
  const scalePcs = new Set(scaleNotes.map((note) => note.pc));
  const activeRootPc = chordNotes[0]?.pc ?? -1;
  const activePcs = new Set(chordNotes.map((note) => note.pc));
  const raw = diatonicChords(scaleRoot, scale);
  // Prefer strong functional turnarounds: V, IV, ii, vi, III, vii.
  const order = [4, 3, 1, 5, 2, 6, 0];
  const seen = new Set<string>([chordSymbol]);
  const picked: TurnaroundOption[] = [];
  for (const idx of order) {
    const entry = raw[idx];
    if (!entry || seen.has(entry.symbol)) continue;
    try {
      const parsed = parseChord(entry.symbol);
      const shared = parsed.notes.some((note) => scalePcs.has(note.pc));
      if (!shared) continue;
      // Avoid offering a triad with the same root (e.g. G7 -> G) or whose
      // tones are already a subset of the active chord.
      if (parsed.notes[0]?.pc === activeRootPc) continue;
      if (parsed.notes.every((note) => activePcs.has(note.pc))) continue;
      seen.add(entry.symbol);
      picked.push({ symbol: entry.symbol, notes: parsed.notes });
      if (picked.length >= 3) break;
    } catch {
      continue;
    }
  }
  return picked;
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

type BuildChip = string & { readonly fold: 'build' };
type TempoChip = string & { readonly fold: 'tempo' };

function buildChip(text: string): BuildChip {
  return text as BuildChip;
}

function tempoChip(text: string): TempoChip {
  return text as TempoChip;
}

function buildReadout(
  locks: PhraseLocks,
  chordNotes: readonly Note[],
  available: ReadonlySet<NonNullable<PhraseLocks['cadence']>>,
  bars: 2 | 4,
  turnaroundOptions: readonly TurnaroundOption[],
): readonly BuildChip[] {
  const cadenceChip =
    locks.cadence && available.has(locks.cadence)
      ? cadenceLabel(locks.cadence, chordNotes)
      : '';
  const turnaroundChip =
    bars === 4 &&
    locks.turnaround &&
    turnaroundOptions.some((option) => option.symbol === locks.turnaround)
      ? `→ ${pretty(locks.turnaround)}`
      : '';
  const labels = [
    locks.contour ? CONTOUR_LABEL[locks.contour] : '',
    locks.rhythm ? RHYTHM_SHORT[locks.rhythm] : '',
    locks.register ? REGISTER_LABEL[locks.register] : '',
    cadenceChip,
    locks.chromatic ? 'chromatic' : '',
    locks.pickup ? 'pickup' : '',
    turnaroundChip,
  ].filter((label) => label.length > 0);
  if (labels.length === 0) return [buildChip('Nothing pinned')];
  return [buildChip('Pinned'), ...labels.map((label) => buildChip(label))];
}

function tempoSentence(input: {
  bars: 2 | 4;
  playbackTempo: number;
  tempo: number;
  trueHalf: boolean;
  halfAtFloor: boolean;
  slow: boolean;
  swing: number;
}): readonly [TempoChip, TempoChip, TempoChip] {
  // playbackTempo is already the sounding rate. Naming it and ½× together
  // asks the player to halve the number a second time. At the 40 BPM floor
  // the sounding rate is not half of anything, so say so instead of
  // claiming a half that is not playing.
  const rate = input.trueHalf
    ? `${input.playbackTempo}\u00a0BPM, half of\u00a0${input.tempo}`
    : input.halfAtFloor
      ? `${input.playbackTempo}\u00a0BPM, half speed, minimum`
      : input.slow
        ? `${input.playbackTempo}\u00a0BPM, half speed`
        : `${input.playbackTempo}\u00a0BPM`;
  const feel =
    input.swing <= 0
      ? 'straight'
      : `swing\u00a0${Math.round(input.swing * 100)}%`;
  const bars = input.bars === 2 ? '2-bar' : '4-bar';
  return [tempoChip(bars), tempoChip(rate), tempoChip(feel)];
}

function ReadoutChips(props: { chips: readonly BuildChip[] }): ReactNode;
function ReadoutChips(props: { chips: readonly TempoChip[] }): ReactNode;
function ReadoutChips({ chips }: { chips: readonly string[] }) {
  return (
    <span className="deck-fold-readout">
      {chips.map((part, index) => {
        const last = index === chips.length - 1;
        // The dot is glued to its word. The space after the chip is
        // the only wrap point, so a narrow row breaks as
        // "2-bar ·" / "96 BPM" and never as "2-" / "bar".
        const label = last ? part : `${part}\u00A0·`;
        return (
          <span key={`${index}-${part}`}>
            <span className="deck-fold-chip">{label}</span>
            {last ? null : ' '}
          </span>
        );
      })}
    </span>
  );
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
  /**
   * Songwriting pins. Each one fixes that part of the plan and re-seeds the
   * rest, which is what turns the generator from a re-roll into a tool you can
   * steer. A pin the current chord cannot honour (a cadence its scale has no
   * third for) is dropped by the generator rather than shown as a lie.
   */
  const [pins, setPins] = useState<PhraseLocks>(EMPTY_LOCKS);
  const [suppressedHistory, setSuppressedHistory] = useState<
    Partial<Record<keyof PhraseLocks, unknown>>
  >({});
  const availableCadenceSet = useMemo(
    () => new Set(availableCadences(chordNotes, scaleNotes)),
    [chordNotes, scaleNotes],
  );
  const player = useRef<PhrasePlayer | null>(null);
  const seenHeld = useRef<{ id: string; key: string } | null>(null);
  const [heldCursor, setHeldCursor] = useState<string | null>(null);
  const live = useRef(false);
  const tempoRef = useRef(tempo);
  const soundingTempo = useRef(tempo);
  const swingRef = useRef(swing);
  const soundingSwing = useRef(swing);
  /**
   * Written feel of the pass that is sounding, for the stash snapshot.
   * Sliders move the written state before the release that commits it,
   * so state alone can name a tempo nobody is hearing. This only moves
   * when a pass actually starts: a queued pass stages its feel in
   * `queuedFeel`, and the handoff adopts it.
   */
  const soundingFeel = useRef({ tempo, slow, swing });
  const queuedFeel = useRef<{
    tempo: number;
    slow: boolean;
    swing: number;
  } | null>(null);
  if ((held?.id ?? null) !== heldCursor) {
    setHeldCursor(held?.id ?? null);
    if (held) {
      setPins(EMPTY_LOCKS);
      setSuppressedHistory({});
      setBars(held.bars);
      setTempo(held.tempo);
      setSwing(held.swing);
      setSlow(held.slow);
      setSeed(held.seed);
      setSeedText(String(held.seed));
    }
  }
  const syncedHeldId = useRef<string | null>(null);
  useEffect(() => {
    if (!held) {
      syncedHeldId.current = null;
      return;
    }
    if (syncedHeldId.current === held.id) return;
    syncedHeldId.current = held.id;
    tempoRef.current = held.tempo;
    swingRef.current = held.swing;
  }, [held]);
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
  // Saved locks stay with that phrase; local pins are added on top. A cadence
  // the chord cannot land is ignored by generatePhrase. Per-key suppression
  // lets the user toggle off individual history-restored locks without
  // losing cross-tab updates when another tab writes a different value.
  const rawHistoryLocks = phraseHistoryActiveLocks(cursor, onHistory, locks);
  const historyLocks: PhraseLocks = {};
  for (const key of [
    'contour',
    'rhythm',
    'register',
    'cadence',
    'chromatic',
    'pickup',
    'turnaround',
  ] as const) {
    const rawValue = rawHistoryLocks[key];
    if (rawValue !== undefined && rawValue !== suppressedHistory[key]) {
      (historyLocks as Record<string, unknown>)[key] = rawValue;
    }
  }
  const turnaroundOptions = useMemo(
    () =>
      turnaroundChoicesFor(
        scaleRoot,
        scaleId,
        scaleNotes,
        chordSymbol,
        chordNotes,
      ),
    [scaleRoot, scaleId, scaleNotes, chordSymbol, chordNotes],
  );
  const rawGenerationLocks: PhraseLocks = {
    ...historyLocks,
    ...pins,
  };
  const generationLocks: PhraseLocks =
    bars === 4 &&
    rawGenerationLocks.turnaround &&
    turnaroundOptions.some(
      (option) => option.symbol === rawGenerationLocks.turnaround,
    )
      ? rawGenerationLocks
      : {
          ...rawGenerationLocks,
          turnaround: undefined,
        };
  const pin = <K extends keyof PhraseLocks>(key: K, value: PhraseLocks[K]) => {
    onReleaseHeld?.();
    const alreadyActive = generationLocks[key] === value;
    setPins((current) => {
      const next = { ...current };
      if (alreadyActive) delete next[key];
      else next[key] = value;
      return next;
    });
    setSuppressedHistory((current) => {
      const next = { ...current };
      if (alreadyActive && rawHistoryLocks[key] !== undefined) {
        next[key] = rawHistoryLocks[key];
      } else {
        delete next[key];
      }
      return next;
    });
  };
  // A cross-tab read builds new lock objects for the same phrase. Keep
  // the previous object so playback does not see a new phrase.
  const [stableLocks, setStableLocks] = useState(generationLocks);
  if (!sameLocks(stableLocks, generationLocks)) setStableLocks(generationLocks);
  const activeTurnaround = useMemo(() => {
    if (bars !== 4 || !stableLocks.turnaround) return null;
    return (
      turnaroundOptions.find(
        (option) => option.symbol === stableLocks.turnaround,
      ) ?? null
    );
  }, [bars, stableLocks.turnaround, turnaroundOptions]);
  const phrase = useMemo(() => {
    if (held) {
      return {
        ok: true as const,
        phrase: {
          seed: held.seed,
          bars: held.bars,
          plan: held.plan,
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
      turnaroundChordNotes: activeTurnaround?.notes,
      turnaroundSymbol: activeTurnaround?.symbol,
    });
  }, [
    held,
    seed,
    bars,
    scaleNotes,
    chordNotes,
    stableLocks,
    activeTurnaround,
  ]);
  if (phrase.ok && phrase.phrase.seed !== seed && seedText === String(seed)) {
    setSeed(phrase.phrase.seed);
    setSeedText(String(phrase.phrase.seed));
  }
  const playbackTempo = clampPhraseTempo(slow ? tempo / 2 : tempo);
  const tempoMax = slow ? PHRASE_TEMPO_MAX / 2 : PHRASE_TEMPO_MAX;
  const trueHalf = slow && playbackTempo * 2 === tempo;
  /* Half of a tempo under 80 would sit below the 40 BPM floor, so the
     clamp holds it at 40 and it is no longer half. */
  const halfAtFloor = slow && tempo / 2 < PHRASE_TEMPO_MIN;
  /**
   * What the listener is actually hearing. A change made during a looping
   * pass waits for the bar line, so the selection can run ahead of the audio.
   * The heading, notation, fret marks, and playhead all read this frame, so
   * the screen never describes a line, key, or scale the speakers are not
   * playing. It is released when the player reports the handoff, when the
   * pass simply starts, or when playback stops.
   */
  const liveMusical = useMemo(
    () => ({ phrase, bars, scaleRoot, scaleName, chordSymbol }),
    [phrase, bars, scaleRoot, scaleName, chordSymbol],
  );
  // The full frame also carries what a stash snapshot needs: scale id,
  // chord, chord tones for the cadence label, and the written feel. Feel
  // changes alone do not hold the screen (see below), but a held frame
  // freezes them with the phrase that is sounding.
  const liveFrame = useMemo(
    () => ({
      ...liveMusical,
      scaleId,
      chord,
      chordNotes,
      tempo,
      slow,
      swing,
    }),
    [liveMusical, scaleId, chord, chordNotes, tempo, slow, swing],
  );
  /** True while a pass is actually sounding, so a change has to wait. */
  const soundingNow = status === 'playing' || status === 'starting';
  /**
   * The frame on screen. While a looping pass runs, a change to the phrase,
   * bars, key, scale, or chord waits for the bar line, so the panel keeps
   * showing `heldFrame` — the frame that is sounding — until the player
   * reports the handoff. Heading, notation, fret marks, and playhead all read
   * this one value, so they can never disagree with each other or with the
   * audio.
   */
  const [heldFrame, setHeldFrame] = useState(liveFrame);
  const [awaitingHandoff, setAwaitingHandoff] = useState(false);
  /**
   * Loop was turned off and the pass is finishing its cadence. Mirrors the
   * player's own finishing state (what `phraseChangeWaits()` reports) so
   * the hold below can keep the screen on the finishing phrase without
   * reading the player during render. Set by the Loop toggle when it
   * turns off over a live pass, cleared when a new pass starts or
   * playback stops.
   */
  const [finishingHold, setFinishingHold] = useState(false);
  const [armingLoop, setArmingLoop] = useState(false);
  const [seenFrame, setSeenFrame] = useState(liveFrame);
  if (liveFrame !== seenFrame) {
    // A new selection arrived. While a looping or finishing pass is
    // sounding, the player will defer it to the bar line or the end of
    // the cadence, so keep showing the frame that is sounding — the one
    // the panel had until this render. Every other change starts at
    // once, so the panel follows it immediately. Tempo, half speed, and
    // swing are not musical changes here: they restart playback at once
    // on commit, so they never hold the screen by themselves.
    const musicalChange =
      liveFrame.phrase !== seenFrame.phrase ||
      liveFrame.bars !== seenFrame.bars ||
      liveFrame.scaleRoot !== seenFrame.scaleRoot ||
      liveFrame.scaleName !== seenFrame.scaleName ||
      liveFrame.chordSymbol !== seenFrame.chordSymbol;
    const outgoing = seenFrame;
    setSeenFrame(liveFrame);
    if (musicalChange) {
      const deferred = soundingNow && (loop || finishingHold);
      if (deferred) {
        // Only the first deferred change captures the sounding frame. A
        // second one replaces the queued phrase in the player, and the
        // intermediate never sounds — capturing it here would put a
        // phrase nobody hears on screen.
        if (!awaitingHandoff) setHeldFrame(outgoing);
        setAwaitingHandoff(true);
      } else {
        setAwaitingHandoff(false);
      }
    }
  }
  const frame = awaitingHandoff && soundingNow ? heldFrame : liveFrame;
  const sounding = frame.phrase;
  const notes = useMemo(
    () => (sounding.ok ? sounding.phrase.notes : EMPTY_NOTES),
    [sounding],
  );
  const phraseRef = useRef(phrase);
  const barsRef = useRef(bars);
  const slowRef = useRef(slow);
  /**
   * Hand the screen the frame the player is starting. Called from the
   * player's own state callback — an external notification — so React sees
   * one update per handoff and never a synchronous setState in an effect.
   */
  const adoptQueued = useCallback(() => {
    setAwaitingHandoff(false);
    setFinishingHold(false);
    setArmingLoop(false);
    // The queued pass is sounding now, so its feel becomes the sounding
    // feel in the same beat as the screen adopts its frame.
    if (queuedFeel.current) {
      soundingFeel.current = queuedFeel.current;
      queuedFeel.current = null;
      soundingTempo.current = clampPhraseTempo(
        soundingFeel.current.slow
          ? soundingFeel.current.tempo / 2
          : soundingFeel.current.tempo,
      );
      soundingSwing.current = soundingFeel.current.swing;
    }
  }, []);
  /**
   * Drop a held change without waiting for a bar line. Stop, a context
   * change, and teardown all land here, so a stopped panel can never stay on
   * a phrase whose handoff was cancelled with the pass.
   */
  const dropQueued = useCallback(() => {
    setAwaitingHandoff(false);
    setFinishingHold(false);
    setArmingLoop(false);
    queuedFeel.current = null;
  }, []);
  useEffect(() => {
    const current = new PhrasePlayer((next) => {
      if (next === 'idle' || next === 'error') {
        live.current = false;
        // The finishing pass is over (or never started), so a later pass
        // must not be held as if its cadence were still sounding.
        setFinishingHold(false);
        setArmingLoop(false);
        queuedFeel.current = null;
      }
      // 'starting' is the bar-line handoff: the queued frame begins to sound
      // on that downbeat. 'playing' covers a handoff whose starting state was
      // coalesced away, so the screen still catches up.
      if (next === 'starting' || next === 'playing') adoptQueued();
      setStatus(next);
    });
    player.current = current;
    // Every stop path drops the queued frame as well as the audio. Without
    // this the display could stick on a phrase whose handoff will never come,
    // because Stop cancels the handoff that would have adopted it.
    const stop = () => {
      live.current = false;
      dropQueued();
      current.stop();
    };
    const pause = stop;
    const unbind = bindPhraseLifecycle(document, window, pause);
    const unbindStop = bindPhraseStop(window, 'panel', stop);
    return () => {
      unbindStop();
      unbind();
      current.dispose();
      player.current = null;
      publishPhrasePlayhead(null);
    };
  }, [dropQueued, adoptQueued]);
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
    const turnedOn = !loopRef.current && loop;
    loopRef.current = loop;
    const slowChanged = slowRef.current !== slow;
    slowRef.current = slow;
    const phraseChanged =
      phraseRef.current !== phrase || barsRef.current !== bars;
    phraseRef.current = phrase;
    barsRef.current = bars;
    // A stopped player leaves 'playing', which already lifts the hold, so
    // these paths only need to stop the audio.
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
    let finishHandled = false;
    if (turnedOff && player.current?.isLooping) {
      player.current.finishPass();
      finishHandled = true;
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
    // Loop on is armed for the end of the pass that is sounding, and that
    // replacement loops. The bar being heard plays out and its closing
    // cadence sounds; starting a fresh pass here would jump back to bar 1
    // under the player's ear, which is what this used to do.
    if (turnedOn) {
      queuedFeel.current = {
        tempo: tempoRef.current,
        slow,
        swing: swingRef.current,
      };
      player.current?.replaceAfterPass({ ...next, loop: true });
      return;
    }
    if (slowChanged && !phraseChanged && !turnedOff) {
      queuedFeel.current = {
        tempo: tempoRef.current,
        slow,
        swing: swingRef.current,
      };
      player.current?.replaceAfterPass(next);
      return;
    }
    // Context, regenerate, key, scale, and bar count wait while a pass
    // is sounding. A finishing pass keeps its closing note. Only the latest
    // request is kept. Stop still cuts immediately.
    if (phraseChanged && player.current?.phraseChangeWaits()) {
      // Stage the queued feel without touching the sounding one: the
      // playhead and a stash save during the hold must keep describing
      // the pass that is playing.
      queuedFeel.current = {
        tempo: tempoRef.current,
        slow,
        swing: swingRef.current,
      };
      player.current.queuePhrase(next);
      // The selection moved but the speakers did not. Freeze the whole frame
      // — phrase, bars, key, scale, and chord — until the player reports the
      // handoff. The hold is already set where the change was detected, so
      // nothing here has to touch state.
      return;
    }
    if (turnedOff) {
      if (!finishHandled) {
        // The sounding pass itself was not looping — it is finishing
        // its cadence, or still starting — so finishPass above did not
        // run, and a replacement armed by an earlier Loop-on can still
        // be waiting to loop. Re-queue it to play once, the same
        // rewrite finishPass gives a phrase queued under Loop. During
        // a start this supersedes the in-flight looping start instead.
        queuedFeel.current = {
          tempo: tempoRef.current,
          slow,
          swing: swingRef.current,
        };
        player.current?.queuePhrase({ ...next, loop: false });
      }
      return;
    }
    soundingTempo.current = tempoNow;
    soundingSwing.current = swingRef.current;
    soundingFeel.current = {
      tempo: tempoRef.current,
      slow,
      swing: swingRef.current,
    };
    queuedFeel.current = null;
    setAwaitingHandoff(false);
    void player.current?.start(next);
  }, [active, phrase, bars, slow, loop]);
  const marks = useMemo(
    () => (sounding.ok ? phraseFretMarks(notes, dots) : null),
    [sounding.ok, notes, dots],
  );
  const focus = sounding.ok ? phraseFocusFret(notes) : null;
  useEffect(() => {
    onMarks(marks, focus);
  }, [marks, focus, onMarks]);
  useEffect(() => () => onMarks(null, null), [onMarks]);

  function commitSeed(text: string) {
    const parsed = parseSeed(text);
    // Copy and blur commit the field even when the number did not change.
    // Releasing here dropped the stash phrase loaded on this seed.
    if (parsed === null || parsed === seed) {
      setSeedText(String(seed));
      return;
    }
    onReleaseHeld?.();
    setSeed(parsed);
    setSeedText(String(parsed));
  }
  function historyEntry(nextSeed: number, entryLocks: PhraseLocks) {
    return phraseHistoryEntry({
      seed: nextSeed,
      bars,
      scaleRoot,
      scaleId,
      place,
      chord: savedChord,
      chordNotes,
      locks: entryLocks,
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
    setPins(EMPTY_LOCKS);
    setSuppressedHistory({});
    setBars(entry.bars);
    setSeed(entry.seed);
    setSeedText(String(entry.seed));
    setNotice('');
  }
  function regenerate() {
    const next = randomSeed();
    const outgoingLocks: PhraseLocks = held
      ? {
          ...generationLocks,
          ...(held.plan.chromatic ? { chromatic: true } : {}),
          ...(held.plan.pickup ? { pickup: true } : {}),
          ...(held.plan.turnaround ? { turnaround: held.plan.turnaround } : {}),
        }
      : generationLocks;
    const outgoing = historyEntry(seed, outgoingLocks);
    const incoming = historyEntry(next, generationLocks);
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
    if (next === 2) {
      setPins((current) => {
        if (current.turnaround === undefined) return current;
        const copy = { ...current };
        delete copy.turnaround;
        return copy;
      });
    }
    setBars(next);
    setNotice('');
  }
  // The saved mark belongs to the phrase on screen. Keying it by the live
  // selection would leave "Saved ✓" lit for a queued phrase that was
  // never saved once the handoff lands.
  const phraseKey = `${frame.scaleId}:${frame.scaleRoot}:${frame.chordSymbol}:${sounding.ok ? sounding.phrase.seed : seed}:${sounding.ok ? sounding.phrase.bars : bars}:${sounding.ok ? `${sounding.phrase.plan.contour}/${sounding.phrase.plan.rhythm}/${sounding.phrase.plan.register}/${sounding.phrase.plan.cadence}/${sounding.phrase.plan.chromatic ? 'chr' : ''}/${sounding.phrase.plan.pickup ? 'pu' : ''}/${sounding.phrase.plan.turnaround ?? ''}` : ''}`;
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [saveAnnounce, setSaveAnnounce] = useState('');
  const [announcedFor, setAnnouncedFor] = useState(phraseKey);
  const savedTimer = useRef<number | null>(null);
  const seedInputRef = useRef<HTMLInputElement>(null);
  const seedCopyTimer = useRef<number | null>(null);
  const [seedCopied, setSeedCopied] = useState(false);
  if (announcedFor !== phraseKey) {
    setAnnouncedFor(phraseKey);
    setSaveAnnounce('');
    setSavedFor(null);
  }
  const savedMark = savedFor === phraseKey;
  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      if (seedCopyTimer.current !== null) {
        window.clearTimeout(seedCopyTimer.current);
      }
    },
    [],
  );
  function saveToTray() {
    // Save the phrase that is sounding, not one still waiting for a bar line.
    if (!sounding.ok) return;
    const saved = savePhrase({
      notes: sounding.phrase.notes.map((note) => ({
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
      // Key, scale, chord, and feel come from the sounding frame too.
      // The live selection can already name a queued phrase in another
      // key at another tempo, and stashing that with these notes would
      // save a phrase nobody heard.
      key: frame.scaleRoot,
      scaleId: frame.scaleId,
      scaleName: frame.scaleName,
      chord: frame.chord
        ? {
            symbol: frame.chord.symbol,
            root: frame.chord.root,
            qualityId: frame.chord.qualityId,
            bass: frame.chord.bass,
            notes: frame.chord.notes.map((note) => ({
              name: note.name,
              pc: note.pc,
              degree: note.degree,
            })),
            fromContext: frame.chord.fromContext,
          }
        : null,
      bars: sounding.phrase.bars,
      // While a pass is sounding, its started feel wins over the frame's
      // written feel: a slider can move without committing, and the
      // stash must not name that unsounded tempo or swing.
      tempo: soundingNow ? soundingFeel.current.tempo : frame.tempo,
      slow: soundingNow ? soundingFeel.current.slow : frame.slow,
      swing: soundingNow ? soundingFeel.current.swing : frame.swing,
      plan: sounding.phrase.plan,
      seed: sounding.phrase.seed,
      ...capture,
      // The restore place follows the sounding chord, not the tab the
      // selection has since moved to.
      place: historyPlace(frame.chord),
      ...(frame.chord && !frame.chord.fromContext
        ? {
            chordRoot: frame.chord.root,
            qualityId: frame.chord.qualityId,
          }
        : {}),
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
      // The tape window is the transport's only status line. Clear the save
      // notice with the button flash so it cannot mask what happens next.
      setNotice('');
    }, 1500);
  }
  const [playGen, setPlayGen] = useState(0);
  function startPlayback() {
    if (!phrase.ok) return;
    setPlayGen((current) => current + 1);
    dispatchPhraseStop(window, 'panel');
    const tempoVal = tempoRef.current;
    const swingVal = swingRef.current;
    const tempoNow = clampPhraseTempo(slow ? tempoVal / 2 : tempoVal);
    soundingTempo.current = tempoNow;
    soundingSwing.current = swingVal;
    soundingFeel.current = { tempo: tempoVal, slow, swing: swingVal };
    queuedFeel.current = null;
    live.current = true;
    void player.current?.start({
      notes: phrase.phrase.notes,
      bars,
      tempo: tempoNow,
      swing: swingVal,
      loop,
    });
  }
  function stopPlayback() {
    live.current = false;
    // Stop cancels the handoff, so drop the frame waiting for it. A
    // lingering queued frame would freeze the panel on the old phrase.
    dropQueued();
    player.current?.stop();
  }
  function toggleLoop() {
    // Turning Loop off over a live pass sends that pass into its
    // cadence (or re-queues its armed replacement to play once). Hold
    // the screen on it until the player reports the next start.
    // Turning Loop on over a live plain pass lets that pass finish its
    // cadence before looping, so keep Lands active until the handoff.
    if (loop && live.current) setFinishingHold(true);
    if (!loop && live.current) setArmingLoop(true);
    setLoop((current) => !current);
  }
  function togglePlay() {
    if (!phrase.ok) return;
    setNotice('');
    if (live.current || status === 'playing' || status === 'starting') {
      stopPlayback();
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
  /**
   * Tempo is immediate, per Jonny's Loop rule. Nudging the tempo re-issues the
   * pass as soon as the slider is released; it never waits for a bar line,
   * because a practice tempo you have to wait a whole pass for is not a tempo
   * control. Loop, half speed, and phrase changes keep their bar-line handoff.
   */
  function commitTempo() {
    if (!live.current) return;
    if (
      tempoRef.current === soundingFeel.current.tempo &&
      swingRef.current === soundingFeel.current.swing
    ) {
      return;
    }
    startPlayback();
  }
  const quickStep = slow ? 4 : 8;
  function stepQuickTempo(delta: number) {
    const currentSounding = clampPhraseTempo(
      slow ? tempoRef.current / 2 : tempoRef.current,
    );
    const targetSounding = clampPhraseTempo(
      Math.min(
        tempoMax,
        Math.max(PHRASE_TEMPO_MIN, Math.round(currentSounding + delta)),
      ),
    );
    const written = clampPhraseTempo(slow ? targetSounding * 2 : targetSounding);
    if (written === tempoRef.current) return;
    tempoRef.current = written;
    setTempo(written);
    if (live.current) startPlayback();
  }
  const busy = status === 'playing' || status === 'starting';
  const plan = sounding.ok ? sounding.phrase.plan : null;
  // The label names the degree the phrase actually lands on. A minor-blues
  // tonic has both a flat fifth and a fifth in its default chord, and the
  // cadence is the fifth, so the readout must not say "5th" when it means
  // "the tritone" (or the reverse).
  const cadenceText = plan ? cadenceLabel(plan.cadence, frame.chordNotes) : '';
  const planExtras = plan
    ? [
        plan.turnaround
          ? `moving to ${pretty(plan.turnaround)} in bars 3 and 4`
          : '',
        plan.chromatic ? 'with chromatic approaches' : '',
        plan.pickup ? 'starting on the pickup' : '',
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const planSentence = plan
    ? `${CONTOUR_LABEL[plan.contour]} contour, ${RHYTHM_LABEL[plan.rhythm]}, ${REGISTER_LABEL[plan.register]} register, landing on the ${cadenceText}${planExtras ? `, ${planExtras}` : ''}.`
    : '';
  const playKey = (
    <button
      key="play"
      type="button"
      className={`phrase-action deck-key deck-key-play${busy ? ' is-latched' : ''}`}
      aria-label={busy ? 'Stop phrase' : 'Play phrase'}
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
  const newPhraseKey = (
    <button
      key="new"
      type="button"
      className="phrase-action deck-key deck-key-new"
      ref={newPhraseButton}
      onClick={regenerate}
    >
      <RefreshCw size={18} aria-hidden="true" />
      <span className="deck-key-label">New phrase</span>
    </button>
  );
  const historyBank = (
    <fieldset key="bank" className="phrase-history-steps deck-key-bank">
      <legend className="sr-only">Phrase history</legend>
      <p id="phrase-history-hint" className="sr-only">
        Last 3 phrases.
      </p>
      <button
        type="button"
        className="phrase-action phrase-history-step deck-key deck-key-quiet"
        aria-label="Previous phrase"
        title="Previous phrase"
        aria-describedby="phrase-history-hint"
        disabled={onHistory ? history.index <= 0 : !cursor}
        ref={previousStep}
        onClick={() => stepHistory(-1)}
      >
        <SkipBack size={16} aria-hidden="true" />
        <span className="deck-key-label">Previous</span>
      </button>
      <button
        type="button"
        className="phrase-action phrase-history-step deck-key deck-key-quiet"
        aria-label="Next phrase"
        title="Next phrase"
        aria-describedby="phrase-history-hint"
        disabled={
          !onHistory ||
          history.index < 0 ||
          history.index >= history.entries.length - 1
        }
        ref={nextStep}
        onClick={() => stepHistory(1)}
      >
        <SkipForward size={16} aria-hidden="true" />
        <span className="deck-key-label">Next</span>
      </button>
    </fieldset>
  );
  const loopKey = (
    <button
      key="loop"
      type="button"
      className="phrase-action deck-key deck-key-loop deck-key-quiet"
      aria-pressed={loop}
      onClick={toggleLoop}
    >
      <Repeat size={16} aria-hidden="true" />
      <span className="deck-key-label">Loop</span>
    </button>
  );
  const saveKey = (
    <button
      key="save"
      type="button"
      className={`phrase-action deck-key deck-key-rec deck-key-quiet${savedMark ? ' is-saved' : ''}`}
      disabled={!phrase.ok}
      onClick={saveToTray}
    >
      <span className="deck-rec-dot" aria-hidden="true" />
      <span className="deck-key-label">
        {savedMark ? 'Saved ✓' : 'Save to stash'}
      </span>
    </button>
  );
  const statusAlert =
    status === 'error' ||
    !phrase.ok ||
    notice.startsWith('Could not save') ||
    notice === 'Stash is full.' ||
    notice.startsWith('Stash full,');
  const lengthControl = (
    <fieldset key="length" className="deck-setting deck-setting-bars">
      <legend className="deck-legend">Bars</legend>
      <div className="deck-switch">
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
      </div>
    </fieldset>
  );
  const tempoControl = (
    <div key="tempo" className="deck-setting deck-setting-tempo">
      <label className="phrase-tempo deck-fader">
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
              : halfAtFloor
                ? `${playbackTempo} BPM, half speed, minimum`
                : `${playbackTempo} BPM`
          }
          onChange={changeTempo}
          onPointerUp={commitTempo}
          onPointerCancel={commitTempo}
          onKeyUp={commitTempo}
        />
        <output>{playbackTempo} BPM</output>
      </label>
      <button
        type="button"
        className="phrase-action deck-toggle deck-speed"
        aria-pressed={slow}
        aria-label="Half speed"
        title="Half speed"
        onClick={() => setSlow((current) => !current)}
      >
        <Turtle size={16} aria-hidden="true" />
        <span className="deck-speed-text">Half speed</span>
      </button>
    </div>
  );
  const swingControl = (
    <div key="swing" className="deck-setting deck-setting-swing">
      <label className="phrase-tempo phrase-swing deck-fader">
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
          onPointerCancel={commitTempo}
          onKeyUp={commitTempo}
        />
        <output>{Math.round(swing * 100)}%</output>
      </label>
    </div>
  );
  function copySeed() {
    const input = seedInputRef.current;
    if (!input) return;
    const parsed = parseSeed(input.value);
    if (parsed === null) {
      input.focus();
      input.select();
      return;
    }
    let writing: Promise<void>;
    try {
      writing = navigator.clipboard.writeText(String(parsed));
    } catch {
      input.focus();
      input.select();
      return;
    }
    void writing.then(
      () => {
        setSeedCopied(true);
        if (seedCopyTimer.current !== null) {
          window.clearTimeout(seedCopyTimer.current);
        }
        seedCopyTimer.current = window.setTimeout(() => {
          seedCopyTimer.current = null;
          setSeedCopied(false);
        }, 1500);
      },
      () => {
        input.focus();
        input.select();
      },
    );
  }
  const buildChips = buildReadout(
    generationLocks,
    chordNotes,
    availableCadenceSet,
    bars,
    turnaroundOptions,
  );
  const hasPins = buildChips[0] === 'Pinned';
  const studioHeader = (
    <div className="phrase-heading">
      <div className="phrase-heading-context">
        <h2>Phrase</h2>
        <p>
          Over {pretty(frame.chordSymbol)}
          {plan?.turnaround ? ` → ${pretty(plan.turnaround)}` : ''} in{' '}
          {pretty(frame.scaleRoot)} {frame.scaleName}.
        </p>
      </div>
      <div className="phrase-studio-quick">
        <fieldset className="phrase-quick-group phrase-quick-bars">
          <legend className="sr-only">Quick length</legend>
          <button
            type="button"
            className="phrase-quick-btn"
            aria-pressed={bars === 2}
            onClick={() => chooseBars(2)}
          >
            2-bar
          </button>
          <button
            type="button"
            className="phrase-quick-btn"
            aria-pressed={bars === 4}
            onClick={() => chooseBars(4)}
          >
            4-bar
          </button>
        </fieldset>
        <fieldset className="phrase-quick-group phrase-quick-tempo">
          <legend className="sr-only">Quick tempo</legend>
          <button
            type="button"
            className="phrase-quick-step"
            aria-label={`Slower tempo (−${quickStep} BPM)`}
            title={`Slower (−${quickStep} BPM)`}
            disabled={playbackTempo <= PHRASE_TEMPO_MIN}
            onClick={() => stepQuickTempo(-quickStep)}
          >
            −
          </button>
          <output
            className="phrase-quick-bpm"
            aria-live="off"
            title={
              trueHalf
                ? `${playbackTempo} BPM (half of ${tempo})`
                : halfAtFloor
                  ? `${playbackTempo} BPM (half speed, minimum)`
                  : `${playbackTempo} BPM`
            }
          >
            {Math.round(playbackTempo)} BPM
          </output>
          <button
            type="button"
            className="phrase-quick-step"
            aria-label={`Faster tempo (+${quickStep} BPM)`}
            title={`Faster (+${quickStep} BPM)`}
            disabled={playbackTempo >= tempoMax}
            onClick={() => stepQuickTempo(quickStep)}
          >
            +
          </button>
        </fieldset>
      </div>
    </div>
  );
  const staffHost =
    typeof document === 'undefined'
      ? null
      : document.getElementById('phrase-tab-host');
  const portaledHeader = sounding.ok && dots === 'shown' && Boolean(staffHost);
  return (
    <div className="phrase-panel" data-scale-id={scaleId}>
      {!portaledHeader && studioHeader}
      <div className={`phrase-deck deck-tape${busy ? ' is-rolling' : ''}`}>
        {/*
          The cassette bay: the window is the face of the deck and the keys
          sit under it, as on a real tape deck. Every row of the window has a
          fixed height, so a plan that unmounts, a notice, or an error never
          moves the keys below it. The window holds no controls, so the tab
          order is the key order at every width.
        */}
        <div className="deck-bay">
          <div className={`deck-window${phrase.ok ? '' : ' is-blank'}`}>
            <div className="deck-label">
              {plan && (
                /* The cassette label, in two fixed lines: how the line
                   moves, then where it sits and ends. */
                <p className="phrase-plan">
                  <span className="phrase-plan-line">
                    {CONTOUR_LABEL[plan.contour]} · {RHYTHM_LABEL[plan.rhythm]}
                  </span>{' '}
                  <span className="phrase-plan-line phrase-plan-sub">
                    {REGISTER_LABEL[plan.register]} · lands on the{' '}
                    <em className="phrase-plan-cadence">{cadenceText}</em>
                  </span>
                </p>
              )}
            </div>
            <div className="deck-tape-track" aria-hidden="true" />
            <span className="deck-reel deck-reel-left" aria-hidden="true" />
            {/* Live status line, between the reels. The id predates the
                seed field getting its own static note; tests still read
                status by it. */}
            <p
              id="phrase-seed-help"
              className={`phrase-status${
                statusAlert ? ' is-alert' : busy || notice ? ' is-live' : ''
              }`}
            >
              {!phrase.ok
                ? phrase.reason === 'no-shared-tones'
                  ? 'This chord has no tones in the selected scale, so the phrase has nowhere to land.'
                  : 'This plan has no playable line in the register. Try a new phrase.'
                : status === 'error'
                  ? 'Audio couldn’t start. Tap Play to try again.'
                  : notice
                    ? notice
                    : status === 'starting'
                      ? 'Starting…'
                      : busy
                        ? loop
                          ? 'Looping this phrase.'
                          : 'Playing this phrase.'
                        : 'Same seed replays this phrase.'}
            </p>
            <span className="deck-reel deck-reel-right" aria-hidden="true" />
          </div>
          {/*
            The plan line is visual shorthand. A screen reader gets one
            sentence that says the same thing, and it is a live region so a
            regenerated phrase is announced instead of changing silently.
          */}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {plan ? `Phrase ${planSentence}` : ''}
          </p>
          <div className="deck-zone">
            <h3 className="sr-only">Play</h3>
            <div className="deck-transport">
              <div className="deck-lead">
                {playKey}
                {newPhraseKey}
              </div>
              <div className="deck-quiet">
                {historyBank}
                {loopKey}
                {saveKey}
              </div>
            </div>
          </div>
        </div>
        <details className="deck-fold deck-build">
          <summary
            className="deck-fold-summary"
            data-pinned={hasPins ? 'true' : undefined}
          >
            <span className="deck-legend">Build</span>
            <ReadoutChips chips={buildChips} />
            <span className="deck-fold-edit" aria-hidden="true">
              Edit
            </span>
            <ChevronDown
              className="deck-chevron"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="deck-fold-body">
            <PhrasePins
              plan={plan}
              locks={generationLocks}
              chordNotes={chordNotes}
              available={availableCadenceSet}
              bars={bars}
              turnaroundOptions={turnaroundOptions}
              onPin={pin}
              onClear={() => {
                onReleaseHeld?.();
                setPins(EMPTY_LOCKS);
                setSuppressedHistory({ ...rawHistoryLocks });
              }}
            />
          </div>
        </details>
        <details className="deck-fold deck-feel">
          <summary className="deck-fold-summary">
            <span className="deck-legend">Feel?</span>
            <ReadoutChips
              chips={tempoSentence({
                bars,
                playbackTempo,
                tempo,
                trueHalf,
                halfAtFloor,
                slow,
                swing,
              })}
            />
            <span className="deck-fold-edit" aria-hidden="true">
              Edit
            </span>
            <ChevronDown
              className="deck-chevron"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="deck-fold-body deck-stack">
            {lengthControl}
            {tempoControl}
            {swingControl}
            <details
              className="deck-seed"
              onToggle={(event) => {
                if (!event.currentTarget.open) return;
                /* Desktop only: focusing on a phone or tablet opens the
                   keyboard over the deck before the number can be read. */
                if (
                  window.matchMedia(DECK_BREAKPOINT_QUERY.phone).matches ||
                  window.matchMedia('(pointer: coarse)').matches
                ) {
                  return;
                }
                const input = seedInputRef.current;
                if (!input) return;
                input.focus();
                input.select();
              }}
            >
              <summary aria-label="Seed">
                <span className="deck-legend">Seed</span>
                <span className="deck-seed-hint">Show the number</span>
                <ChevronDown
                  className="deck-chevron"
                  size={18}
                  aria-hidden="true"
                />
              </summary>
              <div className="deck-seed-fields">
                {/* Static help for the seed field. The status line in the
                    tape window changes with playback, so it cannot double
                    as this input's description. */}
                <span id="phrase-seed-note" className="sr-only">
                  Same seed replays this phrase.
                </span>
                <label className="phrase-seed deck-counter">
                  <span className="sr-only">Seed</span>
                  <input
                    ref={seedInputRef}
                    // The seed is an editable control, like the bars toggle: it shows
                    // the phrase you are editing, which can be queued behind the bar
                    // line. The heading, staff, and frets show what is sounding, so
                    // those wait for the handoff and this does not.
                    value={seedText}
                    inputMode="numeric"
                    aria-describedby="phrase-seed-note"
                    onChange={(event) => setSeedText(event.target.value)}
                    onBlur={() => commitSeed(seedText)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.currentTarget.blur();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="deck-toggle deck-seed-copy"
                  onClick={copySeed}
                >
                  {seedCopied ? 'Copied' : 'Copy seed'}
                </button>
              </div>
            </details>
          </div>
        </details>
      </div>
      <p
        id="phrase-save-announce"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        {saveAnnounce}
      </p>
      {sounding.ok && dots === 'shown' && (
        <PhraseStaff
          header={portaledHeader ? studioHeader : undefined}
          notes={notes}
          bars={frame.bars}
          turnaround={plan?.turnaround}
          looping={loop && !finishingHold && !armingLoop}
          swing={soundingSwing}
          playing={status === 'playing'}
          busy={busy}
          playGen={playGen}
          player={player}
          tempoRef={soundingTempo}
          onAuditionStart={() => dispatchPhraseStop(window, 'panel')}
          onAuditionStop={busy ? stopPlayback : undefined}
        />
      )}
      {sounding.ok && (
        <ol className="sr-only" aria-label="Phrase notes in order">
          {notes.map((note, index) => {
            const bar = Math.floor(note.beat / 4) + 1;
            const beatInBar = (note.beat % 4) + 1;
            const durText =
              note.duration >= 2
                ? 'half note'
                : note.duration >= 1.5
                  ? 'dotted quarter'
                  : note.duration >= 1
                    ? 'quarter note'
                    : 'eighth note';
            return (
              <li key={`spoken-${index}`}>
                {pretty(note.name)}, string {6 - note.string}, fret{' '}
                {note.fret === 0 ? 'open' : note.fret}, finger{' '}
                {note.finger === 0 ? 'open' : note.finger}, bar {bar} beat{' '}
                {beatInBar}, {durText}
                {note.shift ? ', shift' : ''}
                {note.strong ? ', strong beat' : ''}
                {note.degree === 'chr'
                  ? ', chromatic approach'
                  : note.chordTone
                    ? ', chord tone'
                    : ''}
              </li>
            );
          })}
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
    holdWidth: string | null;
  }[];
  lines: string[];
  beats: { label: string; x: string }[];
};

type PinOption<K extends keyof PhraseLocks> = {
  key: K;
  label: string;
  values: readonly {
    value: NonNullable<PhraseLocks[K]>;
    label: string;
    disabled?: boolean;
  }[];
};

/**
 * Pin one part of the plan and re-seed the rest. Pressing a lit pin releases
 * it, so the same button both fixes and frees that field. Everything is a
 * button rather than a select: a four-value plan field is cheaper to scan as
 * a row, and the deck's phone layout already stacks the rows.
 *
 * A fieldset's legend cannot share a layout track with its options, so the
 * visible legend is positioned over the row's label gutter and the row gets
 * its accessible name from `aria-label` — "Pin contour" rather than a bare
 * "Contour", which said nothing about what pressing one does. The rows sit
 * inside the Build fold, so they are not on the first look.
 */
function PhrasePins({
  plan,
  locks,
  chordNotes,
  available,
  bars,
  turnaroundOptions,
  onPin,
  onClear,
}: {
  plan: PhrasePlan | null;
  locks: PhraseLocks;
  chordNotes: readonly Note[];
  available: ReadonlySet<NonNullable<PhraseLocks['cadence']>>;
  bars: 2 | 4;
  turnaroundOptions: readonly TurnaroundOption[];
  onPin: <K extends keyof PhraseLocks>(
    key: K,
    value: NonNullable<PhraseLocks[K]>,
  ) => void;
  onClear: () => void;
}) {
  const hintId = 'phrase-pins-hint';
  const rows: PinOption<'contour' | 'rhythm' | 'register' | 'cadence'>[] = [
    {
      key: 'contour',
      label: 'Contour',
      values: [
        { value: 'arch', label: 'arch' },
        { value: 'rise', label: 'rise' },
        { value: 'fall', label: 'fall' },
        { value: 'wave', label: 'wave' },
      ],
    },
    {
      key: 'rhythm',
      label: 'Rhythm',
      values: [
        { value: 'quarters', label: RHYTHM_SHORT.quarters },
        { value: 'eighths', label: RHYTHM_SHORT.eighths },
        { value: 'long-short', label: RHYTHM_SHORT['long-short'] },
        { value: 'push', label: RHYTHM_SHORT.push },
      ],
    },
    {
      key: 'register',
      label: 'Register',
      values: [
        { value: 'low', label: REGISTER_LABEL.low },
        { value: 'mid', label: REGISTER_LABEL.mid },
        { value: 'high', label: REGISTER_LABEL.high },
      ],
    },
    {
      key: 'cadence',
      label: 'Lands on',
      values: (['root', 'third', 'fifth'] as const).map((target) => ({
        value: target,
        label: cadenceLabel(target, chordNotes),
        disabled: !available.has(target),
      })),
    },
  ];
  const pinned = Object.entries(locks).some(
    ([key, value]) =>
      value !== undefined &&
      value !== false &&
      (key !== 'cadence' ||
        available.has(value as NonNullable<PhraseLocks['cadence']>)) &&
      (key !== 'turnaround' ||
        (bars === 4 &&
          turnaroundOptions.some((option) => option.symbol === value))),
  );
  return (
    <div className="phrase-pins">
      <p className="phrase-pins-title">
        <span id={hintId} className="phrase-pins-hint">
          Pin any
        </span>
        {pinned ? (
          <button type="button" className="phrase-pins-clear" onClick={onClear}>
            Clear pins
          </button>
        ) : null}
      </p>
      <div className="phrase-pin-grid">
        {rows.map((row) => (
          <fieldset
            key={row.key}
            className="phrase-pin-row"
            aria-label={`Pin ${row.label.toLowerCase()}`}
            aria-describedby={hintId}
            data-options={row.values.length}
          >
            <legend className="deck-legend">{row.label}</legend>
            <div className="phrase-pin-line">
              {row.values.map((option) => {
                const disabled = Boolean(option.disabled);
                const active = !disabled && locks[row.key] === option.value;
                const current = !disabled && plan?.[row.key] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    disabled={disabled}
                    title={
                      disabled
                        ? 'Not shared by this chord and scale'
                        : undefined
                    }
                    aria-pressed={active}
                    className={`phrase-pin${current && !active ? ' is-current' : ''}`}
                    onClick={() => onPin(row.key, option.value)}
                  >
                    {option.label}
                    {current && !active ? (
                      <span className="sr-only"> (playing now)</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
        <fieldset
          className="phrase-pin-row"
          aria-label="Pin style"
          aria-describedby={hintId}
          data-options={2}
        >
          <legend className="deck-legend">Style</legend>
          <div className="phrase-pin-line">
            <button
              type="button"
              aria-pressed={Boolean(locks.chromatic)}
              className={`phrase-pin${plan?.chromatic && !locks.chromatic ? ' is-current' : ''}`}
              title="Allow half-step chromatic approaches into chord tones"
              onClick={() => onPin('chromatic', true)}
            >
              chromatic
              {plan?.chromatic && !locks.chromatic ? (
                <span className="sr-only"> (playing now)</span>
              ) : null}
            </button>
            <button
              type="button"
              aria-pressed={Boolean(locks.pickup)}
              className={`phrase-pin${plan?.pickup && !locks.pickup ? ' is-current' : ''}`}
              title="Start on the upbeat after beat 1"
              onClick={() => onPin('pickup', true)}
            >
              pickup
              {plan?.pickup && !locks.pickup ? (
                <span className="sr-only"> (playing now)</span>
              ) : null}
            </button>
          </div>
        </fieldset>
        {turnaroundOptions.length > 0 && (
          <fieldset
            className="phrase-pin-row"
            aria-label="Pin bar 3–4 turnaround"
            aria-describedby={bars !== 4 ? 'phrase-turnaround-hint' : hintId}
            data-options={turnaroundOptions.length}
          >
            <legend className="deck-legend">Bar 3–4</legend>
            {bars !== 4 ? (
              <span id="phrase-turnaround-hint" className="sr-only">
                Switch to 4 bars to pick a turnaround chord.
              </span>
            ) : null}
            <div className="phrase-pin-line">
              {turnaroundOptions.map((option) => {
                const disabled = bars !== 4;
                const active = !disabled && locks.turnaround === option.symbol;
                const current =
                  !disabled && plan?.turnaround === option.symbol;
                return (
                  <button
                    key={option.symbol}
                    type="button"
                    disabled={disabled}
                    title={
                      disabled
                        ? 'Switch to 4 bars for a turnaround chord'
                        : `Move to ${pretty(option.symbol)} in bars 3–4`
                    }
                    aria-pressed={active}
                    className={`phrase-pin${current && !active ? ' is-current' : ''}`}
                    onClick={() => onPin('turnaround', option.symbol)}
                  >
                    {pretty(option.symbol)}
                    {current && !active ? (
                      <span className="sr-only"> (playing now)</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
      </div>
    </div>
  );
}

function staffRows(
  notes: readonly FingeredNote[],
  bars: 2 | 4,
  turnaround?: string,
): StaffRow[] {
  const rows: StaffRow[] = [];
  for (let bar = 1; bar <= bars; bar++) {
    const start = (bar - 1) * 4;
    rows.push({
      id: String(bar),
      label:
        (bar === 3 || bar === 4) && turnaround
          ? `Bar ${bar} · ${pretty(turnaround)}`
          : `Bar ${bar}`,
      landing: false,
      notes: notes.flatMap((note, index) => {
        if (note.beat < start || note.beat >= start + 4) return [];
        const local = note.beat - start;
        const holdBeats = Math.min(note.duration, 4 - local);
        return [
          {
            index,
            note,
            x: `${(local / 4) * 100}%`,
            y: `${((5 - note.string + 0.5) / 6) * 100}%`,
            holdWidth:
              note.duration >= 1
                ? `${Math.max(4, (holdBeats / 4) * 100 - 2)}%`
                : null,
          },
        ];
      }),
      lines: ['0%', '25%', '50%', '75%', '100%'],
      beats: [1, 2, 3, 4].map((beat) => ({
        label: String(beat),
        x: `${((beat - 1) / 4) * 100}%`,
      })),
    });
  }
  const landing = notes.flatMap((note, index) => {
    if (note.beat < bars * 4) return [];
    const local = note.beat - bars * 4;
    const holdBeats = Math.min(note.duration, 2 - local);
    return [
      {
        index,
        note,
        x: `${(local / 2) * 100}%`,
        y: `${((5 - note.string + 0.5) / 6) * 100}%`,
        holdWidth:
          note.duration >= 1
            ? `${Math.max(6, (holdBeats / 2) * 100 - 3)}%`
            : null,
      },
    ];
  });
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
  header,
  notes,
  bars,
  turnaround,
  looping,
  swing,
  playing,
  busy,
  playGen,
  player,
  tempoRef,
  onAuditionStart,
  onAuditionStop,
}: {
  header?: ReactNode;
  notes: readonly FingeredNote[];
  bars: 2 | 4;
  turnaround?: string;
  looping: boolean;
  swing: RefObject<number>;
  playing: boolean;
  busy: boolean;
  playGen: number;
  player: RefObject<PhrasePlayer | null>;
  tempoRef: RefObject<number>;
  onAuditionStart?: () => void;
  onAuditionStop?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [preview, setPreview] = useState<{
    notes: readonly FingeredNote[];
    index: number;
    gen: number;
  } | null>(null);
  const [focusState, setFocusState] = useState<{
    notes: readonly FingeredNote[];
    index: number;
  }>({ notes, index: 0 });
  const previewingRef = useRef(false);
  const suppressNextNotesStopRef = useRef(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useMemo(
    () => staffRows(notes, bars, turnaround),
    [notes, bars, turnaround],
  );
  const previewIndex =
    !busy && preview && preview.notes === notes && preview.gen === playGen
      ? preview.index
      : null;
  const clampedFocus =
    notes.length === 0 || focusState.notes !== notes
      ? 0
      : Math.min(focusState.index, notes.length - 1);
  const clearPreviewTimer = useCallback(() => {
    if (previewTimerRef.current !== null) {
      clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (!busy) return;
    clearPreviewTimer();
    previewingRef.current = false;
  }, [busy, clearPreviewTimer]);
  useEffect(() => {
    if (suppressNextNotesStopRef.current) {
      suppressNextNotesStopRef.current = false;
      return;
    }
    clearPreviewTimer();
    previewingRef.current = false;
    player.current?.stopAudition(false);
    publishPhrasePlayhead(null);
  }, [notes, player, clearPreviewTimer]);
  useEffect(
    () => () => {
      clearPreviewTimer();
      previewingRef.current = false;
      player.current?.stopAudition(false);
      publishPhrasePlayhead(null);
    },
    [player, clearPreviewTimer],
  );
  const activePreviewNote =
    previewIndex !== null ? (notes[previewIndex] ?? null) : null;
  useEffect(() => {
    if (busy) return;
    publishPhrasePlayhead(
      activePreviewNote
        ? `${activePreviewNote.string}:${activePreviewNote.fret}`
        : null,
    );
  }, [busy, activePreviewNote]);
  function audition(index: number) {
    const note = notes[index];
    if (!note) return;
    clearPreviewTimer();
    previewingRef.current = true;
    setFocusState({ notes, index });
    setPreview({ notes, index, gen: playGen });
    onAuditionStart?.();
    if (onAuditionStop) {
      // Stopping a queued loop can swap `notes` from the held frame to the live
      // frame on the next commit; keep this audition alive through that commit.
      suppressNextNotesStopRef.current = true;
      onAuditionStop();
    }
    publishPhrasePlayhead(`${note.string}:${note.fret}`);
    void player.current?.auditionNote(note);
    const holdMs = Math.round(
      (auditionDecaySec(note.duration) + PHRASE_END_RELEASE_SEC) * 1000,
    );
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null;
      previewingRef.current = false;
      setPreview(null);
    }, holdMs);
  }
  function focusFret(target: number) {
    setFocusState({ notes, index: target });
    const button = rootRef.current?.querySelector<HTMLButtonElement>(
      `button.phrase-staff-fret[data-phrase-note="${target}"]`,
    );
    button?.focus();
  }
  function handleFretKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (!notes.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      focusFret(Math.min(notes.length - 1, index + 1));
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusFret(Math.max(0, index - 1));
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusFret(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusFret(notes.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      clearPreviewTimer();
      previewingRef.current = false;
      setPreview(null);
      player.current?.stopAudition(false);
      publishPhrasePlayhead(null);
    }
  }
  useEffect(() => {
    const root = rootRef.current;
    if (!root || !playing) {
      if (!previewingRef.current) publishPhrasePlayhead(null);
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
    // The staff's heads and marks render from `notes` and `bars` alone, and
    // a change to either re-runs this effect after the new staff commits.
    // Look them up once per run, not on every frame.
    const heads = Array.from(
      root.querySelectorAll<HTMLElement>('[data-phrase-playhead]'),
      (head) => ({ head, bar: head.dataset.phrasePlayhead }),
    );
    const marks = Array.from(
      root.querySelectorAll<HTMLElement>('[data-phrase-note]'),
      (mark) => ({ mark, note: Number(mark.dataset.phraseNote) }),
    );
    let frame = 0;
    const tick = () => {
      const elapsed = player.current?.elapsed() ?? 0;
      const tempo = tempoRef.current ?? PHRASE_TEMPO_DEFAULT;
      const swingNow = swing.current ?? SWING_AMOUNT_DEFAULT;
      const loopingNow = player.current?.isLooping ?? false;
      const limit = loopingNow ? bars * 4 : Number.POSITIVE_INFINITY;
      let index = -1;
      for (let note = 0; note < notes.length; note++) {
        if (notes[note].beat >= limit - 1e-6) continue;
        if (onsetSeconds(notes[note].beat, tempo, swingNow) <= elapsed + 0.03)
          index = note;
      }
      if (index >= 0) {
        const activeNote = notes[index];
        const endSec = onsetSeconds(
          activeNote.beat + activeNote.duration,
          tempo,
          swingNow,
        );
        const nextNote = notes[index + 1];
        const nextStart =
          nextNote && nextNote.beat < limit - 1e-6
            ? onsetSeconds(nextNote.beat, tempo, swingNow)
            : Number.POSITIVE_INFINITY;
        if (elapsed > endSec + 0.03 && elapsed < nextStart - 0.03) {
          index = -1;
        }
      }
      if (media.matches && index < 0) {
        for (const { head } of heads) head.hidden = true;
      } else {
        const rawBeat = media.matches
          ? (notes[index]?.beat ?? 0)
          : beatAtSeconds(elapsed, tempo, swingNow);
        const beat = loopingNow ? Math.min(bars * 4 - 1e-4, rawBeat) : rawBeat;
        const landing = !loopingNow && beat >= bars * 4;
        const barId = landing
          ? 'land'
          : String(Math.min(bars, Math.max(1, Math.floor(beat / 4) + 1)));
        const local = landing
          ? beat - bars * 4
          : beat - (Number(barId) - 1) * 4;
        const span = landing ? 2 : 4;
        const x = `${Math.min(1, Math.max(0, local / span)) * 100}%`;
        for (const { head, bar } of heads) {
          const mine = bar === barId;
          head.hidden = !mine;
          if (mine) head.style.left = x;
        }
      }
      for (const { mark, note } of marks) {
        mark.classList.toggle('is-current', note === index);
      }
      const sounding = index >= 0 ? notes[index] : null;
      publishPhrasePlayhead(
        sounding ? `${sounding.string}:${sounding.fret}` : null,
      );
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      if (!previewingRef.current) publishPhrasePlayhead(null);
      for (const { head } of heads) head.hidden = true;
      for (const { mark } of marks) mark.classList.remove('is-current');
    };
  }, [playing, notes, bars, player, tempoRef, swing]);
  const hasLanding = rows.some((row) => row.landing);
  const hasChromatic = notes.some((note) => note.degree === 'chr');
  const hasOpen = notes.some((note) => note.finger === 0);
  const staff = (
    <section
      className="phrase-staff-wrap"
      aria-label="Phrase tablature — select a note to hear it"
    >
      <div className="phrase-staff-header" aria-hidden="true">
        <span className="phrase-staff-title">
          Tablature
          <span className="phrase-staff-meta">
            Select a note to hear
            {turnaround ? ` · bars 3–4 → ${pretty(turnaround)}` : ''}
          </span>
        </span>
        <div className="phrase-staff-legend">
          <span className="phrase-legend-item">
            <i className="phrase-legend-swatch is-chord" />
            Chord
          </span>
          <span className="phrase-legend-item">
            <i className="phrase-legend-swatch is-scale" />
            Scale
          </span>
          {hasChromatic ? (
            <span className="phrase-legend-item">
              <i className="phrase-legend-swatch is-chromatic" />
              Chromatic
            </span>
          ) : null}
          <span className="phrase-legend-item phrase-legend-finger">
            {hasOpen ? (
              <>
                <b>0</b> open ·{' '}
              </>
            ) : null}
            <b>1–4</b> finger <i>›</i> shift
          </span>
        </div>
      </div>
      <p id="phrase-tab-hint" className="sr-only">
        Use Left and Right arrows to move between notes, Enter or Space to hear,
        Escape to stop.
      </p>
      <div
        className="phrase-staff"
        ref={rootRef}
        data-bars={bars}
        data-has-landing={hasLanding ? 'true' : undefined}
      >
        {rows.map((row) => (
          <div
            className={`phrase-staff-bar${row.landing ? ' is-landing' : ''}${row.landing && looping ? ' is-skipped' : ''}`}
            key={row.id}
            data-phrase-bar={row.id}
            data-turnaround={
              turnaround && row.id === '3'
                ? 'start'
                : turnaround && row.id === '4'
                  ? 'continue'
                  : undefined
            }
          >
            <div className="phrase-staff-caption" aria-hidden="true">
              {row.label}
              {row.landing && looping ? ' · skipped' : ''}
            </div>
            <div className="phrase-staff-lane" aria-hidden="true">
              {row.notes.map(({ index, note, x }) => (
                <span
                  key={`finger-${index}`}
                  className={`phrase-staff-finger${previewIndex === index ? ' is-preview' : ''}`}
                  data-phrase-note={index}
                  style={{ left: x }}
                >
                  <b>{note.finger}</b>
                  {note.shift ? <i>›</i> : null}
                </span>
              ))}
            </div>
            <div className="phrase-staff-neck">
              <div className="phrase-staff-names" aria-hidden="true">
                {['e', 'B', 'G', 'D', 'A', 'E'].map((name) => (
                  <span key={name}>{name}</span>
                ))}
              </div>
              <div className="phrase-staff-sheet">
                {['e', 'B', 'G', 'D', 'A', 'E'].map((name, index) => (
                  <span
                    key={`line-${name}`}
                    className="phrase-string-line"
                    aria-hidden="true"
                    style={{ top: `${((index + 0.5) / 6) * 100}%` }}
                  />
                ))}
                {row.lines.map((left, lineIndex) => (
                  <span
                    key={left}
                    className="phrase-staff-grid"
                    aria-hidden="true"
                    data-barline={
                      lineIndex === 0
                        ? 'start'
                        : lineIndex === row.lines.length - 1
                          ? 'end'
                          : undefined
                    }
                    style={{ left }}
                  />
                ))}
                <span
                  className="phrase-playhead"
                  data-phrase-playhead={row.id}
                  aria-hidden="true"
                  hidden
                />
                {row.notes.map(({ index, note, x, y, holdWidth }) =>
                  holdWidth ? (
                    <span
                      key={`hold-${index}`}
                      className="phrase-staff-hold"
                      aria-hidden="true"
                      data-passing={note.chordTone ? undefined : 'true'}
                      style={{ left: x, top: y, width: holdWidth }}
                    />
                  ) : null,
                )}
                {row.notes.map(({ index, note, x, y }) => {
                  const fretText =
                    note.fret === 0 ? 'open' : `fret ${note.fret}`;
                  const stringNum = 6 - note.string;
                  const noteLabel = noteDescription(note);
                  const landingNote = note.beat >= bars * 4;
                  const barNum = Math.floor(note.beat / 4) + 1;
                  const beatInBar = landingNote
                    ? note.beat - bars * 4 + 1
                    : (note.beat % 4) + 1;
                  const where = landingNote
                    ? `landing beat ${beatInBar}${looping ? ', skipped while looping' : ''}`
                    : `bar ${barNum} beat ${beatInBar}`;
                  return (
                    <button
                      key={`fret-${index}`}
                      type="button"
                      className={`phrase-staff-fret${previewIndex === index ? ' is-preview' : ''}`}
                      tabIndex={index === clampedFocus ? 0 : -1}
                      aria-label={`Play ${noteLabel}, string ${stringNum} ${fretText}, ${where}`}
                      aria-describedby="phrase-tab-hint"
                      title={`${noteLabel} · string ${stringNum} ${fretText} · play note`}
                      data-passing={note.chordTone ? undefined : 'true'}
                      data-chromatic={note.degree === 'chr' ? 'true' : undefined}
                      data-phrase-note={index}
                      style={{ left: x, top: y }}
                      onClick={() => audition(index)}
                      onKeyDown={(event) => handleFretKey(event, index)}
                    >
                      {note.fret}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="phrase-staff-beats" aria-hidden="true">
              {row.beats.map((beat) => (
                <span key={beat.label} style={{ left: beat.x }}>
                  {beat.label}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
  const host =
    typeof document === 'undefined'
      ? null
      : document.getElementById('phrase-tab-host');
  return host
    ? createPortal(
        <>
          {header}
          {staff}
        </>,
        host,
      )
    : staff;
}
