'use client';
import { useEffect, useRef, useState, useId, useCallback } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { mod, pretty, TUNING, type Note, type Pattern } from '@/lib/music';

export function Fretboard({ notes, root, pattern, degrees, left, targets = [] }: { notes: Note[]; root: string; pattern?: Pattern; degrees: boolean; left: boolean; targets?: number[] }) {
  const viewport = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState([0, 24]);
  const titleId = useId();
  const frets = Array.from({ length: 25 }, (_, i) => left ? 24 - i : i);
  const noteMap = new Map(notes.map(note => [note.pc, note]));
  const selected = pattern ? new Set(pattern.positions.map(p => `${p.string}:${p.fret}`)) : null;
  const updateRange = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    const cell = el.scrollWidth / 25;
    const first = Math.max(0, Math.floor(el.scrollLeft / cell));
    const last = Math.min(24, Math.ceil((el.scrollLeft + el.clientWidth) / cell) - 1);
    const next = left ? [24 - last, 24 - first] : [first, last];
    setRange(previous => previous[0] === next[0] && previous[1] === next[1] ? previous : next);
  }, [left]);
  const jump = useCallback((fret: number) => {
    const el = viewport.current;
    if (el) el.scrollTo({ left: (left ? 24 - fret : fret) * el.scrollWidth / 25, behavior: 'auto' });
  }, [left]);
  const previousLeft = useRef(left);
  const musicalRange = useRef(range);
  useEffect(() => { musicalRange.current = range; }, [range]);
  useEffect(() => {
    if (pattern) jump(left ? pattern.max : pattern.min);
    else if (previousLeft.current !== left) jump(left ? musicalRange.current[1] : musicalRange.current[0]);
    previousLeft.current = left;
    updateRange();
    const observer = new ResizeObserver(updateRange);
    if (viewport.current) observer.observe(viewport.current);
    return () => observer.disconnect();
  }, [pattern, left, jump, updateRange]);
  return <section className={`neck ${left ? 'left-handed-neck' : ''}`} aria-labelledby={titleId}>
    <div className="neck-meta"><span id={titleId}>STANDARD TUNING <span className="muted">/ E A D G B E</span></span><span className="neck-legend"><i className="root-key" /> Root <i className="scale-key" /> Scale note{targets.length > 0 && <><i className="target-key" /> Chord tone</>}</span></div>
    <div className="neck-frame">
      <div className="string-labels" aria-hidden="true">{['e', 'B', 'G', 'D', 'A', 'E'].map((string, i) => <span key={i}>{string}</span>)}</div>
      <div ref={viewport} className="neck-scroll" tabIndex={0} role="region" aria-label="Guitar neck, open strings through fret 24. Scroll horizontally or use the fret navigation controls." onScroll={updateRange}>
        <div className="fret-grid" role="img" aria-label={`${root} notes: ${notes.map(n => `${pretty(n.name)} degree ${pretty(n.degree)}`).join(', ')}. ${pattern ? `Practice pattern from fret ${pattern.min} to ${pattern.max}.` : 'All note locations through fret 24.'} ${left ? 'Left-handed view.' : 'Right-handed view.'}`}>
          {frets.map(fret => <div className={`fret-column ${fret === 0 ? 'open-string' : ''}`} key={fret}>
            <span className={`fret-number ${[3,5,7,9,12,15,17,19,21,24].includes(fret) ? 'inlaid' : ''}`}>{fret === 0 ? 'OPEN' : fret}</span>
            {[5,4,3,2,1,0].map(string => {
              const note = noteMap.get(mod(TUNING[string] + fret));
              const show = note && (!selected || selected.has(`${string}:${fret}`));
              return <div key={string} className={`string-cell string-${string}`}><span className="string-line" />{show && <span className={`note-dot ${note.degree === '1' ? 'is-root' : ''} ${targets.includes(note.pc) ? 'is-target' : ''}`} title={`${pretty(note.name)} · ${pretty(note.degree)} · string ${6-string}, fret ${fret}`}>{degrees ? pretty(note.degree) : pretty(note.name)}</span>}</div>;
            })}
            <span className="inlay" aria-hidden="true">{[12,24].includes(fret) ? '••' : [3,5,7,9,15,17,19,21].includes(fret) ? '•' : ''}</span>
          </div>)}
        </div>
      </div>
    </div>
    <div className="neck-navigation"><span className="range-label" aria-live="polite">Frets {range[0]}–{range[1]} <span className="muted">of 24</span></span><div className="fret-nav-buttons"><button type="button" className="icon-button" aria-label="Scroll neck left" onClick={() => viewport.current?.scrollBy({ left: -viewport.current.clientWidth * .75 })}><ArrowLeft size={17} /></button><label className="jump-label">Jump to fret<select aria-label="Jump to fret" value="" onChange={e => jump(Number(e.target.value))}><option value="" disabled>↗</option>{Array.from({length:25},(_,i) => <option key={i} value={i}>{i === 0 ? 'Open' : i}</option>)}</select></label><button type="button" className="icon-button" aria-label="Scroll neck right" onClick={() => viewport.current?.scrollBy({ left: viewport.current.clientWidth * .75 })}><ArrowRight size={17} /></button></div></div>
    <details className="pattern-details"><summary>{pattern ? 'Read this pattern as fret numbers' : 'Read note positions by string'}</summary>{TUNING.map((open,string)=><p key={string}><strong>{['Low E','A','D','G','B','High e'][string]}: </strong>{Array.from({length:25},(_,fret)=>({fret,note:noteMap.get(mod(open+fret))})).filter(({fret,note})=>note&&(!selected||selected.has(`${string}:${fret}`))).map(({fret,note})=>`${fret===0?'open':fret} ${pretty(note!.name)}`).join(' · ')}</p>)}</details>
  </section>;
}
