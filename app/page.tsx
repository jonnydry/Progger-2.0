'use client';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  useRef,
} from 'react';
import { flushSync } from 'react-dom';
import { ThemeToggle } from '@/components/theme-toggle';
import { PondScene } from '@/components/pond-scene';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  BookOpen,
  Music2,
  PanelTopClose,
} from 'lucide-react';
import { MusicSelect } from '@/components/music-select';
import { Fretboard } from '@/components/fretboard';
import { VoicingBrowser } from '@/components/voicing-browser';
import { qualityGroup } from '@/lib/chord-presentation';
import { MatchChords } from '@/components/match-chords';
import { UnderwaterScene } from '@/components/underwater-scene';
import { NoteSpelling } from '@/components/note-spelling';
import { NeckDisplay } from '@/components/neck-display';
import { readableNoteName, noteDescription } from '@/lib/note-presentation';
import { nearestPatternIndex } from '@/lib/practice-position';
import { nearestConnectedForm } from '@/lib/connected-neck';
import { matchingVoicingIndex } from '@/lib/voicing-navigation';
import {
  SCALES,
  ROOTS,
  patterns,
  pretty,
  spell,
  pitchClass,
} from '@/lib/music';
import {
  diatonicChords,
  QUALITIES,
  voicings,
  type Chord,
  type Candidate,
} from '@/lib/harmony';

export default function Home() {
  const [page, setPage] = useState('explore'),
    [kind, setKind] = useState('scales');
  const [scaleRoot, setScaleRoot] = useState('A'),
    [chordRoot, setChordRoot] = useState('C');
  const root = kind === 'scales' ? scaleRoot : chordRoot;
  const setRoot = kind === 'scales' ? setScaleRoot : setChordRoot;
  const [scaleId, setScaleId] = useState('dorian'),
    [qualityId, setQualityId] = useState('major');
  const [chordView, setChordView] = useState<'shape' | 'tones'>('shape');
  const [voicingIndex, setVoicingIndex] = useState(0);
  const [voicingBass, setVoicingBass] = useState('all');
  const [voicingNearFret, setVoicingNearFret] = useState<number | null>(null);
  const [voicingStrings, setVoicingStrings] = useState('all');
  const [theoryOpen, setTheoryOpen] = useState(false);
  const [practice, setPractice] = useState(false);
  const returnPoint = useRef<{ id: string; scroll: number } | null>(null);
  const matchReturnPoint = useRef<{
    element: HTMLElement | null;
    scroll: number;
  } | null>(null);
  const pendingMatchReturn = useRef<typeof matchReturnPoint.current>(null);
  const [view, setView] = useState<'map' | 'pattern'>('pattern');
  const neckProgress = useRef(0.3);
  const rememberNeckProgress = useCallback((progress: number) => {
    neckProgress.current = progress;
  }, []);
  const [degrees, setDegrees] = useState(false),
    [left, setLeft] = useState(false),
    [position, setPosition] = useState(() =>
      patterns(
        spell('A', SCALES.find((s) => s.id === 'dorian')!.formula),
      ).findIndex((p) => p.start === 5),
    );
  const [context, setContext] = useState<Chord[]>([]),
    [activeChord, setActiveChord] = useState(0);
  const [localChoice, setLocalChoice] = useState<number | null>(null);
  const scale = SCALES.find((s) => s.id === scaleId)!;
  const quality = QUALITIES.find((q) => q.id === qualityId)!;
  const formula = kind === 'scales' ? scale.formula : quality.formula;
  const title = kind === 'scales' ? scale.name : quality.name;
  const notes = useMemo(() => spell(root, formula), [root, formula]);
  const shapes = useMemo(
    () => (kind === 'scales' ? patterns(notes) : []),
    [notes, kind],
  );
  const shape =
    kind === 'scales' && view === 'pattern'
      ? shapes[Math.min(position, shapes.length - 1)]
      : undefined;
  const related = useMemo(() => diatonicChords(root, scale), [root, scale]);
  const chordVoicings = useMemo(() => voicings(root, quality), [root, quality]);
  const selectedVoicing =
    kind === 'chords' && chordView === 'shape'
      ? chordVoicings[Math.min(voicingIndex, chordVoicings.length - 1)]
      : undefined;
  useEffect(() => {
    const sync = () => {
      const destination = location.hash === '#match' ? 'match' : 'explore';
      if (destination !== 'match') pendingMatchReturn.current = null;
      setPage(destination);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useLayoutEffect(() => {
    if (page !== 'match') return;
    const point = pendingMatchReturn.current;
    pendingMatchReturn.current = null;
    if (!point) return;
    if (point.element?.isConnected && point.element.getClientRects().length) {
      point.element.focus({ preventScroll: true });
      window.scrollTo({ top: point.scroll, behavior: 'instant' });
    } else {
      const main = document.getElementById('main-content');
      main?.focus({ preventScroll: true });
      main?.scrollIntoView({ block: 'start', behavior: 'instant' });
    }
  }, [page]);
  useEffect(() => {
    const registry = (
      document as Document & {
        modelContext?: {
          registerTool: (
            tool: unknown,
            options: { signal: AbortSignal },
          ) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!registry?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: 'explore_scale',
      title: 'Explore a guitar scale',
      description:
        'Choose a root and scale in Progger, show its notes on the guitar neck, and return the scale formula.',
      inputSchema: {
        type: 'object',
        properties: {
          root: { type: 'string', enum: ROOTS },
          scaleId: { type: 'string', enum: SCALES.map((s) => s.id) },
        },
        required: ['root', 'scaleId'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input: unknown) {
        if (!input || typeof input !== 'object')
          throw new Error('Expected root and scaleId.');
        const value = input as Record<string, unknown>;
        if (
          Object.keys(value).some(
            (key) => !['root', 'scaleId'].includes(key),
          ) ||
          typeof value.root !== 'string' ||
          !ROOTS.includes(value.root)
        )
          throw new Error('Choose a supported root.');
        const selected = SCALES.find((s) => s.id === value.scaleId);
        if (!selected) throw new Error('Choose a supported scaleId.');
        const chosenRoot = value.root;
        const nextNotes = spell(chosenRoot, selected.formula);
        returnPoint.current = null;
        flushSync(() => {
          setScaleRoot(chosenRoot);
          setScaleId(selected.id);
          setKind('scales');
          setPage('explore');
          setView('map');
          setPosition(
            nearestConnectedForm(patterns(nextNotes), neckProgress.current),
          );
          setContext([]);
        });
        location.hash = 'explore';
        return {
          root: chosenRoot,
          scale: selected.name,
          notes: nextNotes.map((n) => n.name),
          formula: selected.formula,
        };
      },
    };
    try {
      void Promise.resolve(
        registry.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* A missing optional browser capability must not block the reference. */
    }
    return () => lifecycle.abort();
  }, []);
  function choose(rootValue: string, id: string) {
    setRoot(rootValue);
    setVoicingBass('all');
    if (kind === 'chords') {
      setVoicingIndex(
        matchingVoicingIndex(
          voicings(rootValue, quality),
          { bass: 'all', strings: voicingStrings, nearFret: voicingNearFret },
          0,
        ),
      );
      return;
    }
    setVoicingIndex(0);
    const nextScale = SCALES.find((s) => s.id === id)!;
    const nextPatterns = patterns(spell(rootValue, nextScale.formula));
    setScaleId(id);
    setPosition(
      nearestPatternIndex(nextPatterns, shapes[position]?.start ?? 0),
    );
    setLocalChoice(null);
    if (!nextPatterns.length) setView('map');
  }
  function navigate(destination: string) {
    pendingMatchReturn.current = null;
    setPage(destination);
    location.hash = destination;
  }
  function openMatch(
    candidate: Candidate,
    chords: Chord[],
    activeChordIndex?: number,
  ) {
    returnPoint.current = null;
    const element = document.activeElement;
    matchReturnPoint.current = {
      element:
        element instanceof HTMLElement && element.closest('.match-workspace')
          ? element
          : null,
      scroll: window.scrollY,
    };
    setScaleRoot(candidate.root);
    setScaleId(candidate.scale.id);
    setKind('scales');
    setPosition(
      nearestConnectedForm(
        patterns(spell(candidate.root, candidate.scale.formula)),
        neckProgress.current,
      ),
    );
    setView('map');
    setContext(chords);
    setActiveChord(activeChordIndex ?? 0);
    setLocalChoice(activeChordIndex ?? null);
    navigate('explore');
    document.getElementById('main-content')?.focus();
  }
  function returnToMatch() {
    pendingMatchReturn.current = matchReturnPoint.current ?? {
      element: null,
      scroll: 0,
    };
    matchReturnPoint.current = null;
    // Native fragment navigation can scroll after the layout-effect restore.
    // Keep the history entry, but let the explicit return own focus and scroll.
    window.history.pushState(window.history.state, '', '#match');
    setPage('match');
  }
  function openChord(chordRoot: string, id: string, bass?: string) {
    returnPoint.current = {
      id: document.activeElement?.id || 'main-content',
      scroll: window.scrollY,
    };
    setChordRoot(chordRoot);
    setQualityId(id);
    const requestedBass = bass ? pitchClass(bass) : undefined;
    const nextVoicings = voicings(
      chordRoot,
      QUALITIES.find((candidate) => candidate.id === id)!,
    );
    const bassIndex =
      requestedBass === undefined
        ? -1
        : nextVoicings.findIndex(
            (voicing) => voicing.bass.pc === requestedBass,
          );
    const nextBass = bassIndex >= 0 ? String(requestedBass) : 'all';
    setVoicingBass(nextBass);
    setVoicingIndex(
      matchingVoicingIndex(
        nextVoicings,
        { bass: nextBass, strings: voicingStrings, nearFret: voicingNearFret },
        bassIndex >= 0 ? bassIndex : 0,
      ),
    );
    setChordView('shape');
    setKind('chords');
    requestAnimationFrame(() => {
      document
        .getElementById('return-to-scale')
        ?.focus({ preventScroll: true });
      document
        .getElementById('main-content')
        ?.scrollIntoView({ block: 'start' });
    });
  }
  function returnToScale() {
    if (kind === 'scales') return;
    setKind('scales');
    const point = returnPoint.current;
    returnPoint.current = null;
    requestAnimationFrame(() => {
      document
        .getElementById(point?.id || 'main-content')
        ?.focus({ preventScroll: true });
      if (point) window.scrollTo({ top: point.scroll, behavior: 'instant' });
    });
  }
  const currentChord = context[activeChord];
  const contextVoicingBass = useMemo(() => {
    if (!currentChord?.bass) return undefined;
    const bassPc = pitchClass(currentChord.bass);
    return voicings(currentChord.root, currentChord.quality).some(
      (voicing) => voicing.bass.pc === bassPc,
    )
      ? currentChord.bass
      : undefined;
  }, [currentChord]);
  const soundingNotes = currentChord
    ? [
        ...currentChord.notes.map((n) => ({ name: n.name, pc: n.pc })),
        ...(currentChord.bass &&
        !currentChord.notes.some((n) => n.pc === pitchClass(currentChord.bass!))
          ? [{ name: currentChord.bass, pc: pitchClass(currentChord.bass) }]
          : []),
      ]
    : [];
  const outside = soundingNotes.filter(
    (n) => !notes.some((scaleNote) => scaleNote.pc === n.pc),
  );
  const instrumentControls = (
    <>
      <div className="segmented" role="group" aria-label="Fretboard view">
        <button
          aria-pressed={
            kind === 'scales'
              ? view === 'map'
              : chordView === 'tones' || !chordVoicings.length
          }
          onClick={() =>
            kind === 'scales' ? setView('map') : setChordView('tones')
          }
        >
          {kind === 'scales' ? 'All notes' : 'All chord tones'}
        </button>
        {kind === 'chords' && chordVoicings.length > 0 && (
          <button
            aria-pressed={chordView === 'shape'}
            onClick={() => setChordView('shape')}
          >
            Chord shapes
          </button>
        )}
        {shapes.length > 0 && (
          <button
            aria-pressed={view === 'pattern'}
            onClick={() => setView('pattern')}
          >
            Connected forms
          </button>
        )}
      </div>

      <div className="display-controls">
        <div
          className="segmented compact"
          role="group"
          aria-label="Note labels"
        >
          <button aria-pressed={!degrees} onClick={() => setDegrees(false)}>
            Notes
          </button>
          <button aria-pressed={degrees} onClick={() => setDegrees(true)}>
            Degrees
          </button>
        </div>
        <NeckDisplay left={left} onLeftChange={setLeft} />
      </div>
    </>
  );
  const voicingBrowser = selectedVoicing && (
    <VoicingBrowser
      active={page === 'explore'}
      voicings={chordVoicings}
      index={Math.min(voicingIndex, chordVoicings.length - 1)}
      bassFilter={voicingBass}
      nearFret={voicingNearFret}
      strings={voicingStrings}
      onNearFretChange={setVoicingNearFret}
      symbol={root + quality.symbol}
      onSelect={setVoicingIndex}
      onStringsChange={(nextStrings) => {
        setVoicingStrings(nextStrings);
        setVoicingIndex(
          matchingVoicingIndex(
            chordVoicings,
            {
              bass: voicingBass,
              strings: nextStrings,
              nearFret: voicingNearFret,
            },
            voicingIndex,
          ),
        );
      }}
      onBassChange={(bass) => {
        setVoicingBass(bass);
        setVoicingIndex(
          matchingVoicingIndex(
            chordVoicings,
            { bass, strings: voicingStrings, nearFret: voicingNearFret },
            voicingIndex,
          ),
        );
      }}
      onReset={() => {
        // Cleared filters include the held shape. Applying each clear through
        // its own handler would still see the previous filters and jump away.
        setVoicingStrings('all');
        setVoicingNearFret(null);
        setVoicingBass('all');
      }}
    />
  );
  return (
    <div className={`app-shell night-swim ${practice ? 'practice-view' : ''}`}>
      <header className="site-header">
        <PondScene />
        <a
          href="#explore"
          onClick={() => navigate('explore')}
          className="brand"
          aria-label="Progger home"
        >
          <span>PROGGER</span>
        </a>
        <nav aria-label="Main navigation">
          <a
            href="#explore"
            aria-current={page === 'explore' ? 'page' : undefined}
            onClick={() => navigate('explore')}
          >
            Explore
          </a>
          <a
            href="#match"
            aria-current={page === 'match' ? 'page' : undefined}
            onClick={() => navigate('match')}
          >
            Match chords
          </a>
        </nav>
        <ThemeToggle />
      </header>
      <main id="main-content" tabIndex={-1}>
        <h1 className="sr-only">
          {page === 'match'
            ? 'Match your chords'
            : `${pretty(root)} ${title} guitar reference`}
        </h1>
        <div className="workspace-tools">
          <button
            className="practice-toggle"
            aria-pressed={practice}
            onClick={() => {
              setPractice(!practice);
              requestAnimationFrame(() =>
                window.scrollTo({ top: 0, behavior: 'instant' }),
              );
            }}
          >
            <PanelTopClose size={16} aria-hidden="true" /> Practice view
          </button>
        </div>
        <div hidden={page !== 'match'}>
          <MatchChords onExplore={openMatch} />
        </div>
        <div hidden={page !== 'explore'}>
          {kind === 'chords' && (
            <div className="context-banner chord-return">
              <button id="return-to-scale" onClick={returnToScale}>
                <ArrowLeft size={15} /> Back to {pretty(scaleRoot)} {scale.name}
              </button>
            </div>
          )}
          {kind === 'scales' && context.length > 0 && (
            <div className="context-banner">
              <button onClick={returnToMatch}>
                <ArrowLeft size={15} /> Back to your chords
              </button>
              <span>{context.map((c) => pretty(c.symbol)).join(' → ')}</span>
              <button
                onClick={() => {
                  setContext([]);
                  setLocalChoice(null);
                }}
              >
                Clear context
              </button>
            </div>
          )}
          <section
            className="explorer-panel"
            aria-label="Guitar reference explorer"
          >
            <div className="reference-water">
              <UnderwaterScene />
              <div
                className="reference-tabs"
                role="group"
                aria-label="Reference type"
              >
                <button
                  aria-pressed={kind === 'scales'}
                  onClick={returnToScale}
                >
                  Scales & modes
                </button>
                <button
                  aria-pressed={kind === 'chords'}
                  onClick={() => {
                    if (kind === 'chords') return;
                    setKind('chords');
                    returnPoint.current = null;
                    setVoicingBass('all');
                    setVoicingIndex(
                      matchingVoicingIndex(
                        voicings(chordRoot, quality),
                        {
                          bass: 'all',
                          strings: voicingStrings,
                          nearFret: voicingNearFret,
                        },
                        0,
                      ),
                    );
                    setChordView('shape');
                  }}
                >
                  Chords
                </button>
              </div>
              <div className="selection-overview">
                <div className="selection-bar">
                  <label
                    htmlFor="explore-root"
                    className={`root-select ${root.length > 2 ? 'extended-root' : ''}`}
                  >
                    <span className="sr-only">Root note</span>
                    <MusicSelect
                      id="explore-root"
                      label="Root note"
                      value={root}
                      onValueChange={(value) => choose(value, scaleId)}
                      options={(!ROOTS.includes(root)
                        ? [root, ...ROOTS]
                        : ROOTS
                      ).map((r) => ({ value: r, label: pretty(r) }))}
                    />
                  </label>
                  <label
                    htmlFor="explore-type"
                    className={`scale-select ${title.length > 11 ? 'long-title' : ''}`}
                  >
                    <span className="sr-only">
                      {kind === 'scales' ? 'Scale / mode' : 'Chord quality'}
                    </span>
                    <MusicSelect
                      key={kind}
                      id="explore-type"
                      searchable
                      searchKind={kind === 'scales' ? 'scale' : 'quality'}
                      label={
                        kind === 'scales' ? 'Scale / mode' : 'Chord quality'
                      }
                      value={kind === 'scales' ? scaleId : qualityId}
                      onValueChange={(value) => {
                        if (kind === 'scales') choose(root, value);
                        else {
                          const nextQuality = QUALITIES.find(
                            (q) => q.id === value,
                          )!;
                          setQualityId(value);
                          setVoicingBass('all');
                          setVoicingIndex(
                            matchingVoicingIndex(
                              voicings(root, nextQuality),
                              {
                                bass: 'all',
                                strings: voicingStrings,
                                nearFret: voicingNearFret,
                              },
                              0,
                            ),
                          );
                        }
                      }}
                      options={
                        kind === 'scales'
                          ? SCALES.map((s) => ({
                              value: s.id,
                              label: s.name,
                              group: s.family,
                            }))
                          : QUALITIES.map((q) => ({
                              value: q.id,
                              label: q.name,
                              group: qualityGroup(q),
                            }))
                      }
                    />
                  </label>
                </div>
                <p className="scale-caption">
                  {kind === 'scales'
                    ? scale.description.split('.')[0] + '.'
                    : selectedVoicing
                      ? 'One shape at a time. Find your next voicing.'
                      : 'Every chord tone, across the neck.'}
                </p>
                {kind === 'chords' && (
                  <p className="formula-label">Full chord formula</p>
                )}
                <div
                  className="note-palette"
                  aria-label={
                    kind === 'scales' ? 'Scale notes' : 'Full chord formula'
                  }
                >
                  {notes.map((n) => {
                    const played = selectedVoicing?.soundedNotes.some(
                      (note) => note.pc === n.pc,
                    );
                    return (
                      <div
                        key={n.degree}
                        className={`palette-note ${n.degree === '1' ? 'root-palette' : ''} ${selectedVoicing ? (played ? 'formula-played' : 'formula-omitted') : ''}`}
                      >
                        <span title={noteDescription(n)}>
                          {pretty(readableNoteName(n))}
                        </span>
                        <small>{pretty(n.degree)}</small>
                        {selectedVoicing && (
                          <span className="formula-state">
                            {played ? 'played' : 'omitted'}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <NoteSpelling key={`${kind}:${root}:${title}`} notes={notes} />
              </div>
            </div>
            {kind === 'scales' && currentChord && (
              <div
                className="chord-targets"
                role="group"
                aria-label="Highlight chord tones"
              >
                {localChoice !== null && context[localChoice] && (
                  <p className="local-choice-note">
                    Local choice for {pretty(context[localChoice].symbol)}.
                    Check each chord for notes outside this palette.
                  </p>
                )}
                <p className="chord-landing-help">
                  Pick a chord to highlight its notes. Try landing on one as
                  that chord plays.
                </p>
                <span>Chord tones</span>
                {context.map((c, i) => (
                  <button
                    key={i}
                    aria-pressed={i === activeChord}
                    onClick={() => setActiveChord(i)}
                  >
                    {pretty(c.symbol)}
                  </button>
                ))}
                <span className="target-description">
                  {currentChord.notes.map(noteDescription).join(' · ')}
                  {currentChord.bass && ` / Bass ${pretty(currentChord.bass)}`}
                </span>
                <div className="outside-palette">
                  {outside.length > 0 && (
                    <span>
                      Outside this palette:{' '}
                      {outside.map(noteDescription).join(', ')}.
                    </span>
                  )}
                  <button
                    id="context-chord-preview"
                    onClick={() =>
                      openChord(
                        currentChord.root,
                        currentChord.quality.id,
                        contextVoicingBass,
                      )
                    }
                  >
                    See{' '}
                    {pretty(
                      currentChord.root +
                        currentChord.quality.symbol +
                        (contextVoicingBass ? `/${contextVoicingBass}` : ''),
                    )}{' '}
                    chord shapes <ArrowUpRight size={14} />
                  </button>
                  {currentChord.bass && !contextVoicingBass && (
                    <span className="muted">
                      No {pretty(currentChord.symbol)} shape in this library.
                    </span>
                  )}
                </div>
              </div>
            )}
            {!practice && voicingBrowser}
            <Fretboard
              controls={instrumentControls}
              controlsAbove={practice}
              notes={selectedVoicing?.soundedNotes ?? notes}
              root={`${pretty(root)} ${title}`}
              pattern={shape}
              availablePatterns={shapes}
              onPatternSelect={(index) => {
                setPosition(index);
                setView('pattern');
              }}
              onPatternFollow={setPosition}
              onNeckProgress={rememberNeckProgress}
              activePatternIndex={position}
              voicing={selectedVoicing}
              scope={kind === 'scales' ? 'scale' : 'chord'}
              degrees={degrees}
              left={left}
              targets={
                kind === 'scales' ? soundingNotes.map((note) => note.pc) : []
              }
              noteLabel={kind === 'scales' ? 'Scale note' : 'Chord note'}
            />
            {practice && voicingBrowser}
          </section>
          {kind === 'chords' && (
            <p className="voicing-hint">
              {selectedVoicing
                ? '× mute · ○ open. Compact shapes use adjacent strings; full grips may need a barre. Markers show frets, not finger assignments.'
                : !chordVoicings.length
                  ? 'No shape in this library. Showing every chord-tone location.'
                  : 'Choose Chord shapes for a playable fingering.'}
            </p>
          )}
          {kind === 'scales' && (
            <details
              className="theory-details reference-guide"
              open={theoryOpen}
              onToggle={(event) => setTheoryOpen(event.currentTarget.open)}
            >
              <summary>
                <BookOpen size={20} aria-hidden="true" />
                <span className="guide-summary-text">
                  <span>Chords & scale notes</span>
                  <small>
                    {pretty(root)} {scale.name} · {notes.length} notes
                  </small>
                </span>
                <ChevronDown
                  className="disclosure-chevron"
                  size={18}
                  aria-hidden="true"
                />
              </summary>
              <div className="theory-content">
                <div className="scale-story">
                  <span className="reference-eyebrow">The sound</span>
                  <h2>
                    {pretty(root)} {scale.name}
                  </h2>
                  <p>{scale.description}</p>
                  <div className="listening-note">
                    <Music2 size={17} aria-hidden="true" />
                    <div>
                      <span className="reference-eyebrow">Listen for it</span>
                      <p>
                        {scale.color} Start and finish a short phrase on{' '}
                        {pretty(root)} to hear it as home.
                      </p>
                    </div>
                  </div>
                  <p className="muted">
                    The small numbers under each note show its degree relative
                    to {pretty(root)}.
                  </p>
                  {![5, 7].includes(notes.length) && (
                    <p className="muted">
                      Practice patterns are available for five- and seven-note
                      scales. Use the full-neck map for this {notes.length}-note
                      scale.
                    </p>
                  )}
                </div>
                {related.length > 0 && (
                  <section className="related-chords">
                    <span className="reference-eyebrow">The harmony</span>
                    <h3>Chords in this scale</h3>
                    <p className="chord-explainer">
                      Choose a triad to explore its shapes.
                    </p>
                    <div className="harmony-row">
                      {related.map((chord, i) => (
                        <button
                          key={i}
                          id={`scale-chord-${i}`}
                          onClick={() => openChord(chord.root, chord.qualityId)}
                        >
                          <small>
                            {pretty(scale.formula[i].replace(/\d+/, ''))}
                            {['minor', 'dim'].includes(chord.qualityId)
                              ? ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'][i]
                              : ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][i]}
                            {chord.qualityId === 'dim'
                              ? '°'
                              : chord.qualityId === 'aug'
                                ? '+'
                                : ''}
                          </small>
                          <strong>{pretty(chord.symbol)}</strong>
                          <ArrowUpRight size={15} aria-hidden="true" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </details>
          )}
        </div>
        <footer>Find your next note.</footer>
      </main>
    </div>
  );
}
