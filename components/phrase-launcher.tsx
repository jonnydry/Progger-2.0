'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Music2 } from 'lucide-react';
import type {
  PhraseHistoryChord,
  PhraseHistoryPlace,
} from '@/lib/phrase-history';
import type { Note } from '@/lib/music';
import type { PhraseFretMark } from '@/lib/phrase-marks';
import type { TrayPhrase, TrayPhraseCapture } from '@/lib/tray';

type PhraseChord = {
  symbol: string;
  notes: readonly Note[];
  root: string;
  qualityId: string;
  bass?: string;
  fromContext: boolean;
};

type PanelProps = {
  active: boolean;
  scaleRoot: string;
  scaleId: string;
  scaleName: string;
  scaleNotes: readonly Note[];
  chord: PhraseChord | null;
  held: TrayPhrase | null;
  contextKey: string;
  onReleaseHeld: () => void;
  onRestoreContext?: (context: {
    scaleRoot: string;
    scaleId: string;
    place: PhraseHistoryPlace;
    chord: PhraseHistoryChord | null;
  }) => void;
  capture: TrayPhraseCapture;
  onMarks: (
    marks: readonly PhraseFretMark[] | null,
    focusFret: number | null,
  ) => void;
};

export function PhraseLauncher({
  leading,
  active,
  scaleRoot,
  scaleId,
  scaleName,
  scaleNotes,
  chord,
  held,
  contextKey,
  onReleaseHeld,
  onRestoreContext,
  capture,
  openSignal = 0,
  onMarks,
}: PanelProps & { leading?: ReactNode; openSignal?: number }) {
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [signalSeen, setSignalSeen] = useState(openSignal);
  const opened = useRef(false);
  if (openSignal !== signalSeen) {
    setSignalSeen(openSignal);
    if (openSignal) {
      setOpen(true);
      setFailed(false);
      /* If the deck was already open on the failure line, `open` does not
         change, so the load effect needs the attempt bump to run again —
         clearing `failed` alone would strand it on the loading line. */
      setAttempt((current) => current + 1);
    }
  }

  useEffect(() => {
    if (!open) {
      if (opened.current) onMarks(null, null);
      return;
    }
    opened.current = true;
    if (Panel) return;
    let cancelled = false;
    void import('@/components/phrase-panel')
      .then((module) => {
        if (cancelled) return;
        setFailed(false);
        setPanel(() => module.PhrasePanel);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, Panel, onMarks, attempt]);

  function toggle() {
    /* Opening again is a fresh attempt: the old failure clears here, in
       the gesture, so Retry and the loading line never overlap. */
    if (!open) setFailed(false);
    setOpen((current) => !current);
  }

  function retry() {
    setFailed(false);
    setAttempt((current) => current + 1);
  }

  return (
    <>
      <div className="practice-bar">
        {leading}
        {leading ? (
          <span className="practice-bar-rule" aria-hidden="true" />
        ) : null}
        <button
          type="button"
          className="phrase-open"
          aria-expanded={open}
          aria-controls={open ? 'phrase-practice' : undefined}
          onClick={toggle}
        >
          <Music2 size={18} aria-hidden="true" /> Phrases
        </button>
      </div>
      {open && (
        <section
          id="phrase-practice"
          className="phrase-launcher"
          aria-label="Phrase practice"
        >
          {/* One of failed, loading, or the panel — never two at once. */}
          {failed ? (
            <p className="muted">
              Phrases didn’t load.{' '}
              <button type="button" onClick={retry}>
                Retry
              </button>
            </p>
          ) : !Panel ? (
            <p className="muted">Loading phrases…</p>
          ) : (
            <Panel
              active={active}
              scaleRoot={scaleRoot}
              scaleId={scaleId}
              scaleName={scaleName}
              scaleNotes={scaleNotes}
              chord={chord}
              held={held}
              contextKey={contextKey}
              onReleaseHeld={onReleaseHeld}
              onRestoreContext={onRestoreContext}
              capture={capture}
              onMarks={onMarks}
            />
          )}
        </section>
      )}
    </>
  );
}
