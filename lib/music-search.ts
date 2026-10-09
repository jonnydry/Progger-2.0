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

/** Search only supplied choices; unsupported chords stay absent. */
export function matchesMusicChoice(
  choice: MusicChoice,
  query: string,
  kind?: MusicSearchKind,
): boolean {
  if (!query.trim()) return true;
  if (kind === 'quality') {
    // Parse a complete full symbol before using its quality, so C7alt cannot
    // silently become C7. This picker changes the quality, never the root.
    // "o" and "(" are whole suffixes only, so "Dom" stays a name search.
    // "Do" is D diminished and also how "dominant" begins.
    const trimmed = query.trim();
    if (
      /^[A-Ga-g][#♯b♭]{0,2}(?:maj|min|m|M|\d|[Δø°+−/-]|sus|add|dim|aug|$)/.test(
        trimmed,
      ) ||
      /^[A-Ga-g][#♯b♭]{0,2}(?:o7?|\([^)]*\))(?:\/[A-Ga-g][#♯b♭]{0,2})?$/.test(
        trimmed,
      )
    ) {
      try {
        const parsed = parseChord(trimmed).quality.id === choice.value;
        // "co" is inside the group name "Core chords", so only the dominant prefix keeps both.
        if (!/^do$/i.test(trimmed)) return parsed;
        return parsed || matchesChoiceText(choice, trimmed, kind);
      } catch {
        return false;
      }
    }
    const symbolQuery = qualitySymbolQuery(query);
    const quality = QUALITIES.find((item) => item.id === choice.value);
    if (symbolQuery !== null && quality)
      return (quality.symbol || 'maj').startsWith(symbolQuery);
  }
  return matchesChoiceText(choice, query, kind);
}
