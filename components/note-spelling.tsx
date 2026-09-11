import { pretty, type Note } from '@/lib/music';
import { readableNoteName } from '@/lib/note-presentation';

/** Explain aliases without adding a notation setting to every reference. */
export function NoteSpelling({ notes }: { notes: Note[] }) {
  const aliases = notes.filter((note) => readableNoteName(note) !== note.name);
  if (!aliases.length) return null;
  return (
    <details className="note-spelling">
      <summary>Simplified note names</summary>
      <p>
        Easier names for the same frets. Degrees and chord symbols keep their
        theoretical spelling.
      </p>
      <ul>
        {aliases.map((note) => (
          <li key={note.degree}>
            {pretty(readableNoteName(note))} is written {pretty(note.name)} for
            degree {pretty(note.degree)}.
          </li>
        ))}
      </ul>
    </details>
  );
}
