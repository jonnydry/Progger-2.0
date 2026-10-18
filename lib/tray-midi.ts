/** Type-0 MIDI. One track, 480 ticks per quarter note. */
export const MIDI_DIVISION = 480;
const NOTE_ON_VELOCITY = 100;

export type MidiNote = {
  midi: number;
  beat: number;
  duration: number;
};

function vlq(value: number): number[] {
  const safe = Math.max(0, Math.floor(value));
  const bytes = [safe & 0x7f];
  let rest = safe >> 7;
  while (rest > 0) {
    bytes.unshift((rest & 0x7f) | 0x80);
    rest >>= 7;
  }
  return bytes;
}

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

type TrackEvent = {
  tick: number;
  order: number;
  data: number[];
};

/**
 * A single-track MIDI file at `tempo` quarter-notes per minute.
 * Note-ons use the stored onsets. Note-offs follow each duration.
 * At a shared tick, note-offs are written before note-ons.
 */
export function encodePhraseMidi(input: {
  tempo: number;
  notes: readonly MidiNote[];
}): Uint8Array {
  const tempo = Number.isFinite(input.tempo)
    ? Math.min(240, Math.max(40, input.tempo))
    : 96;
  const microseconds = Math.round(60_000_000 / tempo);
  const events: TrackEvent[] = [
    {
      tick: 0,
      order: 0,
      data: [
        0xff,
        0x51,
        0x03,
        (microseconds >> 16) & 0xff,
        (microseconds >> 8) & 0xff,
        microseconds & 0xff,
      ],
    },
  ];
  input.notes.forEach((note, index) => {
    const midi = Math.max(0, Math.min(127, Math.round(note.midi)));
    const on = Math.max(0, Math.round(note.beat * MIDI_DIVISION));
    const off = Math.max(
      on,
      Math.round((note.beat + note.duration) * MIDI_DIVISION),
    );
    events.push({
      tick: on,
      order: 2 + index,
      data: [0x90, midi, NOTE_ON_VELOCITY],
    });
    events.push({ tick: off, order: 1, data: [0x80, midi, 0] });
  });
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let cursor = 0;
  for (const event of events) {
    track.push(...vlq(event.tick - cursor), ...event.data);
    cursor = event.tick;
  }
  track.push(0x00, 0xff, 0x2f, 0x00);
  return Uint8Array.from([
    0x4d,
    0x54,
    0x68,
    0x64,
    0x00,
    0x00,
    0x00,
    0x06,
    0x00,
    0x00,
    0x00,
    0x01,
    (MIDI_DIVISION >> 8) & 0xff,
    MIDI_DIVISION & 0xff,
    0x4d,
    0x54,
    0x72,
    0x6b,
    ...u32(track.length),
    ...track,
  ]);
}
