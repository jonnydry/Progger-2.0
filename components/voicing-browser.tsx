'use client';

import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { pretty } from '@/lib/music';
import type { Voicing } from '@/lib/harmony';
import { VoicingAudition } from './voicing-audition';

export function VoicingBrowser({
  voicings,
  index,
  bassFilter,
  symbol,
  active,
  onSelect,
  onBassChange,
}: {
  voicings: Voicing[];
  index: number;
  bassFilter: string;
  symbol: string;
  active: boolean;
  onSelect: (index: number) => void;
  onBassChange: (bass: string) => void;
}) {
  const catalog = useRef<HTMLDetailsElement>(null);
  const catalogSummary = useRef<HTMLElement>(null);
  const current = voicings[index];
  if (!current) return null;
  const choices = voicings
    .map((voicing, originalIndex) => ({ voicing, originalIndex }))
    .filter(
      ({ voicing }) =>
        bassFilter === 'all' || String(voicing.bass.pc) === bassFilter,
    );
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
            onClick={() => onBassChange(String(bass.pc))}
          >
            {pretty(bass.name)}{' '}
            <span>· {bass.degree === '1' ? 'root' : pretty(bass.degree)}</span>
          </button>
        ))}
      </fieldset>
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
                ? `${pretty(current.bass.name)} in bass`
                : current.inversion.replace(/^[b#]+\d+/, pretty)}
            </span>
            {current.rootless && (
              <small className="voicing-badge">Rootless</small>
            )}
          </strong>
          <span>
            {current.name} · {rangeLabel(current)} · {position + 1} of{' '}
            {choices.length}
          </span>
          {current.omittedNotes.length > 0 && (
            <span className="voicing-omissions">
              Omitted:{' '}
              {current.omittedNotes
                .map(
                  (note) =>
                    `${pretty(note.name)} (${note.degree === '1' ? 'root' : pretty(note.degree)})`,
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
          <>{pretty(current.bass.name)} is the lowest sounding note.</>
        )}
        {current.omittedNotes.length > 0 && (
          <>
            {' '}
            Played:{' '}
            {current.soundedNotes.map((note) => pretty(note.name)).join(' · ')}.
          </>
        )}
        {current.rootless && <> The root is implied.</>}
      </p>
      <details className="voicing-catalog" ref={catalog}>
        <summary ref={catalogSummary}>Browse {choices.length} shapes</summary>
        <fieldset className="voicing-list" aria-label="Available voicings">
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
                {pretty(voicing.bass.name)} bass · {rangeLabel(voicing)}
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
        </fieldset>
      </details>
    </section>
  );
}
