const LINES: { label: string; string: number }[] = [
  { label: 'e', string: 5 },
  { label: 'B', string: 4 },
  { label: 'G', string: 3 },
  { label: 'D', string: 2 },
  { label: 'A', string: 1 },
  { label: 'E', string: 0 },
];

export type TabNote = {
  string: number;
  fret: number;
  beat: number;
};

function tempoLabel(tempo: number): string {
  const rounded = Math.round(tempo * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Eighths when every onset lands on one, sixteenths otherwise. */
function gridStep(beats: readonly number[]): number {
  const units = beats.map((beat) => Math.round(beat * 8));
  if (units.every((unit) => unit % 4 === 0)) return 0.5;
  if (units.every((unit) => unit % 2 === 0)) return 0.25;
  return 0.125;
}

function cell(fret: number | null, width: number): string {
  if (fret === null) return '-'.repeat(width);
  const text = String(fret);
  if (text.length >= width) return text.slice(0, width);
  return text + '-'.repeat(width - text.length);
}

/**
 * ASCII guitar tab for a phrase's existing string and fret choices.
 * High e is the top line. Columns follow onset, not a new fingering.
 */
export function phraseTabText(input: {
  title: string;
  tempo: number;
  notes: readonly TabNote[];
}): string {
  const notes = input.notes.filter(
    (note) => note.string >= 0 && note.string <= 5 && note.fret >= 0,
  );
  const lastBeat = notes.reduce((max, note) => Math.max(max, note.beat), 0);
  const step = notes.length ? gridStep(notes.map((note) => note.beat)) : 0.5;
  const columns = Math.max(1, Math.round(lastBeat / step) + 1);
  const barCols = Math.max(1, Math.round(4 / step));
  const beatCols = Math.max(1, Math.round(1 / step));
  const width = 3;
  const placed = LINES.map(() => Array<number | null>(columns).fill(null));
  for (const note of notes) {
    const column = Math.min(
      columns - 1,
      Math.max(0, Math.round(note.beat / step)),
    );
    const line = LINES.findIndex((entry) => entry.string === note.string);
    const row = placed[line];
    if (row) row[column] = note.fret;
  }
  const rulerParts: string[] = [];
  for (let col = 0; col < columns; col++) {
    if (col > 0 && col % barCols === 0) rulerParts.push(' ');
    if (col % beatCols === 0) {
      const beatInBar = (Math.floor(col / beatCols) % 4) + 1;
      rulerParts.push(String(beatInBar).padEnd(width, ' '));
    } else {
      rulerParts.push(' '.repeat(width));
    }
  }
  const ruler = `  ${rulerParts.join('')}`.trimEnd();
  const body = LINES.map((line, index) => {
    const row = placed[index] ?? [];
    const segments: string[] = [];
    for (let col = 0; col < columns; col++) {
      if (col > 0 && col % barCols === 0) segments.push('|');
      segments.push(cell(row[col] ?? null, width));
    }
    return `${line.label}|${segments.join('')}|`;
  }).join('\n');
  return `${input.title} · ${tempoLabel(input.tempo)} BPM\n\n${ruler}\n${body}\n`;
}
