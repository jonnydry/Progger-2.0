'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Play, RefreshCw, Square } from 'lucide-react';
import { pretty, type Note } from '@/lib/music';
import { PhrasePlayer, type PhrasePlayback } from '@/lib/phrase-audio';
import {
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
  type Feel,
  type FingeredNote,
  type PhraseDotVisibility,
  type PhraseLocks,
} from '@/lib/phrase';
import type { PhraseFretMark } from '@/lib/phrase-marks';
import '@/app/phrase.css';

const EMPTY_LOCKS: PhraseLocks = {};
const EMPTY_NOTES: readonly FingeredNote[] = [];

export function PhrasePanel({
  active,
  scaleRoot,
  scaleId,
  scaleName,
  scaleNotes,
  chord,
  dots = 'shown',
  locks = EMPTY_LOCKS,
  onMarks,
}: {
  active: boolean;
  scaleRoot: string;
  scaleId: string;
  scaleName: string;
  scaleNotes: readonly Note[];
  chord: { symbol: string; notes: readonly Note[] } | null;
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
  const [bars, setBars] = useState<2 | 4>(2);
  const [feel, setFeel] = useState<Feel>('straight');
  const [tempo, setTempo] = useState(96);
  const [slow, setSlow] = useState(false);
  const [loop, setLoop] = useState(false);
  const [seed, setSeed] = useState(() => randomSeed());
  const [seedText, setSeedText] = useState(() => String(seed));
  const [status, setStatus] = useState<PhrasePlayback>('idle');
  const [heard, setHeard] = useState(-1);
  const player = useRef<PhrasePlayer | null>(null);
  const live = useRef(false);
  const phrase = useMemo(
    () =>
      generatePhrase({
        seed,
        bars,
        scaleNotes,
        chordNotes,
        locks,
      }),
    [seed, bars, scaleNotes, chordNotes, locks],
  );
  const playbackTempo = slow ? tempo / 2 : tempo;
  const notes = useMemo(
    () => (phrase.ok ? phrase.phrase.notes : EMPTY_NOTES),
    [phrase],
  );
  const activeIndex = status === 'playing' && notes.length ? heard : -1;
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
    const hide = () => {
      if (document.hidden) pause();
    };
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', pause);
    return () => {
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', pause);
      current.dispose();
      player.current = null;
    };
  }, []);
  useEffect(() => {
    if (!active) {
      live.current = false;
      player.current?.stop();
      return;
    }
    if (!live.current || !phrase.ok) return;
    void player.current?.start({
      notes: phrase.phrase.notes,
      bars,
      tempo: playbackTempo,
      feel,
      loop,
    });
  }, [active, phrase, bars, playbackTempo, feel, loop]);
  useEffect(() => {
    if (status !== 'playing' || !notes.length) return;
    let frame = 0;
    const tick = () => {
      const elapsed = player.current?.elapsed() ?? 0;
      let index = -1;
      for (let note = 0; note < notes.length; note++) {
        if (
          onsetSeconds(notes[note].beat, playbackTempo, feel) <=
          elapsed + 0.03
        )
          index = note;
      }
      setHeard((current) => (current === index ? current : index));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [status, notes, playbackTempo, feel]);

  const marks = useMemo(
    () => (phrase.ok ? phraseFretMarks(notes, dots, activeIndex) : null),
    [phrase.ok, notes, dots, activeIndex],
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
    setSeed(parsed);
    setSeedText(String(parsed));
  }
  function regenerate() {
    const next = randomSeed();
    setSeed(next);
    setSeedText(String(next));
  }
  function togglePlay() {
    if (!phrase.ok) return;
    if (live.current || status === 'playing' || status === 'starting') {
      live.current = false;
      player.current?.stop();
      return;
    }
    live.current = true;
    void player.current?.start({
      notes: phrase.phrase.notes,
      bars,
      tempo: playbackTempo,
      feel,
      loop,
    });
  }
  const busy = status === 'playing' || status === 'starting';
  const plan = phrase.ok ? phrase.phrase.plan : null;

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
      {plan && (
        <p className="phrase-plan">
          {bars} bars · {CONTOUR_LABEL[plan.contour]} ·{' '}
          {RHYTHM_LABEL[plan.rhythm]} · {REGISTER_LABEL[plan.register]} register
          · ends on the {CADENCE_LABEL[plan.cadence]} · {feel}
          {slow ? ` · half of ${tempo}` : ''}
        </p>
      )}
      <div className="phrase-controls">
        <fieldset className="segmented">
          <legend className="sr-only">Phrase length</legend>
          <button
            type="button"
            aria-pressed={bars === 2}
            onClick={() => setBars(2)}
          >
            2 bars
          </button>
          <button
            type="button"
            aria-pressed={bars === 4}
            onClick={() => setBars(4)}
          >
            4 bars
          </button>
        </fieldset>
        <fieldset className="segmented">
          <legend className="sr-only">Feel</legend>
          <button
            type="button"
            aria-pressed={feel === 'straight'}
            onClick={() => setFeel('straight')}
          >
            Straight
          </button>
          <button
            type="button"
            aria-pressed={feel === 'swing'}
            onClick={() => setFeel('swing')}
          >
            Swing
          </button>
        </fieldset>
        <label className="phrase-tempo">
          Tempo
          <input
            type="range"
            min={40}
            max={200}
            step={1}
            value={tempo}
            aria-valuetext={
              slow
                ? `${playbackTempo}, half of ${tempo}`
                : `${tempo} beats per minute`
            }
            onChange={(event) => setTempo(Number(event.target.value))}
          />
          <output>{Math.round(playbackTempo)}</output>
        </label>
        <button
          type="button"
          className="phrase-action"
          aria-pressed={slow}
          onClick={() => setSlow((current) => !current)}
        >
          Half speed
        </button>
        <label className="phrase-seed">
          Seed
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
        <button type="button" className="phrase-action" onClick={regenerate}>
          <RefreshCw size={14} aria-hidden="true" /> New phrase
        </button>
        <button
          type="button"
          className="phrase-action"
          disabled={!phrase.ok}
          onClick={togglePlay}
        >
          {busy ? (
            <Square size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
          {busy ? 'Stop' : 'Play'}
        </button>
        <button
          type="button"
          className="phrase-action"
          aria-pressed={loop}
          onClick={() => setLoop((current) => !current)}
        >
          Loop
        </button>
      </div>
      <p id="phrase-seed-help" className="phrase-status">
        {status === 'error'
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
      {phrase.ok && dots === 'shown' && (
        <>
          <ol className="phrase-notes" aria-label="Phrase notes">
            {notes.map((note, index) => (
              <li
                key={`${note.beat}-${index}`}
                className={note.strong ? 'is-strong' : undefined}
              >
                {pretty(note.name)}
              </li>
            ))}
          </ol>
          <PhraseTab notes={notes} bars={bars} activeIndex={activeIndex} />
        </>
      )}
    </div>
  );
}

function PhraseTab({
  notes,
  bars,
  activeIndex,
}: {
  notes: readonly FingeredNote[];
  bars: 2 | 4;
  activeIndex: number;
}) {
  const groups = new Map<number, { note: FingeredNote; index: number }[]>();
  notes.forEach((note, index) => {
    const bar = Math.floor(note.beat / 4) + 1;
    const group = groups.get(bar) ?? [];
    group.push({ note, index });
    groups.set(bar, group);
  });
  return (
    <>
      <div className="phrase-tab" aria-hidden="true">
        {[...groups.entries()].map(([bar, group]) => (
          <div className="phrase-tab-bar" key={bar}>
            <span>{bar > bars ? 'Lands' : `Bar ${bar}`}</span>
            <TabRow>
              <b />
              {group.map(({ note, index }) => (
                <span
                  key={`finger-${index}`}
                  className={index === activeIndex ? 'is-current' : undefined}
                >
                  {note.finger}
                </span>
              ))}
            </TabRow>
            {group.some(({ note }) => note.shift) && (
              <TabRow>
                <b />
                {group.map(({ note, index }) => (
                  <span key={`shift-${index}`} className="phrase-shift-label">
                    {note.shift ? 'shift' : ''}
                  </span>
                ))}
              </TabRow>
            )}
            {[5, 4, 3, 2, 1, 0].map((string) => (
              <TabRow key={string}>
                <b>{['E', 'A', 'D', 'G', 'B', 'e'][string]}</b>
                {group.map(({ note, index }) => (
                  <span
                    key={`${string}-${index}`}
                    className={index === activeIndex ? 'is-current' : undefined}
                  >
                    {note.string === string ? note.fret : '—'}
                  </span>
                ))}
              </TabRow>
            ))}
            <TabRow>
              <b />
              {group.map(({ note, index }) => (
                <span key={`beat-${index}`}>
                  {note.strong ? (note.beat % 4 === 0 ? '1' : '3') : ''}
                </span>
              ))}
            </TabRow>
          </div>
        ))}
      </div>
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
    </>
  );
}

function TabRow({ children }: { children: ReactNode }) {
  return <div className="phrase-tab-row">{children}</div>;
}
