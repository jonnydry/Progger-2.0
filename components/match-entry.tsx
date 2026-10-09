'use client';

import { useRef, useState } from 'react';
import { ArrowRight, ChevronDown, Music2, Plus, X } from 'lucide-react';
import { MusicSelect } from '@/components/music-select';
import { UnderwaterScene } from '@/components/underwater-scene';
import { Button } from '@/components/ui/button';
import { qualityGroup } from '@/lib/chord-presentation';
import { ROOTS, pretty } from '@/lib/music';
import { QUALITIES, type Chord } from '@/lib/harmony';
import { MATCH_STARTERS, PROGRESSION_PLACEHOLDER } from '@/lib/match-starters';

export function MatchEntry({
  text,
  home,
  chords,
  errors,
  onTextChange,
  onHomeChange,
  onChooseStarter,
  onSeeMatches,
}: {
  text: string;
  home: string;
  chords: Chord[];
  errors: string[];
  onTextChange: (text: string) => void;
  onHomeChange: (home: string) => void;
  onChooseStarter: (chords: string, home: string) => void;
  onSeeMatches: () => void;
}) {
  const [root, setRoot] = useState('D');
  const [quality, setQuality] = useState('minor');
  const input = useRef<HTMLTextAreaElement>(null);
  const hasInput = text.trim().length > 0;
  return (
    <section
      className="chord-entry reference-water"
      aria-labelledby="chord-entry-title"
    >
      <UnderwaterScene />
      <div className="match-welcome">
        <p className="match-eyebrow">
          <Music2 size={16} aria-hidden="true" /> A little inspiration for your
          next session
        </p>
        <h2 id="chord-entry-title">
          Your chords.
          <br />
          <span>Your next melody.</span>
        </h2>
        <p className="match-welcome-copy">
          You know a few chords. Let’s find some notes to play over them.
          <br className="welcome-break" /> Bring a song you love, or start with
          one of ours.
        </p>
        <ol className="match-journey" aria-label="How it works">
          <li>
            <span>01</span> Add your chords
          </li>
          <li>
            <span>02</span> Find notes to try
          </li>
          <li>
            <span>03</span> Make them your own
          </li>
        </ol>
      </div>
      <div className="match-start">
        <form
          className="progression-entry"
          onSubmit={(event) => {
            event.preventDefault();
            if (hasInput && errors.length === 0) onSeeMatches();
            else input.current?.focus();
          }}
        >
          <div className="progression-label-row">
            <label htmlFor="chord-progression">What are you playing?</label>
            {hasInput && (
              <button
                type="button"
                className="clear-chords"
                onClick={() => {
                  onTextChange('');
                  onHomeChange('');
                  input.current?.focus();
                }}
              >
                Clear <X size={13} aria-hidden="true" />
              </button>
            )}
          </div>
          <textarea
            ref={input}
            id="chord-progression"
            value={text}
            onChange={(event) => onTextChange(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={hasInput && errors.length > 0}
            aria-describedby="chord-input-help chord-errors"
            placeholder={PROGRESSION_PLACEHOLDER}
            rows={2}
          />
          <p className="input-help" id="chord-input-help">
            Type the chord names in the order you play them. A couple is enough
            to start.
          </p>
          {chords.length > 0 && (
            <div className="chord-tokens" aria-label="Recognized chords">
              {chords.map((chord, index) => (
                <span key={index} className="chord-token">
                  {pretty(chord.symbol)}
                </span>
              ))}
            </div>
          )}
          <output id="chord-errors" aria-live="polite">
            {hasInput &&
              [...new Set(errors)].map((error) => (
                <span className="input-error" key={error}>
                  {error}
                </span>
              ))}
          </output>
          <div className="progression-action">
            <Button type="submit" disabled={!hasInput}>
              See scales to try <ArrowRight size={17} aria-hidden="true" />
            </Button>
            <span>Suggestions update as you type.</span>
          </div>
          <div className="entry-options">
            <details className="chord-builder">
              <summary>
                <Plus size={16} aria-hidden="true" />
                <span>Help me add a chord</span>
                <ChevronDown
                  className="disclosure-chevron"
                  size={16}
                  aria-hidden="true"
                />
              </summary>
              <p className="entry-detail-help">
                Pick a note and a chord type. We’ll write the name for you.
              </p>
              <div className="builder-row">
                <label htmlFor="builder-root">
                  Root note
                  <MusicSelect
                    id="builder-root"
                    label="Chord root"
                    value={root}
                    onValueChange={setRoot}
                    options={ROOTS.map((value) => ({
                      value,
                      label: pretty(value),
                    }))}
                  />
                </label>
                <label htmlFor="builder-quality">
                  Chord type
                  <MusicSelect
                    id="builder-quality"
                    label="Chord type"
                    searchable
                    searchKind="quality"
                    value={quality}
                    onValueChange={setQuality}
                    options={QUALITIES.map((item) => ({
                      value: item.id,
                      label: item.name,
                      group: qualityGroup(item),
                    }))}
                  />
                </label>
                <Button
                  type="button"
                  onClick={() =>
                    onTextChange(
                      `${text.trim()} ${root}${QUALITIES.find((item) => item.id === quality)!.symbol}`.trim(),
                    )
                  }
                >
                  Add chord <Plus size={15} aria-hidden="true" />
                </Button>
              </div>
              <p className="entry-detail-help">
                You can also use commas or bars between chords, and slash chords
                such as D/F♯.
              </p>
            </details>
            <details className="match-options">
              <summary>
                <span>
                  Home note{' '}
                  <span className="muted">
                    · {home ? pretty(home) : 'optional'}
                  </span>
                </span>
                <ChevronDown
                  className="disclosure-chevron"
                  size={16}
                  aria-hidden="true"
                />
              </summary>
              <div className="home-note-control">
                <label htmlFor="match-home">
                  The note that feels like home
                  <MusicSelect
                    id="match-home"
                    label="Home note"
                    value={home}
                    onValueChange={onHomeChange}
                    options={[
                      { value: '', label: 'Not sure yet' },
                      ...ROOTS.map((value) => ({
                        value,
                        label: pretty(value),
                      })),
                    ]}
                  />
                </label>
                <p>
                  Not sure? Leave this open. You don’t need to know the key to
                  explore.
                </p>
              </div>
            </details>
          </div>
        </form>
        <aside className="match-starters" aria-labelledby="starter-title">
          <p className="match-eyebrow">Just exploring?</p>
          <h3 id="starter-title">Try a familiar feeling.</h3>
          <p>Pick some chords. See where they take you.</p>
          <div className="starter-list">
            {MATCH_STARTERS.map((starter) => (
              <button
                type="button"
                className="starter-choice"
                key={starter.name}
                onClick={() => {
                  onChooseStarter(starter.chords, starter.home);
                }}
              >
                <span className="starter-name">
                  {starter.name}
                  <ArrowRight size={16} aria-hidden="true" />
                </span>
                <span className="starter-chords">
                  {starter.chords.split(' ').map((chord, index) => (
                    <span key={index}>{chord}</span>
                  ))}
                </span>
                <span className="starter-description">
                  {starter.description}
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}
