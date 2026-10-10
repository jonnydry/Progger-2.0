'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DRONE_MODES,
  DRONE_ROOTS,
  type DroneModeId,
  type DroneOctave,
  type DroneSoundId,
  colourNote,
  droneLabel,
  droneMode,
  dronePitches,
  scaleWalk,
} from '@/lib/drone';
import { pretty, spell } from '@/lib/music';
import {
  DroneEngine,
  type DronePatch,
  type DroneStatus,
} from '@/lib/drone-audio';
import { VoicingPlayer } from '@/lib/voicing-audio';
import './drone-lab.css';

const HEAR_NOTE: (number | null)[] = [null, null, null, null, null, 5];
const HEAR_CHORD: (number | null)[] = [5, 7, 7, 5, 5, 5];

const SOUNDS: { id: DroneSoundId; label: string; copy: string }[] = [
  {
    id: 'bow',
    label: 'A · Bowed pad',
    copy: 'Detuned bows, a slow filter swell, and a small room.',
  },
  {
    id: 'cello',
    label: 'B · Cello',
    copy: 'Looped cello sustains. Samples load only after you pick this.',
  },
  {
    id: 'reed',
    label: 'C · Reed',
    copy: 'A harmonium-like reed with a slow bellows swell.',
  },
];

export function DroneLab() {
  const engineRef = useRef<DroneEngine | null>(null);
  const playerRef = useRef<VoicingPlayer | null>(null);
  const patchRef = useRef<DronePatch>({
    sound: 'bow',
    root: 'A',
    modeId: 'dorian',
    octave: 'layered',
    volume: 0.85,
  });
  const [sound, setSound] = useState<DroneSoundId>('bow');
  const [root, setRoot] = useState('A');
  const [modeId, setModeId] = useState<DroneModeId>('dorian');
  const [octave, setOctave] = useState<DroneOctave>('layered');
  const [volume, setVolume] = useState(0.85);
  const [status, setStatus] = useState<DroneStatus>('idle');
  const [detail, setDetail] = useState('');
  const [walkIndex, setWalkIndex] = useState<number | null>(null);
  const [cello, setCello] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    const engine = new DroneEngine(
      (next, message) => {
        setStatus(next);
        setDetail(message ?? '');
      },
      setWalkIndex,
    );
    engineRef.current = engine;
    return () => {
      engine.dispose();
      engineRef.current = null;
      playerRef.current?.dispose();
      playerRef.current = null;
    };
  }, []);

  const mode = droneMode(modeId);
  const pitches = useMemo(
    () => dronePitches(root, modeId, octave),
    [root, modeId, octave],
  );
  const degrees = useMemo(() => spell(root, [...mode.formula]), [root, mode]);
  const colour = colourNote(root, modeId);
  const walk = useMemo(() => scaleWalk(root, modeId), [root, modeId]);
  const current = walkIndex === null ? null : walk[walkIndex];
  const busy = status === 'playing' || status === 'starting';

  function remember(patch: DronePatch) {
    patchRef.current = patch;
  }

  function chooseSound(next: DroneSoundId) {
    const patch = { ...patchRef.current, sound: next };
    remember(patch);
    setSound(next);
    const engine = engineRef.current;
    if (next === 'cello' && cello !== 'ready') {
      setCello('loading');
      void engine
        ?.loadCello()
        .then(() => setCello('ready'))
        .catch(() => setCello('error'));
    }
    if (busy) engine?.update(patch);
  }

  function chooseRoot(next: string) {
    const patch = { ...patchRef.current, root: next };
    remember(patch);
    setRoot(next);
    setWalkIndex(null);
    if (busy) engineRef.current?.update(patch);
  }

  function chooseMode(next: DroneModeId) {
    const patch = { ...patchRef.current, modeId: next };
    remember(patch);
    setModeId(next);
    setWalkIndex(null);
    if (busy) engineRef.current?.update(patch);
  }

  function chooseOctave(next: DroneOctave) {
    const patch = { ...patchRef.current, octave: next };
    remember(patch);
    setOctave(next);
    if (busy) engineRef.current?.update(patch);
  }

  function hear(frets: readonly (number | null)[]) {
    const patch: DronePatch = {
      sound: 'reed',
      root: 'A',
      modeId: 'dorian',
      octave: 'layered',
      volume: 1,
    };
    remember(patch);
    setSound('reed');
    setRoot('A');
    setModeId('dorian');
    setOctave('layered');
    setVolume(1);
    setWalkIndex(null);
    const engine = engineRef.current;
    if (!engine) return;
    if (!playerRef.current) playerRef.current = new VoicingPlayer(() => {});
    engine.stop();
    engine.play(patch);
    void playerRef.current.play(frets);
  }

  const statusText =
    status === 'error'
      ? detail
      : cello === 'error'
        ? 'Cello samples did not load. Bowed pad and reed still work.'
        : cello === 'loading' || (status === 'starting' && sound === 'cello')
          ? 'Loading cello samples…'
          : status === 'starting'
            ? 'Starting…'
            : current
              ? `Walking ${pretty(current.note.name)}`
              : status === 'playing'
                ? 'Drone on'
                : '';

  return (
    <main id="main-content" tabIndex={-1} className="drone-lab">
      <div className="drone-panel">
        <header>
          <p className="drone-kicker">Unlisted preview</p>
          <h1>Drone sounds</h1>
          <p className="drone-lead">
            Hear a mode against a sustained root. Pick a tone, then walk the
            scale.
          </p>
        </header>
        <div className="drone-layout">
          <div>
            <fieldset className="drone-group">
              <legend>Sound</legend>
              <div className="drone-choices">
                {SOUNDS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="drone-choice"
                    aria-pressed={sound === item.id}
                    onClick={() => chooseSound(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <p className="drone-note">{SOUNDS.find((item) => item.id === sound)?.copy}</p>
            </fieldset>
            <fieldset className="drone-group">
              <legend>Root</legend>
              <div className="drone-roots">
                {DRONE_ROOTS.map((note) => (
                  <button
                    key={note}
                    type="button"
                    className="drone-choice"
                    aria-pressed={root === note}
                    onClick={() => chooseRoot(note)}
                  >
                    {pretty(note)}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="drone-group">
              <legend>Mode</legend>
              <div className="drone-modes">
                {DRONE_MODES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="drone-choice"
                    aria-pressed={modeId === item.id}
                    onClick={() => chooseMode(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="drone-group">
              <legend>Drone octave</legend>
              <div className="drone-choices">
                <button
                  type="button"
                  className="drone-choice"
                  aria-pressed={octave === 'low'}
                  onClick={() => chooseOctave('low')}
                >
                  Low
                </button>
                <button
                  type="button"
                  className="drone-choice"
                  aria-pressed={octave === 'layered'}
                  onClick={() => chooseOctave('layered')}
                >
                  Low + octave
                </button>
              </div>
              <p className="drone-note">
                Low sits around E2–A2. Phone speakers miss that fundamental, so
                the octave layer carries the root.
              </p>
            </fieldset>
            <div className="drone-transport">
              <button
                type="button"
                className="drone-play"
                aria-pressed={busy}
                onClick={() => {
                  const engine = engineRef.current;
                  if (!engine) return;
                  if (busy) engine.stop();
                  else engine.play(patchRef.current);
                }}
              >
                {busy ? 'Stop' : 'Play'}
              </button>
              <button
                type="button"
                className="drone-walk"
                onClick={() => engineRef.current?.walk(patchRef.current)}
              >
                {walkIndex === null ? 'Walk the scale' : 'Stop walk'}
              </button>
              <button type="button" className="drone-play" onClick={() => hear(HEAR_NOTE)}>
                Reed under A4
              </button>
              <button type="button" className="drone-play" onClick={() => hear(HEAR_CHORD)}>
                Reed under Am
              </button>
            </div>
            <p className="drone-note">
              The two reed buttons play A Dorian at the 0.15 cap, then a single
              A4 or a six-string Am.
            </p>
            <label className="drone-volume-row">
              Volume
              <input
                className="drone-volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onInput={(event) => {
                  const next = Number(event.currentTarget.value);
                  setVolume(next);
                  remember({ ...patchRef.current, volume: next });
                  engineRef.current?.setVolume(next);
                }}
              />
            </label>
          </div>
          <aside className="drone-readout">
            <p className="drone-pitches">{droneLabel(pitches)}</p>
            <ol className="drone-scale">
              {degrees.map((note) => {
                const active = current?.note.degree === note.degree;
                const coloured = colour?.degree === note.degree;
                return (
                  <li
                    key={note.degree}
                    className={`drone-degree${coloured ? ' is-colour' : ''}${active ? ' is-current' : ''}`}
                    aria-current={active ? 'step' : undefined}
                  >
                    <strong>{pretty(note.name)}</strong>
                    <span>{pretty(note.degree)}</span>
                  </li>
                );
              })}
            </ol>
            <p className="drone-note">
              {mode.colourLabel && colour
                ? `${mode.name} colour: ${mode.colourLabel} (${pretty(colour.name)}).`
                : 'Ionian is the reference. The other modes each move one note.'}
            </p>
            <output className="drone-status" aria-live="polite">
              {statusText}
            </output>
            <Link className="drone-home" href="/">
              Back to Progger
            </Link>
          </aside>
        </div>
      </div>
    </main>
  );
}
