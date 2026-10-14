'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Music2 } from 'lucide-react';
import type { Note } from '@/lib/music';
import type { PhraseFretMark } from '@/lib/phrase-marks';

type PanelProps = {
  active: boolean;
  scaleRoot: string;
  scaleId: string;
  scaleName: string;
  scaleNotes: readonly Note[];
  chord: { symbol: string; notes: readonly Note[] } | null;
  onMarks: (
    marks: readonly PhraseFretMark[] | null,
    focusFret: number | null,
  ) => void;
};

export function PhraseLauncher({
  active,
  scaleRoot,
  scaleId,
  scaleName,
  scaleNotes,
  chord,
  onMarks,
}: PanelProps) {
  const [open, setOpen] = useState(false);
  const [Panel, setPanel] = useState<ComponentType<PanelProps> | null>(null);
  const [failed, setFailed] = useState(false);
  const opened = useRef(false);

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
        if (!cancelled) setPanel(() => module.PhrasePanel);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, Panel, onMarks]);

  function toggle() {
    setOpen((current) => !current);
  }

  return (
    <section className="phrase-launcher" aria-label="Phrase practice">
      <button
        type="button"
        className="practice-toggle phrase-open"
        aria-expanded={open}
        onClick={toggle}
      >
        <Music2 size={16} aria-hidden="true" /> Phrases
      </button>
      {open && failed && (
        <p className="muted">Phrases didn’t load. Try again.</p>
      )}
      {open && !failed && !Panel && <p className="muted">Loading phrases…</p>}
      {open && Panel && (
        <Panel
          active={active}
          scaleRoot={scaleRoot}
          scaleId={scaleId}
          scaleName={scaleName}
          scaleNotes={scaleNotes}
          chord={chord}
          onMarks={onMarks}
        />
      )}
    </section>
  );
}
