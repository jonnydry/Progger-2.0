'use client';
import {
  useLayoutEffect,
  useRef,
  useState,
  useId,
  useCallback,
  type ReactNode,
} from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { MusicSelect } from '@/components/music-select';
import { mod, pretty, TUNING, type Note, type Pattern } from '@/lib/music';
import { readableNoteName, noteDescription } from '@/lib/note-presentation';

export function Fretboard({
  notes,
  root,
  controls,
  controlsAbove = false,
  pattern,
  availablePatterns = [],
  onPatternSelect,
  voicing,
  scope,
  degrees,
  left,
  targets = [],
  noteLabel = 'Scale note',
}: {
  notes: Note[];
  controls: ReactNode;
  controlsAbove?: boolean;
  root: string;
  pattern?: Pattern;
  availablePatterns?: Pattern[];
  onPatternSelect?: (index: number) => void;
  scope: 'scale' | 'chord';
  voicing?: {
    name: string;
    frets: (number | null)[];
    omittedNotes?: Note[];
    rootless?: boolean;
  };
  degrees: boolean;
  left: boolean;
  targets?: number[];
  noteLabel?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState([0, 24]);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollFret, setScrollFret] = useState(0);
  const focused = Boolean(pattern || voicing);
  const canSelectPattern =
    availablePatterns.length > 0 && Boolean(onPatternSelect);
  const columnWidth = Math.max(48, viewportWidth / (focused ? 10 : 25));
  const musicalRange = useRef([0, 24]);
  const wasHidden = useRef(false);
  const titleId = useId();
  const frets = Array.from({ length: 25 }, (_, i) => (left ? 24 - i : i));
  const noteMap = new Map(notes.map((note) => [note.pc, note]));
  const selected = voicing
    ? new Set(
        voicing.frets.flatMap((fret, string) =>
          fret === null ? [] : [`${string}:${fret}`],
        ),
      )
    : pattern
      ? new Set(pattern.positions.map((p) => `${p.string}:${p.fret}`))
      : null;
  const updateRange = useCallback(() => {
    const el = viewport.current;
    if (!el || !el.clientWidth || !el.scrollWidth || wasHidden.current) return;
    const cell = el.scrollWidth / 25;
    const first = Math.max(0, Math.floor((el.scrollLeft + 0.5) / cell));
    const last = Math.min(
      24,
      Math.ceil((el.scrollLeft + el.clientWidth - 0.5) / cell) - 1,
    );
    const next = left ? [24 - last, 24 - first] : [first, last];
    musicalRange.current = next;
    setScrollFret(el.scrollLeft / cell);
    setRange((previous) =>
      previous[0] === next[0] && previous[1] === next[1] ? previous : next,
    );
  }, [left]);
  const jump = useCallback(
    (fret: number) => {
      const el = viewport.current;
      if (el)
        el.scrollTo({
          left: ((left ? 24 - fret : fret) * el.scrollWidth) / 25,
          behavior: 'auto',
        });
    },
    [left],
  );
  const previous = useRef({ left, scope, pattern, voicing, columnWidth });
  const scaleRange = useRef([0, 24]);
  const initialized = useRef(false);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const width = el.clientWidth;
      if (width === 0) wasHidden.current = true;
      setViewportWidth(width);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el?.clientWidth) {
      wasHidden.current = true;
      return;
    }
    if (viewportWidth <= 0) return;
    const before = previous.current;
    if (before.scope === 'scale' && scope === 'chord')
      scaleRange.current = [...musicalRange.current];
    const returning = before.scope === 'chord' && scope === 'scale';
    const changed =
      !initialized.current ||
      before.pattern !== pattern ||
      before.voicing !== voicing;
    if (returning) {
      jump(left ? scaleRange.current[1] : scaleRange.current[0]);
    } else if (before.left !== left) {
      jump(left ? musicalRange.current[1] : musicalRange.current[0]);
    } else if (changed && (pattern || voicing)) {
      const sounding = voicing?.frets.filter((f): f is number => f !== null);
      const min = sounding ? Math.min(...sounding) : pattern!.min;
      const max = sounding ? Math.max(...sounding) : pattern!.max;
      const padding = viewportWidth >= 480 ? (pattern ? 2 : 1) : 0;
      jump(left ? Math.min(24, max + padding) : Math.max(0, min - padding));
    } else if (wasHidden.current || before.columnWidth !== columnWidth) {
      jump(left ? musicalRange.current[1] : musicalRange.current[0]);
    }
    previous.current = { left, scope, pattern, voicing, columnWidth };
    initialized.current = true;
    wasHidden.current = false;
    updateRange();
  }, [
    pattern,
    voicing,
    scope,
    left,
    columnWidth,
    viewportWidth,
    jump,
    updateRange,
  ]);
  const maxScrollFret = Math.max(0, 25 - viewportWidth / columnWidth);

  return (
    <section
      className={`neck ${focused ? 'focused-neck' : ''} ${voicing ? 'voicing-neck' : ''} ${left ? 'left-handed-neck' : ''}`}
      aria-labelledby={titleId}
    >
      {controlsAbove && (
        <div className="instrument-dock practice-controls">{controls}</div>
      )}
      <div className="neck-meta">
        <span id={titleId}>
          STANDARD TUNING <span className="muted">/ E A D G B E</span>
        </span>
        <span className="neck-legend">
          {voicing?.rootless ? (
            <span className="muted">Root omitted</span>
          ) : (
            <>
              <i className="root-key" /> Root
            </>
          )}{' '}
          <i className="scale-key" /> {noteLabel}
          {targets.length > 0 && (
            <>
              <i className="target-key" /> Chord tone
            </>
          )}
        </span>
      </div>
      {canSelectPattern && (
        <p className="position-hint" id={`${titleId}-positions`}>
          Choose a lit fret to start a pattern <span>· low E</span>
        </p>
      )}
      <div
        className={`neck-frame ${canSelectPattern ? 'selectable-positions' : ''}`}
      >
        <div className="string-labels" aria-hidden="true">
          {['e', 'B', 'G', 'D', 'A', 'E'].map((string, i) => (
            <span key={i}>
              {string}
              {voicing && (
                <small>
                  {voicing.frets[5 - i] === null
                    ? '×'
                    : voicing.frets[5 - i] === 0
                      ? '○'
                      : ''}
                </small>
              )}
            </span>
          ))}
        </div>
        <div
          ref={viewport}
          className="neck-scroll"
          tabIndex={0}
          role="region"
          aria-label="Guitar neck, open strings through fret 24. Scroll horizontally or use the fret navigation controls."
          onScroll={updateRange}
        >
          <div
            className="fret-position-row"
            style={{
              gridTemplateColumns: `repeat(25, ${columnWidth}px)`,
              width: columnWidth * 25,
            }}
            role="group"
            aria-label={
              canSelectPattern ? 'Pattern starting fret' : 'Fret numbers'
            }
            aria-describedby={
              canSelectPattern ? `${titleId}-positions` : undefined
            }
          >
            {frets.map((fret) => {
              const index = availablePatterns.findIndex(
                (candidate) => candidate.start === fret,
              );
              const className = `fret-number ${[3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(fret) ? 'inlaid' : ''}`;
              return canSelectPattern && index >= 0 ? (
                <button
                  key={fret}
                  type="button"
                  className={`${className} pattern-fret`}
                  aria-label={`Start pattern at ${fret === 0 ? 'open low E' : `fret ${fret} on low E`}`}
                  aria-pressed={pattern === availablePatterns[index]}
                  onKeyDown={(event) => {
                    if (
                      !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(
                        event.key,
                      )
                    )
                      return;
                    const buttons = Array.from(
                      event.currentTarget.parentElement!.querySelectorAll(
                        'button',
                      ),
                    );
                    const current = buttons.indexOf(
                      event.target as HTMLButtonElement,
                    );
                    if (current < 0) return;
                    event.preventDefault();
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? buttons.length - 1
                          : Math.max(
                              0,
                              Math.min(
                                buttons.length - 1,
                                current + (event.key === 'ArrowLeft' ? -1 : 1),
                              ),
                            );
                    buttons[next]?.focus();
                  }}
                  onClick={() => onPatternSelect?.(index)}
                >
                  {fret === 0 ? 'OPEN' : fret}
                </button>
              ) : (
                <span key={fret} className={className}>
                  {fret === 0 ? 'OPEN' : fret}
                </span>
              );
            })}
          </div>
          <div
            className="fret-grid"
            style={{
              gridTemplateColumns: `repeat(25, ${columnWidth}px)`,
              width: columnWidth * 25,
              minWidth: 0,
            }}
            role="img"
            aria-label={`${root} ${voicing ? 'sounding notes' : 'notes'}: ${notes.map((n) => `${noteDescription(n)} degree ${pretty(n.degree)}`).join(', ')}. ${voicing ? `${voicing.name}. ${voicing.rootless ? 'Rootless shape. ' : ''}${voicing.omittedNotes?.length ? `Omitted: ${voicing.omittedNotes.map((note) => `${noteDescription(note)} degree ${pretty(note.degree)}`).join(', ')}. ` : ''}Low E to high e: ${voicing.frets.map((f) => (f === null ? 'mute' : f === 0 ? 'open' : f)).join(', ')}.` : pattern ? `Practice pattern from fret ${pattern.min} to ${pattern.max}.` : 'All note locations through fret 24.'} ${left ? 'Left-handed view.' : 'Right-handed view.'}`}
          >
            {frets.map((fret) => (
              <div
                className={`fret-column ${fret === 0 ? 'open-string' : ''}`}
                key={fret}
              >
                {[5, 4, 3, 2, 1, 0].map((string) => {
                  const note = noteMap.get(mod(TUNING[string] + fret));
                  const label = note
                    ? pretty(degrees ? note.degree : readableNoteName(note))
                    : '';
                  const show =
                    note && (!selected || selected.has(`${string}:${fret}`));
                  return (
                    <div
                      key={string}
                      className={`string-cell string-${string}`}
                    >
                      <span className="string-line" />
                      {show && (
                        <span
                          className={`note-dot ${label.length > 3 ? 'wide-note' : ''} ${note.degree === '1' ? 'is-root' : ''} ${targets.includes(note.pc) ? 'is-target' : ''}`}
                          title={`${noteDescription(note)} · ${pretty(note.degree)} · string ${6 - string}, fret ${fret}`}
                        >
                          {label}
                        </span>
                      )}
                    </div>
                  );
                })}
                <span className="inlay" aria-hidden="true">
                  {[12, 24].includes(fret)
                    ? '••'
                    : [3, 5, 7, 9, 15, 17, 19, 21].includes(fret)
                      ? '•'
                      : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="instrument-dock">
        {!controlsAbove && controls}
        <div className="neck-navigation">
          <div className="viewport-control">
            <span className="range-label" aria-live="polite">
              Frets {range[0]}–{range[1]} <span className="muted">of 24</span>
            </span>
            <label className="neck-slider" htmlFor={`${titleId}-viewport`}>
              <span className="sr-only">Neck position</span>
              <input
                id={`${titleId}-viewport`}
                type="range"
                min={0}
                max={maxScrollFret || 1}
                step="any"
                disabled={maxScrollFret === 0}
                value={Math.min(scrollFret, maxScrollFret)}
                aria-valuetext={`Frets ${range[0]} through ${range[1]} of 24`}
                onKeyDown={(event) => {
                  const el = viewport.current;
                  if (!el) return;
                  const delta = {
                    ArrowLeft: -1,
                    ArrowDown: -1,
                    ArrowRight: 1,
                    ArrowUp: 1,
                    PageDown: -5,
                    PageUp: 5,
                  }[event.key];
                  if (
                    delta === undefined &&
                    event.key !== 'Home' &&
                    event.key !== 'End'
                  )
                    return;
                  event.preventDefault();
                  const cell = el.scrollWidth / 25;
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? el.scrollWidth - el.clientWidth
                        : el.scrollLeft + (delta ?? 0) * cell;
                  el.scrollTo({ left: next, behavior: 'instant' });
                }}
                onChange={(event) => {
                  const el = viewport.current;
                  if (el)
                    el.scrollTo({
                      left: Number(event.target.value) * columnWidth,
                      behavior: 'instant',
                    });
                }}
              />
            </label>
          </div>
          <div className="fret-nav-buttons">
            <button
              type="button"
              className="icon-button"
              aria-label="Scroll neck left"
              onClick={() =>
                viewport.current?.scrollBy({
                  left: -viewport.current.clientWidth * 0.75,
                })
              }
            >
              <ArrowLeft size={17} />
            </button>
            <label className="jump-label" htmlFor={`${titleId}-jump`}>
              Jump to fret
              <MusicSelect
                id={`${titleId}-jump`}
                label="Jump to fret"
                value={null}
                onValueChange={(value) => jump(Number(value))}
                placeholder="Fret"
                options={Array.from({ length: 25 }, (_, i) => ({
                  value: String(i),
                  label: i === 0 ? 'Open' : String(i),
                }))}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label="Scroll neck right"
              onClick={() =>
                viewport.current?.scrollBy({
                  left: viewport.current.clientWidth * 0.75,
                })
              }
            >
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      </div>
      <details className="pattern-details">
        <summary>
          {voicing
            ? 'Read this chord shape by string'
            : pattern
              ? 'Read this pattern as fret numbers'
              : 'Read note positions by string'}
        </summary>
        {TUNING.map((open, string) => (
          <p key={string}>
            <strong>{['Low E', 'A', 'D', 'G', 'B', 'High e'][string]}: </strong>
            {voicing?.frets[string] === null
              ? 'Muted'
              : Array.from({ length: 25 }, (_, fret) => ({
                  fret,
                  note: noteMap.get(mod(open + fret)),
                }))
                  .filter(
                    ({ fret, note }) =>
                      note && (!selected || selected.has(`${string}:${fret}`)),
                  )
                  .map(
                    ({ fret, note }) =>
                      `${fret === 0 ? 'open' : fret} ${pretty(readableNoteName(note!))}`,
                  )
                  .join(' · ')}
          </p>
        ))}
      </details>
    </section>
  );
}
