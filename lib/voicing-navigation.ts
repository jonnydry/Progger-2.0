import type { Voicing } from './harmony.ts';

export type VoicingChoice = { voicing: Voicing; originalIndex: number };

export type VoicingFilters = {
  bass: string;
  strings: string;
  nearFret: number | null;
};

const STRING_NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

/** An exact set of sounding strings, in low-to-high tuning order. */
export function voicingStringSet(voicing: Pick<Voicing, 'frets'>): string {
  return voicing.frets
    .flatMap((fret, string) => (fret === null ? [] : [string]))
    .join(',');
}

export function stringSetLabel(strings: string): string {
  return strings
    .split(',')
    .map((string) => STRING_NAMES[Number(string)])
    .join(' ');
}

export function voicingStringSets(voicings: Voicing[]): string[] {
  return [...new Set(voicings.map(voicingStringSet))].sort((a, b) => {
    const aStrings = a.split(',');
    const bStrings = b.split(',');
    return (
      bStrings.length - aStrings.length ||
      Number(aStrings[0]) - Number(bStrings[0]) ||
      a.localeCompare(b)
    );
  });
}

/** Open strings do not pull a high-position grip toward fret zero. */
function positionDistance(voicing: Voicing, fret: number): [number, number] {
  const pressed = voicing.frets.filter(
    (value): value is number => value !== null && value > 0,
  );
  const min = pressed.length ? Math.min(...pressed) : 0;
  const max = pressed.length ? Math.max(...pressed) : 0;
  return [
    Math.max(min - fret, fret - max, 0),
    Math.abs((min + max) / 2 - fret),
  ];
}

/** Filtering and ordering never mutate the engine's catalog or its indices. */
export function browseVoicings(
  voicings: Voicing[],
  filters: VoicingFilters,
): VoicingChoice[] {
  const choices = voicings
    .map((voicing, originalIndex) => ({ voicing, originalIndex }))
    .filter(
      ({ voicing }) =>
        (filters.bass === 'all' || String(voicing.bass.pc) === filters.bass) &&
        (filters.strings === 'all' ||
          voicingStringSet(voicing) === filters.strings),
    );
  if (filters.nearFret === null) return choices;
  const fret = filters.nearFret;
  return choices.sort((a, b) => {
    const distanceA = positionDistance(a.voicing, fret);
    const distanceB = positionDistance(b.voicing, fret);
    return (
      distanceA[0] - distanceB[0] ||
      distanceA[1] - distanceB[1] ||
      a.originalIndex - b.originalIndex
    );
  });
}

/** One matching shape, or several matching shapes. */
export function matchingShapesLabel(count: number): string {
  return `${count} matching ${count === 1 ? 'shape' : 'shapes'}`;
}

/**
 * Keep the current shape when it passes the filters.
 * Otherwise take the first shape in browsing order.
 * An empty result keeps the current index so Reset browsing can recover it.
 */
export function matchingVoicingIndex(
  source: Voicing[],
  filters: VoicingFilters,
  index: number,
): number {
  const choices = browseVoicings(source, filters);
  const current =
    source.length > 0 ? Math.min(Math.max(index, 0), source.length - 1) : index;
  if (choices.some(({ originalIndex }) => originalIndex === current))
    return current;
  return choices[0]?.originalIndex ?? current;
}
