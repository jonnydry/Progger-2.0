'use client';
import { useMemo, useRef, useState } from 'react';
import { ArrowRight, Music2 } from 'lucide-react';
import { MatchEntry } from '@/components/match-entry';
import { NoteSpelling } from '@/components/note-spelling';
import { readableNoteName, noteDescription } from '@/lib/note-presentation';
import { comparePalette } from '@/lib/palette-comparison';
import './match-comparison.css';
import { SCALES, pretty } from '@/lib/music';
import {
  colorChoices,
  matchScales,
  parseProgression,
  perChordChoices,
  type Candidate,
  type Chord,
  type MatchGroup,
} from '@/lib/harmony';

const catalogFamilies = [...new Set(SCALES.map((scale) => scale.family))];

export function MatchChords({
  onExplore,
}: {
  onExplore: (
    candidate: Candidate,
    chords: Chord[],
    activeChordIndex?: number,
  ) => void;
}) {
  const [text, setText] = useState(''),
    [home, setHome] = useState('');
  const resultsTitle = useRef<HTMLHeadingElement>(null);
  const [showAll, setShowAll] = useState(false);
  const [homeFromStarter, setHomeFromStarter] = useState(false);
  const parsed = useMemo(() => parseProgression(text), [text]);
  const groups = useMemo(
    () => (parsed.errors.length ? [] : matchScales(parsed.chords, home)),
    [parsed, home],
  );
  const colors = useMemo(
    () => (parsed.errors.length ? [] : colorChoices(parsed.chords, home)),
    [parsed, home],
  );
  const localChoices = useMemo(
    () => (parsed.errors.length ? [] : parsed.chords.map(perChordChoices)),
    [parsed],
  );
  const valid = parsed.errors.length === 0;
  const comparisonReference = groups[0]?.candidates[0];
  const setProgression = (value: string) => {
    setText(value);
    setShowAll(false);
    if (homeFromStarter) {
      setHome('');
      setHomeFromStarter(false);
    }
  };
  const seeMatches = () => {
    // Example selection commits before we move focus to its new results.
    requestAnimationFrame(() => {
      resultsTitle.current?.focus({ preventScroll: true });
      resultsTitle.current?.scrollIntoView({ block: 'start' });
    });
  };
  function renderGroup(group: MatchGroup, index: number) {
    const best = group.candidates[0];
    const comparison = comparePalette(best, parsed.chords, comparisonReference);
    const difference = comparison.difference;
    const referenceName = comparisonReference
      ? `${pretty(comparisonReference.root)} ${comparisonReference.scale.name}`
      : '';
    const changes = difference
      ? difference.added.length === 1 && difference.removed.length === 1
        ? `${noteDescription(difference.removed[0])} → ${noteDescription(difference.added[0])}`
        : [
            difference.added.length
              ? `Adds ${difference.added.map(noteDescription).join(', ')}`
              : '',
            difference.removed.length
              ? `Leaves out ${difference.removed.map(noteDescription).join(', ')}`
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
      : '';
    return (
      <article
        key={group.key}
        className={`match-card ${index === 0 ? 'starting-match' : ''}`}
      >
        <div className="match-card-top">
          <span className="match-badge">
            {index === 0 ? 'A starting point' : 'Another direction'}
          </span>
          <span className="muted">{best.notes.length} notes</span>
        </div>
        <h3>
          {pretty(best.root)} {best.scale.name}
        </h3>
        <p>{best.reason}</p>
        <div className="match-scale-notes" aria-label="Notes to try">
          {best.notes.map((note) => (
            <span
              key={note.degree}
              title={noteDescription(note)}
              data-root={note.degree === '1'}
            >
              {pretty(readableNoteName(note))}
            </span>
          ))}
        </div>
        <div className="match-play-row">
          <button
            className="show-neck"
            onClick={() => onExplore(best, parsed.chords)}
          >
            Try on the fretboard <ArrowRight size={17} aria-hidden="true" />
          </button>
          {index === 0 && (
            <p>
              Start with two or three notes.
              <br />
              Leave a little space. Make a phrase.
            </p>
          )}
        </div>
        <details className="match-explanation">
          <summary>Why these notes?</summary>
          <p>
            This scale contains all the notes from your chords. As the chords
            change, try landing on a note from the chord you’re playing over.
          </p>
          <div className="match-note-roles">
            {[
              {
                label: 'From your chords',
                role: 'chord',
                notes: comparison.chordTones,
              },
              {
                label: 'Extra melody notes',
                role: 'melody',
                notes: comparison.melodicNotes,
              },
            ].map(({ label, role, notes }) => (
              <div className="match-note-row" data-role={role} key={role}>
                <span className="match-note-role">{label}</span>
                {notes.length ? (
                  <div className="match-notes">
                    {notes.map((note) => (
                      <span key={note.pc} title={noteDescription(note)}>
                        {pretty(readableNoteName(note))}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="palette-no-extra">
                    No extra notes in this collection.
                  </p>
                )}
              </div>
            ))}
          </div>
          <p>
            Extra notes add melodic possibilities. Their effect depends on the
            chord, timing, and phrasing. This is a place to explore, not a
            confirmed key.
          </p>
          {comparisonReference && groups.length > 1 && (
            <p className="palette-difference">
              {best === comparisonReference ? (
                <>
                  <span>Compare other choices with</span>
                  <strong>{referenceName}</strong>
                </>
              ) : (
                <>
                  <span>Compared with {referenceName}</span>
                  <strong>
                    {changes || 'Same pitches; a different reference root.'}
                  </strong>
                </>
              )}
            </p>
          )}
          <NoteSpelling
            key={`${best.root}:${best.scale.id}`}
            notes={best.notes}
          />
        </details>
        {group.candidates.length > 1 && (
          <details className="alternate-modes">
            <summary>
              {group.candidates.length - 1} other{' '}
              {group.candidates.length === 2 ? 'name' : 'names'} for this note
              collection
            </summary>
            <p>
              Same notes, different home note. Choose a name to see its roots
              and degrees.
            </p>
            {group.candidates.slice(1).map((c) => (
              <button
                key={c.root + c.scale.id}
                onClick={() => onExplore(c, parsed.chords)}
              >
                {pretty(c.root)} {c.scale.name}
                <ArrowRight size={14} />
              </button>
            ))}
          </details>
        )}
      </article>
    );
  }
  return (
    <div className="match-workspace">
      <MatchEntry
        text={text}
        home={home}
        chords={parsed.chords}
        errors={parsed.errors}
        onTextChange={setProgression}
        onHomeChange={(value) => {
          setHome(value);
          setHomeFromStarter(false);
        }}
        onChooseStarter={(chords, starterHome) => {
          setText(chords);
          setHome(starterHome);
          setHomeFromStarter(true);
          setShowAll(false);
          seeMatches();
        }}
        onSeeMatches={seeMatches}
      />
      <section className="match-results" aria-labelledby="results-title">
        <div className="results-heading">
          <h2 id="results-title" ref={resultsTitle} tabIndex={-1}>
            Scales to try
          </h2>
          <p>
            Find a sound that catches your ear, then take it to the fretboard.
            Your chords come along with you.
          </p>
        </div>
        {!valid ? (
          <div className="result-empty">
            <Music2 size={24} aria-hidden="true" />
            <h3>
              {text.trim()
                ? 'Let’s get your chords in place.'
                : 'No need to know the key.'}
            </h3>
            <p>
              {text.trim()
                ? 'Check the chord names above. Your entry is still there to edit.'
                : 'Bring the chords you know, or try an example above. We’ll help you find a place to start.'}
            </p>
          </div>
        ) : (
          <>
            <div className="result-count" role="status">
              {groups.length > 0
                ? `${groups.length} ${groups.length === 1 ? 'collection contains' : 'different collections contain'} all your chord tones`
                : colors.length > 0
                  ? 'Explore color or follow the individual chords below'
                  : 'Explore the individual chords below'}
              <span>
                {' '}
                ·{' '}
                {parsed.chords.map((chord) => pretty(chord.symbol)).join(' → ')}
              </span>
            </div>
            {groups.length > 0 ? (
              <>
                <div className="match-grid">
                  {(showAll ? groups : groups.slice(0, 3)).map(renderGroup)}
                </div>
              </>
            ) : (
              <div className="result-empty">
                <Music2 size={24} aria-hidden="true" />
                <h3>Let the notes move with the chords.</h3>
                <p>
                  These chords reach beyond a single scale in our catalog.
                  {colors.length > 0
                    ? ' Try a color below, or explore the individual chords using their notes as landing points.'
                    : ' Explore the individual chords below, using their notes as landing points.'}
                </p>
              </div>
            )}
            {groups.length > 3 && (
              <button
                className="more-results"
                onClick={() => setShowAll(!showAll)}
              >
                {showAll
                  ? 'Show fewer collections'
                  : `Show all ${groups.length} collections`}
              </button>
            )}
            {colors.length > 0 && (
              <section className="color-options">
                <h3>
                  {groups.length
                    ? 'A little more color'
                    : 'A sound to try across your chords'}
                </h3>
                {colors.map(({ candidate, explanation }) => (
                  <article key={candidate.scale.id}>
                    <div>
                      <strong>
                        {pretty(candidate.root)} {candidate.scale.name}
                      </strong>
                      <p>{explanation}</p>
                    </div>
                    <button
                      className="show-neck"
                      onClick={() => onExplore(candidate, parsed.chords)}
                    >
                      Try on the fretboard{' '}
                      <ArrowRight size={16} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </section>
            )}
            <details
              key={groups.length === 0 ? 'local' : 'shared'}
              className="per-chord-section"
              open={groups.length === 0 ? true : undefined}
            >
              <summary>Follow each chord</summary>
              <p>
                Each choice covers this chord, not necessarily the whole
                progression. The neck keeps all your chords so you can compare
                them. You can stay with a shared scale when one is available.
              </p>
              <div className="per-chord-grid">
                {parsed.chords.map((chord, i) => (
                  <article className="per-chord" key={i}>
                    <strong>{pretty(chord.symbol)}</strong>
                    <span>
                      Chord tones:{' '}
                      {chord.notes.map(noteDescription).join(' · ')}
                    </span>
                    {chord.bass && <span>Bass: {pretty(chord.bass)}</span>}
                    {localChoices[i]?.map((c) => (
                      <button
                        key={c.scale.id}
                        onClick={() => onExplore(c, parsed.chords, i)}
                      >
                        {pretty(c.root)} {c.scale.name}
                        <ArrowRight size={13} />
                      </button>
                    ))}
                    {!localChoices[i]?.length && (
                      <p>
                        Use the chord tones as your starting point; no
                        root-centered scale in this catalog covers this chord.
                      </p>
                    )}
                  </article>
                ))}
              </div>
            </details>
            <details className="catalog-note">
              <summary>About these suggestions</summary>
              <p>
                We compare your chords with {SCALES.length} scales and modes:{' '}
                {catalogFamilies.join(', ')}. Chords are treated as equal
                length. Tonal centers are suggestions; your melody and emphasis
                matter.
              </p>
            </details>
          </>
        )}
      </section>
    </div>
  );
}
