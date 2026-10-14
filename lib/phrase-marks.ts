/** Fretboard marks for one phrase. Kept separate so the neck can render them without loading the generator. */
export type PhraseFretMark = {
  string: number;
  fret: number;
  finger: number;
  shift: boolean;
  label: string;
  degree: string;
  current: boolean;
};

type PlayheadListener = (slot: string | null) => void;

let playheadSlot: string | null = null;
const playheadListeners = new Set<PlayheadListener>();

/** The fret cell that should wear the playing-note outline, or null. */
export function phrasePlayheadSlot(): string | null {
  return playheadSlot;
}

/**
 * The tab publishes the sounding fret. Listeners paint it without a
 * React render of the neck.
 */
export function publishPhrasePlayhead(slot: string | null): void {
  playheadSlot = slot;
  for (const listener of playheadListeners) listener(slot);
}

export function subscribePhrasePlayhead(
  listener: PlayheadListener,
): () => void {
  playheadListeners.add(listener);
  listener(playheadSlot);
  return () => {
    playheadListeners.delete(listener);
  };
}
