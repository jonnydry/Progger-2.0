import { qualityGroup } from './chord-presentation.ts';
import { QUALITIES, parseChord } from './harmony.ts';

export type MusicChoice = {
  value: string;
  label: string;
  group?: string;
  description?: string;
  keywords?: string[];
};
export type MusicSearchKind = 'scale' | 'quality';

// Aliases describe existing collections; they never create or alter a formula.
const scaleAliases: Record<string, string[]> = {
  major: ['Ionian'],
  minor: ['Aeolian'],
  'melodic-minor': ['Melodic minor', 'Ascending melodic minor', 'Jazz minor'],
  'ionian-augmented': ['Ionian augmented', 'Major sharp 5'],
  'dorian-b2': ['Phrygian natural 6'],
  'lydian-dominant': ['Lydian flat 7', 'Acoustic'],
  'locrian-natural2': ['Locrian sharp 2'],
  altered: ['Super Locrian', 'Altered dominant'],
  ultralocrian: ['Super Locrian double flat 7'],
  'half-whole-diminished': ['Half whole octatonic', 'Dominant diminished'],
  'whole-half-diminished': ['Whole half octatonic'],
};

function normalizeWords(value: string): string {
  return value
    .replace(/♯/g, '#')
    .replace(/♭/g, 'b')
    .replace(/♮/g, ' natural ')
    .toLowerCase()
    .replace(/double[\s-]+flat\s*(?=\d)/g, 'bb')
    .replace(/sharp\s*(?=\d)/g, '#')
    .replace(/flat\s*(?=\d)/g, 'b')
    .replace(/[–—-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Keep case-sensitive musical shorthand (M7 vs m7) meaningful. */
function qualitySymbolQuery(query: string): string | null {
  const compact = query.trim().replace(/♯/g, '#').replace(/♭/g, 'b');
  if (
    !/^(?:(?:maj|min)(?:\d|$)|[Mm](?:\d|$)|m(?:add|\(add)|\d|[Δø°+−-]|(?:sus|add|dim|aug)(?:\d|$))/i.test(
      compact,
    )
  )
    return null;
  // Words belong to the name search, including "minor" and "major".
  if (/\s|^(?:minor|major|dominant|diminished|augmented)\b/i.test(compact))
    return null;
  return compact
    .replace(/^Δ(13|11|9|7)?/, (_, extension) => `maj${extension || '7'}`)
    .replace(/^ø7?/i, 'm7b5')
    .replace(/^°/, 'dim')
    .replace(/^maj/i, 'maj')
    .replace(/^min/i, 'm')
    .replace(/^M(?=\d|$)/, 'maj')
    .replace(/^(sus|add|dim|aug)/i, (prefix) => prefix.toLowerCase())
    .replace(/^[−-]/, 'm')
    .replace(/^\+/, 'aug')
    .replace(/[()]/g, '');
}

export function musicChoiceDescription(
  choice: MusicChoice,
  kind?: MusicSearchKind,
): string | undefined {
  if (choice.description) return choice.description;
  if (kind !== 'quality') return undefined;
  const quality = QUALITIES.find((item) => item.id === choice.value);
  return quality
    ? (quality.symbol || 'maj').replace(/#/g, '♯').replace(/b/g, '♭')
    : undefined;
}

function matchesChoiceText(
  choice: MusicChoice,
  query: string,
  kind?: MusicSearchKind,
): boolean {
  const terms = normalizeWords(query).split(' ');
  const searchable = [
    choice.label,
    choice.value,
    choice.group ?? '',
    choice.description ?? '',
    ...(choice.keywords ?? []),
    ...(kind === 'scale' ? (scaleAliases[choice.value] ?? []) : []),
  ].map(normalizeWords);
  return searchable.some((text) => terms.every((term) => text.includes(term)));
}

function nameBesideOSuffix(query: string): string | null {
  if (/^do7$/i.test(query)) return 'do 7';
  if (/^do$/i.test(query) || /^[a-g]o$/.test(query)) return query;
  return null;
}

function chordLikeQuery(query: string): string | null {
  const trimmed = query.trim();
  const chordQuery = trimmed.replace(/^([Dd])O(7)?$/, '$1o$2');
  if (
    /^[A-Ga-g][#♯b♭]{0,2}(?:maj|min|m|M|\d|[Δø°+−/-]|sus|add|dim|aug|$)/.test(
      trimmed,
    ) ||
    /^[A-Ga-g][#♯b♭]{0,2}(?:o7?|\([^)]*\))(?:\/[A-Ga-g][#♯b♭]{0,2})?$/.test(
      chordQuery,
    )
  )
    return chordQuery;
  return null;
}

/** `do 7` is the same chord word as `do7`. Other spacing is not. */
function isSpacedDo7(query: string): boolean {
  return /^do\s+7$/i.test(query.trim());
}

/** Space before a number collapses only as a fallback when the original query finds nothing, plus the `do 7` family. */
function collapseSpaceBeforeNumber(query: string): string | null {
  const trimmed = query.trim();
  if (!/\s+\d/.test(trimmed)) return null;
  const collapsed = trimmed.replace(/\s+(?=\d)/g, '');
  if (collapsed === trimmed) return null;
  // A leading digit makes qualitySymbolQuery return a prefix, including tokens
  // such as "79" that match no symbol. Collapse only when some quality symbol
  // actually starts with that prefix, or the compacted chord parses.
  const symbol = qualitySymbolQuery(collapsed);
  if (
    symbol !== null &&
    QUALITIES.some((item) => (item.symbol || 'maj').startsWith(symbol))
  )
    return collapsed;
  const chordQuery = chordLikeQuery(collapsed);
  if (chordQuery === null) return null;
  try {
    parseChord(chordQuery);
  } catch {
    return null;
  }
  return collapsed;
}

const groupedQualityChoices: MusicChoice[] = QUALITIES.map((quality) => ({
  value: quality.id,
  label: quality.name,
  group: qualityGroup(quality),
}));
// The memo stores a boolean, not a choice list. A hit is that same boolean,
// so it equals a fresh lookup and callers cannot mutate the stored entry.
export const qualityHitCacheLimit = 256;
const qualityHitCache = new Map<string, boolean>();

export function qualityHitCacheSize(): number {
  return qualityHitCache.size;
}

export function clearQualityHitCache(): void {
  qualityHitCache.clear();
}

/** The quality branch as it stood before a spaced number is collapsed. */
function matchesQualityDirect(choice: MusicChoice, query: string): boolean {
  // Parse a complete full symbol before using its quality, so C7alt cannot
  // silently become C7. This picker changes the quality, never the root.
  const trimmed = query.trim();
  const chordQuery = chordLikeQuery(trimmed);
  if (chordQuery !== null) {
    try {
      const parsed = parseChord(chordQuery).quality.id === choice.value;
      const alongside = nameBesideOSuffix(trimmed);
      if (alongside === null) return parsed;
      return parsed || matchesChoiceText(choice, alongside, 'quality');
    } catch {
      return false;
    }
  }
  const symbolQuery = qualitySymbolQuery(query);
  const quality = QUALITIES.find((item) => item.id === choice.value);
  if (symbolQuery !== null && quality)
    return (quality.symbol || 'maj').startsWith(symbolQuery);
  return matchesChoiceText(choice, query, 'quality');
}

function qualityQueryHits(query: string): boolean {
  const cached = qualityHitCache.get(query);
  if (cached !== undefined) return cached;
  const hit = groupedQualityChoices.some((item) =>
    matchesQualityDirect(item, query),
  );
  if (qualityHitCache.size >= qualityHitCacheLimit) qualityHitCache.clear();
  qualityHitCache.set(query, hit);
  return hit;
}

/** Search only supplied choices; unsupported chords stay absent. */
export function matchesMusicChoice(
  choice: MusicChoice,
  query: string,
  kind?: MusicSearchKind,
): boolean {
  if (!query.trim()) return true;
  if (kind === 'quality') {
    // `do 7` already matches the dominant-7 names. It still gains dim7.
    if (isSpacedDo7(query))
      return matchesMusicChoice(
        choice,
        query.trim().replace(/\s+/g, ''),
        kind,
      );
    if (matchesQualityDirect(choice, query)) return true;
    // Collapse a space before a number only when this query matches nothing.
    const collapsed = collapseSpaceBeforeNumber(query);
    if (collapsed === null || qualityQueryHits(query)) return false;
    return matchesQualityDirect(choice, collapsed);
  }
  return matchesChoiceText(choice, query, kind);
}
