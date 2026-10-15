'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Play, RefreshCw, Square } from 'lucide-react';
import { pretty, type Note } from '@/lib/music';
import {
  bindPhraseLifecycle,
  clampPhraseTempo,
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
  type FingeredNote,
  type PhraseDotVisibility,
  type PhraseLocks,
} from '@/lib/phrase';
import { publishPhrasePlayhead, type PhraseFretMark } from '@/lib/phrase-marks';
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
  const [swing, setSwing] = useState(SWING_AMOUNT_DEFAULT);
  const [tempo, setTempo] = useState(96);
  const [slow, setSlow] = useState(false);
  const [loop, setLoop] = useState(false);
  const [seed, setSeed] = useState(() => randomSeed());
  const [seedText, setSeedText] = useState(() => String(seed));
  const [status, setStatus] = useState<PhrasePlayback>('idle');
  const player = useRef<PhrasePlayer | null>(null);
  const live = useRef(false);
  const tempoRef = useRef(tempo);
  const soundingTempo = useRef(tempo);
  const swingRef = useRef(swing);
  const soundingSwing = useRef(swing);
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
    return () => {
      unbind();
      current.dispose();
      player.current = null;
      publishPhrasePlayhead(null);
    };
  }, []);
  useEffect(() => {
    if (!active) {
      live.current = false;
      player.current?.stop();
      return;
    }
    if (!live.current || !phrase.ok) return;
    const tempoNow = clampPhraseTempo(
      slow ? tempoRef.current / 2 : tempoRef.current,
    );
    soundingTempo.current = tempoNow;
    soundingSwing.current = swingRef.current;
    void player.current?.start({
      notes: phrase.phrase.notes,
      bars,
      tempo: tempoNow,
      swing: swingRef.current,
      loop,
    });
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
    setSeed(parsed);
    setSeedText(String(parsed));
  }
  function regenerate() {
    const next = randomSeed();
    setSeed(next);
    setSeedText(String(next));
  }
  function startPlayback() {
    if (!phrase.ok) return;
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
  function commitTempo() {
    if (live.current) startPlayback();
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
          · ends on the {CADENCE_LABEL[plan.cadence]} · swing{' '}
          {Math.round(swing * 100)}%{trueHalf ? ` · half of ${tempo}` : ''}
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
        <label className="phrase-tempo phrase-swing">
          Swing
          <input
            type="range"
            min={SWING_AMOUNT_MIN}
            max={SWING_AMOUNT_MAX}
            step={0.01}
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
        <label className="phrase-tempo">
          Tempo
          <input
            type="range"
            min={PHRASE_TEMPO_MIN}
            max={tempoMax}
            step={1}
            value={playbackTempo}
            aria-valuetext={
              trueHalf
                ? `${playbackTempo} beats per minute, half of ${tempo}`
                : `${playbackTempo} beats per minute`
            }
            onChange={(event) => {
              const sounding = clampPhraseTempo(Number(event.target.value));
              const written = clampPhraseTempo(slow ? sounding * 2 : sounding);
              tempoRef.current = written;
              setTempo(written);
            }}
            onPointerUp={commitTempo}
            onKeyUp={commitTempo}
          />
          <output>{playbackTempo}</output>
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
      const tempo = tempoRef.current ?? 96;
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
