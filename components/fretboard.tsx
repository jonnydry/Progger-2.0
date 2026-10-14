'use client';
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useId,
  useCallback,
  useMemo,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ListMusic,
  Map as MapIcon,
} from 'lucide-react';
import { MusicSelect } from '@/components/music-select';
import { mod, pretty, TUNING, type Note, type Pattern } from '@/lib/music';
import {
  subscribePhrasePlayhead,
  type PhraseFretMark,
} from '@/lib/phrase-marks';
import { readableNoteName, noteDescription } from '@/lib/note-presentation';
import {
  formAtProgress,
  formAtViewport,
  formLayers,
  scrollToForm,
  scrollToCenter,
  viewportCenter,
} from '@/lib/connected-neck';
import { NeckOverview } from '@/components/neck-overview';

type NeckVoicing = {
  name: string;
  frets: (number | null)[];
  omittedNotes?: Note[];
  rootless?: boolean;
};

const FretGrid = memo(function FretGrid({
  notes,
  columnWidth,
  left,
  degrees,
  root,
  voicing,
  pattern,
  layers,
  neighbor,
  scope,
  connected,
  targets,
  noteMap,
  selected,
  phraseMarks,
}: {
  notes: Note[];
  columnWidth: number;
  left: boolean;
  degrees: boolean;
  root: string;
  voicing?: NeckVoicing;
  pattern?: Pattern;
  layers: ReturnType<typeof formLayers>;
  neighbor?: Pattern;
  scope: 'scale' | 'chord';
  connected: boolean;
  targets: number[];
  noteMap: Map<number, Note>;
  selected: Set<string> | null;
  phraseMarks: Map<string, PhraseFretMark>;
}) {
  const frets = Array.from({ length: 25 }, (_, i) => (left ? 24 - i : i));
  return (
    <>
      <div
        className="fret-position-row"
        style={{
          gridTemplateColumns: `repeat(25, ${columnWidth}px)`,
          width: columnWidth * 25,
        }}
        role="group"
        aria-label="Fret numbers"
      >
        {frets.map((fret) => (
          <span
            key={fret}
            className={`fret-number ${pattern && fret >= pattern.min && fret <= pattern.max ? 'in-active-form' : ''} ${[3, 5, 7, 9, 12, 15, 17, 19, 21, 24].includes(fret) ? 'inlaid' : ''}`}
          >
            {fret === 0 ? 'OPEN' : fret}
          </span>
        ))}
      </div>
      <div
        className="fret-grid"
        style={{
          gridTemplateColumns: `repeat(25, ${columnWidth}px)`,
          width: columnWidth * 25,
          minWidth: 0,
        }}
        role="img"
        aria-label={`${root} ${voicing ? 'sounding notes' : 'notes'}: ${notes.map((n) => `${noteDescription(n)} degree ${pretty(n.degree)}`).join(', ')}. ${voicing ? `${voicing.name}. ${voicing.rootless ? 'Rootless shape. ' : ''}${voicing.omittedNotes?.length ? `Omitted: ${voicing.omittedNotes.map((note) => `${noteDescription(note)} degree ${pretty(note.degree)}`).join(', ')}. ` : ''}Low E to high e: ${voicing.frets.map((f) => (f === null ? 'mute' : f === 0 ? 'open' : f)).join(', ')}.` : pattern ? `Active ${notes.length === 5 ? 2 : 3}-notes-per-string form starts on low E at fret ${pattern.start} and spans frets ${pattern.min} to ${pattern.max}. ${neighbor ? `Neighbor form starts at fret ${neighbor.start}; ${layers.shared.size} shared string and fret positions. ` : ''}All scale notes remain visible as context.` : 'All note locations through fret 24.'} ${left ? 'Left-handed view.' : 'Right-handed view.'}`}
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
              const key = `${string}:${fret}`;
              const phrase = phraseMarks.get(key);
              const membership = layers.shared.has(key)
                ? 'shared'
                : layers.active.has(key)
                  ? 'active'
                  : layers.neighbor.has(key)
                    ? 'neighbor'
                    : 'context';
              const show =
                Boolean(phrase) ||
                Boolean(
                  note && (scope === 'scale' || !selected || selected.has(key)),
                );
              const phraseLabel = phrase
                ? pretty(degrees && note ? note.degree : phrase.label)
                : label;
              return (
                <div key={string} className={`string-cell string-${string}`}>
                  <span className="string-line" />
                  {show && (note || phrase) && (
                    <span
                      data-phrase-slot={phrase ? key : undefined}
                      className={`note-dot ${phrase ? 'phrase-mark' : ''} ${phrase?.current ? 'phrase-current' : ''} ${connected ? `connection-${membership}` : ''} ${phraseLabel.length > 3 ? 'wide-note' : ''} ${note?.degree === '1' ? 'is-root' : ''} ${note && targets.includes(note.pc) ? 'is-target' : ''}`}
                      title={
                        phrase
                          ? `${phrase.label} · finger ${phrase.finger === 0 ? 'open' : phrase.finger}${phrase.shift ? ' · shift' : ''} · string ${6 - string}, fret ${fret}`
                          : `${noteDescription(note!)} · ${pretty(note!.degree)} · string ${6 - string}, fret ${fret}${connected ? ` · ${membership === 'shared' ? 'shared by active and neighboring forms' : membership === 'context' ? 'scale context' : `${membership} form`}` : ''}`
                      }
                    >
                      {phraseLabel}
                      {phrase?.shift && (
                        <span className="phrase-shift" aria-hidden="true">
                          ›
                        </span>
                      )}
                      {phrase && (
                        <span className="phrase-finger">{phrase.finger}</span>
                      )}
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
    </>
  );
});

const PHONE_NECK_QUERY = '(max-width: 500px)';

function focusedNeckControlId(root: HTMLElement | null): string | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !root) return null;
  const moving = active.closest('.connection-controls');
  if (moving && root.contains(moving)) {
    if (active.id) return active.id;
    const owned = active.closest<HTMLElement>('[id]');
    return owned && moving.contains(owned) ? owned.id : null;
  }
  const trigger = root.querySelector<HTMLElement>(
    '.connection-controls [aria-expanded="true"][id]',
  );
  const popupId = trigger?.getAttribute('aria-controls');
  const popup = popupId ? document.getElementById(popupId) : null;
  if (trigger && popup && !root.contains(popup) && popup.contains(active))
    return trigger.id;
  return null;
}

function usePhoneNeck(rememberFocus: () => string | null) {
  const [phone, setPhone] = useState(false);
  const pendingFocusId = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = pendingFocusId.current;
    if (!id) return;
    pendingFocusId.current = null;
    const next = document.getElementById(id);
    if (next instanceof HTMLElement && document.activeElement !== next)
      next.focus({ preventScroll: true });
  }, [phone]);
  useLayoutEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const media = matchMedia(PHONE_NECK_QUERY);
    const sync = () => {
      const id = rememberFocus();
      if (id) pendingFocusId.current = id;
      setPhone(media.matches);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, [rememberFocus]);
  return phone;
}

export function Fretboard({
  notes,
  root,
  controls,
  controlsAbove = false,
  belowNeck,
  pattern,
  availablePatterns = [],
  activePatternIndex = 0,
  onPatternSelect,
  onPatternFollow,
  onNeckProgress,
  voicing,
  scope,
  degrees,
  left,
  targets = [],
  noteLabel = 'Scale note',
  phraseMarks = [],
  focusFret = null,
}: {
  notes: Note[];
  controls: ReactNode;
  controlsAbove?: boolean;
  belowNeck?: ReactNode;
  root: string;
  pattern?: Pattern;
  availablePatterns?: Pattern[];
  activePatternIndex?: number;
  onPatternSelect?: (index: number) => void;
  onPatternFollow?: (index: number) => void;
  onNeckProgress?: (progress: number) => void;
  scope: 'scale' | 'chord';
  voicing?: NeckVoicing;
  degrees: boolean;
  left: boolean;
  targets?: number[];
  noteLabel?: string;
  phraseMarks?: readonly PhraseFretMark[];
  focusFret?: number | null;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState([0, 24]);
  const [viewportWidth, setViewportWidth] = useState(0);
  const [scrollFret, setScrollFret] = useState(0);
  const [widthMode, setWidthMode] = useState('balanced');
  const [overlap, setOverlap] = useState('next');
  const [overview, setOverview] = useState(false);
  const followingPattern = useRef<Pattern | null>(null);
  const programmaticScroll = useRef<number | null>(null);
  const viewCenter = useRef(7.5);
  const viewProgress = useRef(0.3);
  const drag = useRef<{ pointer: number; x: number; scroll: number } | null>(
    null,
  );
  const scrollFrame = useRef<number | null>(null);
  const sliderScroll = useRef<number | null>(null);
  const focused = Boolean(pattern || voicing);
  const canSelectPattern =
    scope === 'scale' &&
    availablePatterns.length > 0 &&
    Boolean(onPatternSelect);
  const connected = scope === 'scale' && Boolean(pattern);
  const density =
    widthMode === 'close'
      ? [72, 6]
      : widthMode === 'wide'
        ? [44, 16]
        : [48, 10];
  const columnWidth =
    scope === 'scale'
      ? Math.max(density[0], viewportWidth / density[1])
      : Math.max(48, viewportWidth / (focused ? 10 : 25));
  const activeIndex = pattern
    ? availablePatterns.indexOf(pattern)
    : activePatternIndex;
  const neighborIndex =
    overlap === 'previous' ? activeIndex - 1 : activeIndex + 1;
  const neighbor =
    connected && overlap !== 'off' && activeIndex >= 0
      ? availablePatterns[neighborIndex]
      : undefined;
  const layers = useMemo(
    () => formLayers(pattern, neighbor),
    [pattern, neighbor],
  );
  const noteMap = useMemo(
    () => new Map(notes.map((note) => [note.pc, note])),
    [notes],
  );
  const phraseMarkMap = useMemo(() => {
    const marks = new Map<string, PhraseFretMark>();
    for (const mark of phraseMarks)
      marks.set(`${mark.string}:${mark.fret}`, mark);
    return marks;
  }, [phraseMarks]);
  const selected = useMemo(
    () =>
      voicing
        ? new Set(
            voicing.frets.flatMap((fret, string) =>
              fret === null ? [] : [`${string}:${fret}`],
            ),
          )
        : pattern
          ? new Set(pattern.positions.map((p) => `${p.string}:${p.fret}`))
          : null,
    [voicing, pattern],
  );
  const wasHidden = useRef(false);
  const titleId = useId();
  const trackScroll = useCallback(
    (el: HTMLDivElement) => {
      const cell = el.scrollWidth / 25;
      viewCenter.current = viewportCenter(
        el.scrollLeft,
        el.clientWidth,
        cell,
        left,
      );
      const travel = el.scrollWidth - el.clientWidth;
      const progress = travel > 0 ? el.scrollLeft / travel : 0.5;
      viewProgress.current = left ? 1 - progress : progress;
      return cell;
    },
    [left],
  );
  const updateRange = useCallback(
    (follow = false) => {
      const el = viewport.current;
      if (!el || !el.clientWidth || !el.scrollWidth || wasHidden.current)
        return;
      // Native scrolling can clamp against the old grid before ResizeObserver
      // supplies the new viewport width. That is layout, not player movement.
      if (follow && Math.abs(el.clientWidth - viewportWidth) > 1) return;
      const cell = trackScroll(el);
      const first = Math.max(0, Math.floor((el.scrollLeft + 0.5) / cell));
      const last = Math.min(
        24,
        Math.ceil((el.scrollLeft + el.clientWidth - 0.5) / cell) - 1,
      );
      const next = left ? [24 - last, 24 - first] : [first, last];
      // Chord shapes scroll independently, then the scale view is restored.
      // Connected forms follow the scale neck, not that temporary chord scroll.
      if (scope === 'scale') onNeckProgress?.(viewProgress.current);
      setScrollFret(el.scrollLeft / cell);
      setRange((previous) =>
        previous[0] === next[0] && previous[1] === next[1] ? previous : next,
      );
      if (!follow) return;
      const programmed = programmaticScroll.current;
      programmaticScroll.current = null;
      if (programmed !== null && Math.abs(el.scrollLeft - programmed) < 1)
        return;
      if (scope === 'scale' && onPatternFollow) {
        const index = formAtViewport(
          availablePatterns,
          el.scrollLeft,
          el.clientWidth,
          cell,
          left,
          activeIndex,
        );
        if (index >= 0 && index !== activeIndex) {
          followingPattern.current = availablePatterns[index];
          onPatternFollow(index);
        }
      }
    },
    [
      left,
      scope,
      activeIndex,
      availablePatterns,
      onPatternFollow,
      trackScroll,
      onNeckProgress,
      viewportWidth,
    ],
  );
  const scrollReading = useRef({
    updateRange,
    trackScroll,
    viewportWidth,
    scope,
    onNeckProgress,
  });
  useLayoutEffect(() => {
    scrollReading.current = {
      updateRange,
      trackScroll,
      viewportWidth,
      scope,
      onNeckProgress,
    };
  }, [updateRange, trackScroll, viewportWidth, scope, onNeckProgress]);
  const onNeckScroll = useCallback(() => {
    const el = viewport.current;
    const reading = scrollReading.current;
    if (
      el &&
      el.clientWidth &&
      el.scrollWidth &&
      !wasHidden.current &&
      Math.abs(el.clientWidth - reading.viewportWidth) <= 1
    ) {
      reading.trackScroll(el);
      // Match can hide the neck in this same frame, and the queued update
      // then no-ops. The handoff reads this progress, so publish it now.
      if (reading.scope === 'scale')
        reading.onNeckProgress?.(viewProgress.current);
    }
    // The slider commits in the input event. scrollTo updates scrollLeft
    // immediately, and Chrome fires this scroll in the next frame's rendering
    // step. Skip that event only when it lands on the slider's target, so a
    // pan in the same frame still queues updateRange.
    if (
      el &&
      sliderScroll.current !== null &&
      Math.abs(el.scrollLeft - sliderScroll.current) < 1
    ) {
      sliderScroll.current = null;
      return;
    }
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      scrollReading.current.updateRange(true);
    });
  }, []);
  useEffect(() => {
    return () => {
      if (scrollFrame.current !== null) {
        cancelAnimationFrame(scrollFrame.current);
        scrollFrame.current = null;
      }
    };
  }, []);
  const centerOn = useCallback(
    (fret: number) => {
      const el = viewport.current;
      if (!el) return;
      const next = scrollToCenter(fret, el.clientWidth, columnWidth, left);
      programmaticScroll.current = next;
      el.scrollTo({ left: next, behavior: 'instant' });
    },
    [columnWidth, left],
  );
  const centerForm = useCallback(
    (index: number) => {
      const el = viewport.current;
      if (!el) return;
      const next = scrollToForm(
        availablePatterns,
        index,
        el.clientWidth,
        columnWidth,
        left,
      );
      programmaticScroll.current = next;
      el.scrollTo({ left: next, behavior: 'instant' });
    },
    [availablePatterns, columnWidth, left],
  );
  const restoreProgress = useCallback(
    (progress: number) => {
      const el = viewport.current;
      if (!el) return;
      const next =
        (left ? 1 - progress : progress) *
        Math.max(0, 25 * columnWidth - el.clientWidth);
      programmaticScroll.current = next;
      el.scrollTo({ left: next, behavior: 'instant' });
    },
    [left, columnWidth],
  );
  const jump = useCallback(
    (fret: number) => {
      const el = viewport.current;
      if (el) {
        programmaticScroll.current = null;
        el.scrollTo({
          left: scrollToCenter(fret, el.clientWidth, columnWidth, left),
          behavior: 'instant',
        });
      }
    },
    [left, columnWidth],
  );
  const previous = useRef({
    left,
    scope,
    pattern,
    voicing,
    columnWidth,
    viewportWidth,
  });
  const scaleProgress = useRef(0.3);
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
      scaleProgress.current = viewProgress.current;
    const returning = before.scope === 'chord' && scope === 'scale';
    const changed =
      !initialized.current ||
      before.pattern !== pattern ||
      before.voicing !== voicing;
    if (returning) {
      restoreProgress(scaleProgress.current);
    } else if (before.left !== left) {
      if (scope === 'scale') restoreProgress(viewProgress.current);
      else centerOn(viewCenter.current);
    } else if (
      initialized.current &&
      before.scope === 'scale' &&
      scope === 'scale' &&
      !before.pattern &&
      pattern
    ) {
      // Enabling the connected layer keeps the view where the player left it.
    } else if (changed && (pattern || voicing)) {
      if (followingPattern.current !== pattern || voicing) {
        const sounding = voicing?.frets.filter((f): f is number => f !== null);
        if (sounding)
          centerOn((Math.min(...sounding) + Math.max(...sounding)) / 2);
        else centerForm(activeIndex);
      }
    } else if (
      wasHidden.current ||
      before.columnWidth !== columnWidth ||
      before.viewportWidth !== viewportWidth
    ) {
      if (scope === 'scale') restoreProgress(viewProgress.current);
      else centerOn(viewCenter.current);
    }
    // A scroll frame can no-op once Match hides the neck. Catch the form up
    // to the progress already on screen without recentering that view.
    const revealing =
      wasHidden.current &&
      initialized.current &&
      !returning &&
      before.left === left &&
      !(changed && (pattern || voicing));
    let caughtUp: Pattern | undefined;
    if (revealing && scope === 'scale' && onPatternFollow) {
      const index = formAtProgress(
        availablePatterns,
        viewProgress.current,
        activeIndex,
      );
      const next = availablePatterns[index];
      if (index >= 0 && index !== activeIndex && next) {
        caughtUp = next;
        onPatternFollow(index);
      }
    }
    followingPattern.current = caughtUp ?? null;
    previous.current = {
      left,
      scope,
      pattern,
      voicing,
      columnWidth,
      viewportWidth,
    };
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
    centerOn,
    centerForm,
    restoreProgress,
    activeIndex,
    updateRange,
    availablePatterns,
    onPatternFollow,
  ]);
  const appliedPhraseFocus = useRef('');
  useLayoutEffect(() => {
    if (focusFret == null || viewportWidth <= 0) {
      appliedPhraseFocus.current = '';
      return;
    }
    const token = `${focusFret}:${left}`;
    if (appliedPhraseFocus.current === token) return;
    appliedPhraseFocus.current = token;
    jump(focusFret);
  }, [focusFret, left, viewportWidth, jump]);
  useEffect(() => {
    const root = viewport.current;
    if (!root) return;
    const apply = (slot: string | null) => {
      const marked = root.querySelectorAll('.phrase-current');
      for (const node of marked) node.classList.remove('phrase-current');
      if (!slot) return;
      root
        .querySelector(`[data-phrase-slot="${slot}"]`)
        ?.classList.add('phrase-current');
    };
    return subscribePhrasePlayhead(apply);
  }, [phraseMarkMap]);
  const maxScrollFret = Math.max(0, 25 - viewportWidth / columnWidth);
  const moveWithKey = (event: KeyboardEvent<HTMLElement>) => {
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
    if (delta === undefined && event.key !== 'Home' && event.key !== 'End')
      return;
    event.preventDefault();
    programmaticScroll.current = null;
    el.scrollTo({
      left:
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? el.scrollWidth - el.clientWidth
            : el.scrollLeft + (delta ?? 0) * columnWidth,
      behavior: 'instant',
    });
  };
  const selectForm = (index: number) => {
    const form = availablePatterns[index];
    if (!form) return;
    followingPattern.current = null;
    centerForm(index);
    onPatternSelect?.(index);
  };
  const neckSection = useRef<HTMLElement>(null);
  const rememberNeckFocus = useCallback(
    () => focusedNeckControlId(neckSection.current),
    [],
  );
  const phoneNeck = usePhoneNeck(rememberNeckFocus);
  const scaleForm = (
    <>
      {scope === 'scale' && (
        <div className="connection-controls">
          {canSelectPattern && (
            <label className="form-picker" htmlFor={`${titleId}-form`}>
              <span>Active form · low-E start</span>
              <MusicSelect
                id={`${titleId}-form`}
                label="Active form starting fret on low E"
                value={pattern ? String(pattern.start) : null}
                placeholder="Choose a form"
                onValueChange={(value) =>
                  selectForm(
                    availablePatterns.findIndex(
                      (form) => form.start === Number(value),
                    ),
                  )
                }
                options={availablePatterns.map((form) => ({
                  value: String(form.start),
                  label: `${form.start === 0 ? 'Open' : `Fret ${form.start}`} · ${pretty(noteMap.get(mod(TUNING[0] + form.start))!.name)}`,
                }))}
              />
            </label>
          )}
          {connected && (
            <label htmlFor={`${titleId}-overlap`}>
              <span>Overlap</span>
              <MusicSelect
                id={`${titleId}-overlap`}
                label="Form overlap"
                value={overlap}
                onValueChange={setOverlap}
                options={[
                  { value: 'off', label: 'Active form only' },
                  { value: 'previous', label: 'Lower neighbor' },
                  { value: 'next', label: 'Higher neighbor' },
                ]}
              />
            </label>
          )}
          <label htmlFor={`${titleId}-width`}>
            <span>View width</span>
            <MusicSelect
              id={`${titleId}-width`}
              label="Neck view width"
              value={widthMode}
              onValueChange={setWidthMode}
              options={[
                { value: 'close', label: 'Close' },
                { value: 'balanced', label: 'Balanced' },
                { value: 'wide', label: 'Wide' },
              ]}
            />
          </label>
          <button
            id={`${titleId}-overview-toggle`}
            className="overview-toggle"
            aria-expanded={overview}
            aria-controls={`${titleId}-overview`}
            onClick={() => setOverview(!overview)}
          >
            <MapIcon size={17} aria-hidden="true" /> Whole-neck overview
          </button>
        </div>
      )}
      {connected && pattern && (
        <div className="connection-caption" id={`${titleId}-connections`}>
          <p>
            <strong>{notes.length === 5 ? 2 : 3} notes/string per form</strong>{' '}
            · active frets {pattern.min}–{pattern.max}
            {neighbor
              ? ` · ${overlap === 'previous' ? 'lower' : 'higher'} neighbor starts at ${neighbor.start === 0 ? 'open low E' : `fret ${neighbor.start}`} · ${layers.shared.size} shared positions`
              : overlap !== 'off'
                ? ` · no ${overlap === 'previous' ? 'lower' : 'higher'} complete form`
                : ''}
          </p>
          <div className="connection-legend">
            <span>
              <i className="active-swatch" />
              Active
            </span>
            {neighbor && (
              <>
                <span>
                  <i className="neighbor-swatch" />
                  Neighbor
                </span>
                <span>
                  <i className="shared-swatch" />
                  Shared
                </span>
              </>
            )}
            <span>
              <i className="context-swatch" />
              Scale context
            </span>
          </div>
          <p className="pan-hint">
            Drag the neck to explore. The active form follows your view.
          </p>
        </div>
      )}
    </>
  );

  return (
    <section
      ref={neckSection}
      className={`neck ${connected ? 'connected-neck' : ''} ${focused ? 'focused-neck' : ''} ${voicing ? 'voicing-neck' : ''} ${left ? 'left-handed-neck' : ''}`}
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
      {!phoneNeck && scaleForm}
      <div className="neck-frame">
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
        {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- The named, focusable neck region supports keyboard scrolling and pointer panning. */}
        <div
          ref={viewport}
          className="neck-scroll"
          tabIndex={0}
          role="region"
          aria-label="Guitar neck, open strings through fret 24. Scroll horizontally or use the fret navigation controls."
          onScroll={onNeckScroll}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget) moveWithKey(event);
          }}
          onPointerDown={(event) => {
            if (event.pointerType === 'touch' || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            drag.current = {
              pointer: event.pointerId,
              x: event.clientX,
              scroll: event.currentTarget.scrollLeft,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (!drag.current || drag.current.pointer !== event.pointerId)
              return;
            programmaticScroll.current = null;
            event.currentTarget.scrollLeft =
              drag.current.scroll + drag.current.x - event.clientX;
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        >
          <FretGrid
            notes={notes}
            columnWidth={columnWidth}
            left={left}
            degrees={degrees}
            root={root}
            voicing={voicing}
            pattern={pattern}
            layers={layers}
            neighbor={neighbor}
            scope={scope}
            connected={connected}
            targets={targets}
            noteMap={noteMap}
            selected={selected}
            phraseMarks={phraseMarkMap}
          />
        </div>
      </div>
      {belowNeck}
      <div className="instrument-dock">
        {!controlsAbove && controls}
        <div className="neck-navigation">
          <div className="viewport-control">
            <span className="range-label">
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
                onKeyDown={moveWithKey}
                onChange={(event) => {
                  const el = viewport.current;
                  if (!el) return;
                  programmaticScroll.current = null;
                  el.scrollTo({
                    left: Number(event.target.value) * columnWidth,
                    behavior: 'instant',
                  });
                  // The scroll event for this move fires in the next frame's
                  // rendering step. Remember where scrollLeft landed, and clear
                  // that target on the next frame when the event never comes.
                  sliderScroll.current = el.scrollLeft;
                  // The slider is controlled. Commit its fret in this event so
                  // the thumb is not restored to the previous frame.
                  updateRange(true);
                  requestAnimationFrame(() => {
                    sliderScroll.current = null;
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
      {phoneNeck && scaleForm}
      {scope === 'scale' && overview && (
        <NeckOverview
          id={`${titleId}-overview`}
          notes={notes}
          left={left}
          layers={connected ? layers : undefined}
          range={range}
          offset={scrollFret / 25}
          windowWidth={Math.min(1, viewportWidth / (25 * columnWidth))}
          onNavigate={jump}
          onKeyDown={moveWithKey}
        />
      )}
      <details className="pattern-details string-reference">
        <summary>
          <ListMusic size={18} aria-hidden="true" />
          <span>
            {voicing
              ? 'Read this chord shape by string'
              : pattern
                ? 'Read the active form as fret numbers'
                : 'Read note positions by string'}
          </span>
          <ChevronDown
            className="disclosure-chevron"
            size={16}
            aria-hidden="true"
          />
        </summary>
        <div className="string-reference-content">
          <p className="string-reference-key">
            Fret number + note · from low E to high e
            {connected &&
              ' · active form, with shared and neighboring positions below.'}
          </p>
          <dl className="string-reference-rows">
            {TUNING.map((open, string) => (
              <div key={string}>
                <dt>
                  <small>{6 - string}</small>
                  {['Low E', 'A', 'D', 'G', 'B', 'High e'][string]}
                </dt>
                <dd>
                  <span>
                    {voicing?.frets[string] === null
                      ? 'Muted'
                      : Array.from({ length: 25 }, (_, fret) => ({
                          fret,
                          note: noteMap.get(mod(open + fret)),
                        }))
                          .filter(
                            ({ fret, note }) =>
                              note &&
                              (!selected || selected.has(`${string}:${fret}`)),
                          )
                          .map(
                            ({ fret, note }) =>
                              `${fret === 0 ? 'open' : fret} ${pretty(readableNoteName(note!))}`,
                          )
                          .join(' · ')}
                  </span>
                  {neighbor && (
                    <span className="string-connection-reference">
                      <span>
                        Shared:{' '}
                        {neighbor.positions
                          .filter(
                            (position) =>
                              position.string === string &&
                              layers.shared.has(`${string}:${position.fret}`),
                          )
                          .map(
                            ({ fret }) =>
                              `${fret === 0 ? 'open' : fret} ${pretty(readableNoteName(noteMap.get(mod(open + fret))!))}`,
                          )
                          .join(' · ') || 'none'}
                      </span>
                      <span>
                        Neighbor:{' '}
                        {neighbor.positions
                          .filter((position) => position.string === string)
                          .map(
                            ({ fret }) =>
                              `${fret === 0 ? 'open' : fret} ${pretty(readableNoteName(noteMap.get(mod(open + fret))!))}`,
                          )
                          .join(' · ')}
                      </span>
                    </span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </details>
    </section>
  );
}
