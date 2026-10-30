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

type BuildChip = string & { readonly fold: 'build' };
type TempoChip = string & { readonly fold: 'tempo' };

function buildChip(text: string): BuildChip {
  return text as BuildChip;
}

function tempoChip(text: string): TempoChip {
  return text as TempoChip;
}

function buildReadout(locks: PhraseLocks): readonly BuildChip[] {
  const labels = [
    locks.contour ? CONTOUR_LABEL[locks.contour] : '',
    locks.rhythm ? RHYTHM_SHORT[locks.rhythm] : '',
    locks.register ? REGISTER_LABEL[locks.register] : '',
    locks.cadence ? CADENCE_LABEL[locks.cadence] : '',
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
  const pin = <K extends keyof PhraseLocks>(key: K, value: PhraseLocks[K]) => {
    setPins((current) => {
      const next = { ...current };
      if (next[key] === value) delete next[key];
      else next[key] = value;
      return next;
    });
  };
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
  // Saved locks stay with that phrase; local pins are added on top. A cadence
  // the chord cannot land is ignored by generatePhrase.
  const generationLocks = {
    ...phraseHistoryActiveLocks(cursor, onHistory, locks),
    ...pins,
  };
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
  /**
   * Hand the screen the frame the player is starting. Called from the
   * player's own state callback — an external notification — so React sees
   * one update per handoff and never a synchronous setState in an effect.
   */
  const adoptQueued = useCallback(() => {
    setAwaitingHandoff(false);
    setFinishingHold(false);
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
    queuedFeel.current = null;
  }, []);
  useEffect(() => {
    const current = new PhrasePlayer((next) => {
      if (next === 'idle' || next === 'error') {
        live.current = false;
        // The finishing pass is over (or never started), so a later pass
        // must not be held as if its cadence were still sounding.
        setFinishingHold(false);
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
  }, [active, phrase, bars, slow, loop, liveMusical, dropQueued]);
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
  // The saved mark belongs to the phrase on screen. Keying it by the live
  // selection would leave "Saved ✓" lit for a queued phrase that was
  // never saved once the handoff lands.
  const phraseKey = `${frame.scaleId}:${frame.scaleRoot}:${frame.chordSymbol}:${sounding.ok ? sounding.phrase.seed : seed}:${sounding.ok ? sounding.phrase.bars : bars}:${sounding.ok ? `${sounding.phrase.plan.contour}/${sounding.phrase.plan.rhythm}/${sounding.phrase.plan.register}/${sounding.phrase.plan.cadence}` : ''}`;
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
  function startPlayback() {
    if (!phrase.ok) return;
    dispatchPhraseStop(window, 'panel');
    const tempoNow = clampPhraseTempo(slow ? tempo / 2 : tempo);
    soundingTempo.current = tempoNow;
    soundingSwing.current = swing;
    soundingFeel.current = { tempo, slow, swing };
    queuedFeel.current = null;
    live.current = true;
    void player.current?.start({
      notes: phrase.phrase.notes,
      bars,
      tempo: tempoNow,
      swing,
      loop,
    });
  }
  function toggleLoop() {
    // Turning Loop off over a live pass sends that pass into its
    // cadence (or re-queues its armed replacement to play once). Hold
    // the screen on it until the player reports the next start.
    if (loop && live.current) setFinishingHold(true);
    setLoop((current) => !current);
  }
  function togglePlay() {
    if (!phrase.ok) return;
    setNotice('');
    if (live.current || status === 'playing' || status === 'starting') {
      live.current = false;
      // Stop cancels the handoff, so drop the frame waiting for it. A
      // lingering queued frame would freeze the panel on the old phrase.
      dropQueued();
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
  /**
   * Tempo is immediate, per Jonny's Loop rule. Nudging the tempo re-issues the
   * pass as soon as the slider is released; it never waits for a bar line,
   * because a practice tempo you have to wait a whole pass for is not a tempo
   * control. Loop, half speed, and phrase changes keep their bar-line handoff.
   */
  function commitTempo() {
    if (live.current) startPlayback();
  }
  const busy = status === 'playing' || status === 'starting';
  const plan = sounding.ok ? sounding.phrase.plan : null;
  // The label names the degree the phrase actually lands on. A minor-blues
  // tonic has both a flat fifth and a fifth in its default chord, and the
  // cadence is the fifth, so the readout must not say "5th" when it means
  // "the tritone" (or the reverse).
  const cadenceText = plan ? cadenceLabel(plan.cadence, frame.chordNotes) : '';
  const planSentence = plan
    ? `${CONTOUR_LABEL[plan.contour]} contour, ${RHYTHM_LABEL[plan.rhythm]}, ${REGISTER_LABEL[plan.register]} register, landing on the ${cadenceText}.`
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
  return (
    <div className="phrase-panel" data-scale-id={scaleId}>
      <div className="phrase-heading">
        <h2>Phrase</h2>
        <p>
          Over {pretty(frame.chordSymbol)} in {pretty(frame.scaleRoot)}{' '}
          {frame.scaleName}.
        </p>
      </div>
      <div className={`phrase-deck deck-tape${busy ? ' is-rolling' : ''}`}>
        <div className="deck-window">
          <span className="deck-reel" aria-hidden="true" />
          <div className="deck-window-text">
            {plan && (
              <p className="phrase-plan">
                {CONTOUR_LABEL[plan.contour]} · {RHYTHM_LABEL[plan.rhythm]} ·{' '}
                {REGISTER_LABEL[plan.register]} · lands on the {cadenceText}
              </p>
            )}
            {/* Live status line. The id predates the seed field getting
                its own static note; tests still read status by it. */}
            <p
              id="phrase-seed-help"
              className={`phrase-status${statusAlert ? ' is-alert' : ''}`}
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
          </div>
          <span className="deck-reel" aria-hidden="true" />
        </div>
        {/*
          The plan line is visual shorthand. A screen reader gets one sentence
          that says the same thing, and it is a live region so a regenerated
          phrase is announced instead of changing silently.
        */}
        <p className="sr-only" aria-live="polite" aria-atomic="true">
          {plan ? `Phrase ${planSentence}` : ''}
        </p>
        <div className="deck-zone">
          <h3 className="deck-legend">Play</h3>
          <div className="deck-transport">
            {playKey}
            {newPhraseKey}
            {historyBank}
            {loopKey}
            {saveKey}
          </div>
        </div>
        <details className="deck-fold deck-build">
          <summary className="deck-fold-summary">
            <span className="deck-legend">Build</span>
            <ReadoutChips chips={buildReadout(generationLocks)} />
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
              onPin={pin}
              onClear={() => setPins(EMPTY_LOCKS)}
            />
          </div>
        </details>
        <details className="deck-fold deck-feel">
          <summary className="deck-fold-summary">
            <span className="deck-legend">Tempo</span>
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
          notes={notes}
          bars={frame.bars}
          swing={soundingSwing}
          playing={status === 'playing'}
          player={player}
          tempoRef={soundingTempo}
        />
      )}
      {sounding.ok && (
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

type PinOption<K extends keyof PhraseLocks> = {
  key: K;
  label: string;
  values: readonly {
    value: NonNullable<PhraseLocks[K]>;
    label: string;
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
  onPin,
  onClear,
}: {
  plan: PhrasePlan | null;
  locks: PhraseLocks;
  onPin: <K extends keyof PhraseLocks>(
    key: K,
    value: NonNullable<PhraseLocks[K]>,
  ) => void;
  onClear: () => void;
}) {
  const hintId = 'phrase-pins-hint';
  const rows: PinOption<keyof PhraseLocks>[] = [
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
      values: [
        { value: 'root', label: CADENCE_LABEL.root },
        { value: 'third', label: CADENCE_LABEL.third },
        { value: 'fifth', label: CADENCE_LABEL.fifth },
      ],
    },
  ];
  const pinned = Object.keys(locks).length > 0;
  return (
    <div className="phrase-pins">
      <p className="phrase-pins-title">
        <span id={hintId} className="phrase-pins-hint">
          Pin one, re-roll the rest
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
                const active = locks[row.key] === option.value;
                const current = plan?.[row.key] === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
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
      </div>
    </div>
  );
}

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
