'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { pretty } from '@/lib/music';
import { readableNoteName, noteDescription } from '@/lib/note-presentation';
import type { Voicing } from '@/lib/harmony';
import {
  browseVoicings,
  matchingShapesLabel,
  stringSetLabel,
  voicingStringSets,
} from '@/lib/voicing-navigation';
import { VoicingAudition } from './voicing-audition';
import { MusicSelect } from './music-select';
import '@/app/voicing-navigation.css';

export function VoicingBrowser({
  voicings,
  index,
  bassFilter,
  nearFret,
  strings,
  symbol,
  active,
  onSelect,
  onBassChange,
  onNearFretChange,
  onStringsChange,
  onReset,
}: {
  voicings: Voicing[];
  index: number;
  bassFilter: string;
  nearFret: number | null;
  strings: string;
  symbol: string;
  active: boolean;
  onSelect: (index: number) => void;
  onBassChange: (bass: string) => void;
  onNearFretChange: (fret: number | null) => void;
  onStringsChange: (strings: string) => void;
  onReset: () => void;
}) {
  const catalog = useRef<HTMLDetailsElement>(null);
  const catalogSummary = useRef<HTMLElement>(null);
  const current = voicings[index];
  if (!current) return null;
  const choices = browseVoicings(voicings, {
    bass: bassFilter,
    strings,
    nearFret,
  });
  const stringSets = voicingStringSets(voicings);
  // A retained filter can have no shapes for the next chord. Keep its label
  // visible and offer recovery instead of silently changing the selection.
  if (strings !== 'all' && !stringSets.includes(strings))
    stringSets.push(strings);
  const position = choices.findIndex(
    ({ originalIndex }) => originalIndex === index,
  );
  const basses = [
    ...new Map(
      voicings.map((voicing) => [voicing.bass.pc, voicing.bass]),
    ).values(),
  ];
  const bassOrder = [
    '1',
    '2',
    'b3',
    '3',
    '4',
    'b5',
    '5',
    '#5',
    '6',
    'bb7',
    'b7',
    '7',
    'b9',
    '9',
    '#9',
    '11',
    '#11',
    'b13',
    '13',
  ];
  basses.sort(
    (a, b) => bassOrder.indexOf(a.degree) - bassOrder.indexOf(b.degree),
  );
  const rangeLabel = (voicing: Voicing) =>
    voicing.max === 0
      ? 'Open strings'
      : voicing.min === 0
        ? `Open–${voicing.max}`
        : voicing.min === voicing.max
          ? `Fret ${voicing.min}`
          : `Frets ${voicing.min}–${voicing.max}`;
  const chordName = pretty(
    symbol +
      (current.rootless || current.omittedNotes.length > 0
        ? ''
        : current.bass.degree === '1'
          ? ''
          : `/${current.bass.name}`),
  );

  return (
    <section className="voicing-browser" aria-label="Voicings and inversions">
      <fieldset className="voicing-bass-row" aria-label="Filter by bass note">
        <span className="voicing-filter-label">Bass note</span>
        <button
          type="button"
          aria-pressed={bassFilter === 'all'}
          onClick={() => onBassChange('all')}
        >
          Any
        </button>
        {basses.map((bass) => (
          <button
            key={bass.pc}
            type="button"
            aria-pressed={bassFilter === String(bass.pc)}
            title={noteDescription(bass)}
            onClick={() => onBassChange(String(bass.pc))}
          >
            {pretty(readableNoteName(bass))}{' '}
            <span>· {bass.degree === '1' ? 'root' : pretty(bass.degree)}</span>
          </button>
        ))}
      </fieldset>
      <div className="voicing-refinements">
        <label className="voicing-refinement" htmlFor="voicing-near-fret">
          <span>Near fret</span>
          <MusicSelect
            id="voicing-near-fret"
            label="Order voicings near fret"
            value={nearFret === null ? 'any' : String(nearFret)}
            onValueChange={(value) =>
              onNearFretChange(value === 'any' ? null : Number(value))
            }
            options={[
              { value: 'any', label: 'Any position' },
              ...Array.from({ length: 25 }, (_, fret) => ({
                value: String(fret),
                label: fret === 0 ? '0 (nut)' : String(fret),
              })),
            ]}
          />
        </label>
        <label className="voicing-refinement" htmlFor="voicing-strings">
          <span>Sounding strings · low to high</span>
          <MusicSelect
            id="voicing-strings"
            label="Filter by sounding strings, low to high"
            value={strings}
            onValueChange={onStringsChange}
            options={[
              { value: 'all', label: 'Any strings' },
              ...stringSets.map((value) => ({
                value,
                label: stringSetLabel(value),
              })),
            ]}
          />
        </label>
        {choices.length > 0 &&
          (position < 0 || (nearFret !== null && position !== 0)) && (
            <button
              type="button"
              className="voicing-filter-action"
              onClick={() => onSelect(choices[0].originalIndex)}
            >
              {nearFret === null ? 'Show first match' : 'Show nearest'}
            </button>
          )}
        {(strings !== 'all' || bassFilter !== 'all' || nearFret !== null) && (
          <button
            type="button"
            className="voicing-filter-action"
            onClick={onReset}
          >
            Reset browsing
          </button>
        )}
      </div>
      {position < 0 && (
        <output className="voicing-filter-notice">
          {choices.length === 0
            ? 'No shapes match these bass and string filters. Reset browsing to see all shapes.'
            : `${matchingShapesLabel(choices.length)}. Your current shape is outside these filters.`}{' '}
          The displayed shape stays selected until you choose another.
        </output>
      )}
      <div className="voicing-stepper">
        <button
          type="button"
          className="icon-button"
          aria-label="Previous voicing"
          disabled={position <= 0}
          onClick={() => onSelect(choices[position - 1].originalIndex)}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="voicing-current" aria-live="polite" aria-atomic="true">
          <strong>
            {chordName}{' '}
            <span>
              ·{' '}
              {current.omittedNotes.length > 0
                ? `${pretty(readableNoteName(current.bass))} in bass`
                : current.inversion.replace(/^[b#]+\d+/, pretty)}
            </span>
            {current.rootless && (
              <small className="voicing-badge">Rootless</small>
            )}
          </strong>
          <span>
            {current.name} · {rangeLabel(current)}
            {position >= 0 && (
              <>
                {' '}
                · {position + 1} of {choices.length}
              </>
            )}
          </span>
          {current.omittedNotes.length > 0 && (
            <span className="voicing-omissions">
              Omitted:{' '}
              {current.omittedNotes
                .map(
                  (note) =>
                    `${noteDescription(note)} (${note.degree === '1' ? 'root' : pretty(note.degree)})`,
                )
                .join(' · ')}
            </span>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Next voicing"
          disabled={position < 0 || position >= choices.length - 1}
          onClick={() => onSelect(choices[position + 1].originalIndex)}
        >
          <ArrowRight size={18} />
        </button>
      </div>
      <VoicingAudition
        key={`${symbol}:${current.frets.join(',')}`}
        frets={current.frets}
        active={active}
      />
      <p className="voicing-explanation">
        {current.omittedNotes.length === 0 && (
          <>{noteDescription(current.bass)} is the lowest sounding note.</>
        )}
        {current.omittedNotes.length > 0 && (
          <> Played: {current.soundedNotes.map(noteDescription).join(' · ')}.</>
        )}
        {current.rootless && <> The root is implied.</>}
      </p>
      {choices.length > 0 && (
        <details className="voicing-catalog" ref={catalog}>
          <summary ref={catalogSummary}>
            Browse {choices.length} shapes
            {nearFret !== null && (
              <span className="voicing-catalog-order">
                {' '}
                · nearest fret {nearFret} first
              </span>
            )}
          </summary>
          <fieldset className="voicing-list" aria-label="Available voicings">
            <div className="voicing-list-grid">
              {choices.map(({ voicing, originalIndex }) => (
                <button
                  type="button"
                  key={voicing.frets.join(',')}
                  aria-pressed={index === originalIndex}
                  onClick={() => {
                    onSelect(originalIndex);
                    if (catalog.current) catalog.current.open = false;
                    catalogSummary.current?.focus();
                  }}
                >
                  <span>
                    {voicing.name}
                    {voicing.rootless && (
                      <small className="voicing-badge">Rootless</small>
                    )}
                  </span>
                  <span>
                    {pretty(readableNoteName(voicing.bass))} bass ·{' '}
                    {rangeLabel(voicing)}
                  </span>
                  {voicing.omittedNotes.length > 0 && (
                    <span className="voicing-list-omissions">
                      Omit{' '}
                      {voicing.omittedNotes
                        .map((note) => pretty(note.degree))
                        .join(', ')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>
        </details>
      )}
    </section>
  );
}
