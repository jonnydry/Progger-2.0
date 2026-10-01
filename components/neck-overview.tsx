'use client';

import { useRef, type KeyboardEvent } from 'react';
import { mod, TUNING, type Note } from '@/lib/music';
import type { formLayers } from '@/lib/connected-neck';

/** A navigation map: the full musical data stays at frets 0–24. */
export function NeckOverview({
  id,
  notes,
  left,
  layers,
  range,
  offset,
  windowWidth,
  onNavigate,
  onKeyDown,
}: {
  id: string;
  notes: Note[];
  left: boolean;
  layers?: ReturnType<typeof formLayers>;
  range: number[];
  offset: number;
  windowWidth: number;
  onNavigate: (fret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}) {
  const grabOffset = useRef(0);
  const pitches = new Map(notes.map((note) => [note.pc, note]));
  const navigate = (x: number, element: HTMLDivElement) => {
    const rect = element.getBoundingClientRect();
    const physical = Math.max(
      0,
      Math.min(
        24,
        ((x - rect.left) / rect.width - grabOffset.current) * 25 - 0.5,
      ),
    );
    onNavigate(left ? 24 - physical : physical);
  };
  return (
    <section id={id} className="neck-overview" aria-label="Whole-neck overview">
      <div className="overview-heading">
        <strong>The whole connection</strong>
        <span>Click or drag to travel · arrows to move</span>
      </div>
      {/* oxlint-disable jsx-a11y/prefer-tag-over-role -- This graphical map uses a viewport band rather than a range thumb; it exposes the full slider keyboard/value contract. */}
      <div
        className="overview-map"
        role="slider"
        tabIndex={0}
        aria-label="Whole-neck overview position"
        aria-orientation="horizontal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(
          (offset / Math.max(0.001, 1 - windowWidth)) * 100,
        )}
        aria-valuetext={`Visible frets ${range[0]} through ${range[1]} of 24`}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.focus({ preventScroll: true });
          event.currentTarget.setPointerCapture(event.pointerId);
          const rect = event.currentTarget.getBoundingClientRect();
          const point = (event.clientX - rect.left) / rect.width;
          const inside = point >= offset && point <= offset + windowWidth;
          grabOffset.current = inside ? point - (offset + windowWidth / 2) : 0;
          if (!inside) navigate(event.clientX, event.currentTarget);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            navigate(event.clientX, event.currentTarget);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
      >
        <div className="overview-notes" aria-hidden="true">
          {Array.from({ length: 25 }, (_, index) => {
            const fret = left ? 24 - index : index;
            return (
              <div className="overview-fret" key={fret}>
                {[5, 4, 3, 2, 1, 0].map((string) => {
                  const note = pitches.get(mod(TUNING[string] + fret));
                  const key = `${string}:${fret}`;
                  const member = layers?.shared.has(key)
                    ? 'shared'
                    : layers?.active.has(key)
                      ? 'active'
                      : layers?.neighbor.has(key)
                        ? 'neighbor'
                        : 'context';
                  return (
                    <span key={string}>
                      {note && (
                        <i
                          className={`${layers ? `overview-${member}` : 'overview-active'} ${note.degree === '1' ? 'overview-root' : ''}`}
                        />
                      )}
                    </span>
                  );
                })}
              </div>
            );
          })}
          <div
            className="overview-window"
            style={{ left: `${offset * 100}%`, width: `${windowWidth * 100}%` }}
          />
        </div>
      </div>
      {/* oxlint-enable jsx-a11y/prefer-tag-over-role */}
      <div className="overview-ruler" aria-hidden="true">
        <span>{left ? 24 : 'Open'}</span>
        <span>12</span>
        <span>{left ? 'Open' : 24}</span>
      </div>
    </section>
  );
}
