/**
 * Listen pack for the phrase-feel slices.
 *
 * Every side renders through the app's own playback path: `schedulePhrase`
 * (which calls `scheduleVoicing` and `dampPhraseNote`), so notes ring to the
 * next onset with the soft release and rests stay audible. The engine for
 * each side is loaded from a git worktree at that commit, so A and B really
 * are two commits rather than two copies of the same file.
 *
 * Run: node --experimental-strip-types scripts/render-feel-clips.ts <outDir> <spec.json>
 *
 * spec.json is `{ "pairs": [{ id, stem, fromTree, toTree, fromLabel,
 * toLabel, seed, root, scaleId, chord, bars, listen, changed }] }`.
 * Writes `<stem>_A.mp3` / `_B.mp3` plus `<stem>_A.txt` / `_B.txt` tab
 * readouts, and a clips.md describing each pair.
 */
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OfflineAudioContext } from 'node-web-audio-api';

type Side = 'A' | 'B';

type PairSpec = {
  id: string;
  stem: string;
  fromTree: string;
  toTree: string;
  fromLabel: string;
  toLabel: string;
  seed: number;
  root: string;
  scaleId: string;
  chord: string | null;
  bars: 2 | 4;
  listen: string;
  changed: string;
  /** Rendering tempo. Defaults to 132. */
  tempo?: number;
  /**
   * Loop passes to render. 1 is a single pass through the phrase including
   * its closing cadence, the way Loop off plays. More than 1 follows the
   * app's loop: each repeat skips the closing cadence and wraps to the
   * opening note, so the seam is audible between passes.
   */
  loopPasses?: number;
};

type Note = {
  name: string;
  midi: number;
  beat: number;
  duration: number;
  string: number;
  fret: number;
  finger: number;
  chordTone: boolean;
  degree: string;
};

type Generated = { notes: Note[]; plan: Record<string, unknown> };

const RATE = 44100;
const TAIL_SEC = 2.4;
const TEMPO = 132;
/** Straight. Amount 0 is ratio 1, the same timing as the "straight" feel. */
const SWING = 0;
const LU_CENTER = -16;
const PEAK_CEILING_DB = -1;

const outDir = process.argv[2];
const specPath = process.argv[3];
if (!outDir || !specPath) {
  throw new Error('usage: render-feel-clips.ts <outDir> <spec.json>');
}

type Engine = {
  ph: typeof import('../lib/phrase.ts');
  mu: typeof import('../lib/music.ts');
  ha: typeof import('../lib/harmony.ts');
};

async function loadEngine(tree: string): Promise<Engine> {
  return {
    ph: await import(pathToFileURL(join(tree, 'lib/phrase.ts')).href),
    mu: await import(pathToFileURL(join(tree, 'lib/music.ts')).href),
    ha: await import(pathToFileURL(join(tree, 'lib/harmony.ts')).href),
  };
}

function generate(engine: Engine, pair: PairSpec): Generated {
  const scale = engine.mu.SCALES.find(
    (item: { id: string }) => item.id === pair.scaleId,
  );
  if (!scale) throw new Error(`unknown scale ${pair.scaleId}`);
  const scaleNotes = engine.mu.spell(pair.root, scale.formula);
  const chordNotes = pair.chord
    ? engine.ha.parseChord(pair.chord).notes
    : engine.ph.defaultChordNotes(scaleNotes);
  const result = engine.ph.generatePhrase({
    seed: pair.seed,
    bars: pair.bars,
    scaleNotes,
    chordNotes,
  });
  if (!result.ok) throw new Error(`${pair.id}: ${result.reason}`);
  return {
    notes: result.phrase.notes.map((note: Note) => ({ ...note })),
    plan: result.phrase.plan,
  };
}

/**
 * The notes a render actually plays. Loop off is one pass through the phrase,
 * cadence included. With Loop on the app drops the closing cadence on *every*
 * pass -- the scheduler skips any onset at or after `loopBeats`, first pass
 * included -- and wraps to the opening note on the bar line, so the seam is
 * heard once per repeat. Laying the passes end to end on that period
 * reproduces both, and `schedulePhrase` then damps each note at the next
 * onset, including across the seam.
 */
async function loopNotes(
  notes: readonly Note[],
  loopPasses = 1,
): Promise<{ notes: Note[]; loopBeats: number; closing: number }> {
  const { phraseClosingIndex, phraseLoopBeats } =
    await import('../lib/phrase-audio.ts');
  const closing = phraseClosingIndex(notes);
  const loopBeats = phraseLoopBeats(notes);
  const looping = loopPasses > 1;
  const body =
    looping && closing >= 0
      ? notes.filter((_, index) => index !== closing)
      : [...notes];
  const passes: Note[] = [];
  for (let pass = 0; pass < Math.max(1, loopPasses); pass += 1) {
    const shift = pass * loopBeats;
    for (const note of body) passes.push({ ...note, beat: note.beat + shift });
  }
  return { notes: passes, loopBeats, closing };
}

async function render(
  notes: readonly Note[],
  tempo: number,
  loopPasses = 1,
): Promise<Float32Array> {
  const { schedulePhrase } = await import('../lib/phrase-audio.ts');
  const { notes: played } = await loopNotes(notes, loopPasses);
  const last = played.at(-1);
  const beats = last ? last.beat + last.duration : 8;
  const seconds = (beats * 60) / tempo + TAIL_SEC;
  const context = new OfflineAudioContext(1, Math.ceil(RATE * seconds), RATE);
  schedulePhrase(context, context.destination, played, tempo, SWING, 0);
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

function samplePeak(samples: Float32Array): number {
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function writeWav(path: string, samples: Float32Array, gain: number): void {
  const data = Buffer.alloc(samples.length * 2);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, (samples[index] ?? 0) * gain));
    data.writeInt16LE(Math.round(sample * 32767), index * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
}

function encodeMp3(wav: string, mp3: string): void {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      wav,
      '-codec:a',
      'libmp3lame',
      '-q:a',
      '2',
      mp3,
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr || `ffmpeg mp3 failed for ${wav}`);
  }
}

/** One gain for both sides so a loudness change cannot pass for a feel change. */
function loudness(wav: string): { lufs: number; peakDbfs: number } {
  const result = spawnSync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      wav,
      '-af',
      'ebur128=peak=true',
      '-f',
      'null',
      '-',
    ],
    { encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`ebur128 failed for ${wav}`);
  const text = result.stderr;
  const lufs = /Integrated loudness:\s+I:\s+(-?\d+(?:\.\d+)?) LUFS/.exec(text);
  const peak = /True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?) dBFS/.exec(text);
  if (!lufs || !peak) throw new Error(`could not parse ebur128 for ${wav}`);
  return { lufs: Number(lufs[1]), peakDbfs: Number(peak[1]) };
}

const NAMES = ['E', 'A', 'D', 'G', 'B', 'e'];

/** String/fret tab, with the duration of each note shown by the tail. */
function tab(notes: readonly Note[], bars: number): string {
  const slots = bars * 8;
  const width = 3;
  const rows: string[][] = NAMES.map(() =>
    Array(slots).fill('-'.repeat(width)),
  );
  for (const note of notes) {
    const at = Math.round(note.beat * 2);
    if (at < 0 || at >= slots) continue;
    const len = Math.max(1, Math.round(note.duration * 2));
    const row = rows[note.string];
    if (!row) continue;
    row[at] = String(note.fret).padEnd(width, len > 1 ? '=' : '-');
    for (let step = 1; step < len && at + step < slots; step += 1) {
      row[at + step] = (step === len - 1 ? '=--' : '===').slice(0, width);
    }
  }
  let count = '  ';
  for (let slot = 0; slot < slots; slot += 1) {
    if (slot % 8 === 0) count += ' ';
    count += (slot % 2 === 0 ? String(((slot / 2) % 4) + 1) : '&').padEnd(
      width,
      ' ',
    );
  }
  const lines = [count];
  for (let index = 5; index >= 0; index -= 1) {
    let text = `${NAMES[index]} `;
    for (let slot = 0; slot < slots; slot += 1) {
      if (slot % 8 === 0) text += '|';
      text += rows[index]?.[slot] ?? '';
    }
    lines.push(`${text}|`);
  }
  return lines.join('\n');
}

function spellLine(notes: readonly Note[]): string {
  return notes
    .map((note) => {
      const octave = Math.floor(note.midi / 12) - 1;
      return `${note.name}${octave}@${note.beat}`;
    })
    .join(' ');
}

/** Figures that actually sounded: skip atoms and grouping bars. */
function figures(engine: Engine, notes: readonly Note[]): string {
  const witness = engine.ph.lastSkipWitness();
  if (!witness) return 'none';
  const spots = witness.spots as ({ atom: number } | null)[];
  const atoms = new Map<number, number[]>();
  spots.forEach((spot, index) => {
    if (!spot) return;
    atoms.set(spot.atom, [...(atoms.get(spot.atom) ?? []), index]);
  });
  const kinds: string[] = [];
  const groups = witness.groupingBars as number[];
  if (groups.length)
    kinds.push(`grouping bars ${groups.map((bar) => bar + 1).join(',')}`);
  for (const indexes of atoms.values()) {
    const midis = indexes.map((index) => notes[index]?.midi ?? 0);
    const gaps = midis
      .slice(1)
      .map((midi, index) => Math.abs(midi - (midis[index] ?? 0)));
    let kind = 'arp';
    if (midis.length === 2 && gaps[0] === 12) kind = 'octave';
    else if (midis.length === 2 && (gaps[0] === 8 || gaps[0] === 9))
      kind = 'sixth';
    else if (midis.length === 4 && midis[0] === midis[2]) kind = 'pedal';
    else if (
      midis.length === 4 &&
      [8, 9].includes(gaps[0] ?? 0) &&
      [8, 9].includes(gaps[2] ?? 0)
    )
      kind = 'sixth-pair';
    else if (midis.length === 4) kind = 'arp';
    kinds.push(
      `skip ${kind} ${midis.join('-')} (beats ${indexes.map((i) => notes[i]?.beat).join(',')})`,
    );
  }
  return kinds.length ? kinds.join('; ') : 'none';
}

function readout(
  engine: Engine,
  pair: PairSpec,
  side: Side,
  label: string,
  generated: Generated,
  played: readonly Note[],
  loopBeats: number,
  closing: number,
): string {
  const plan = generated.plan as {
    rhythm?: string;
    contour?: string;
    register?: string;
    cadence?: string;
    cells?: string[];
  };
  const lines = [
    `Pair ${pair.id} — side ${side} (${label})`,
    `Seed ${pair.seed}, ${pair.root} ${pair.scaleId}${pair.chord ? ` over ${pair.chord}` : ' (tonic chord)'}, ${pair.bars} bars`,
    `${pair.tempo ?? TEMPO} bpm, straight (swing amount ${SWING}), ${(pair.loopPasses ?? 1) > 1 ? `Loop on (${pair.loopPasses} passes)` : 'Loop off'}`,
    `Plan: ${plan.rhythm} rhythm, ${plan.contour} contour, ${plan.register} register, cadence ${plan.cadence}`,
    `Cells: ${(plan.cells ?? []).join(' | ')}`,
    `Figures: ${figures(engine, generated.notes)}`,
    '',
    `Played notes (${played.length}):${(pair.loopPasses ?? 1) > 1 ? ` loop period ${loopBeats} beats, closing cadence ${closing >= 0 ? `index ${closing} dropped on every pass` : 'none found'}` : ''}`,
    'String fret finger (chord tone *, held _):',
    ...played.map((note) => {
      const octave = String(Math.floor(note.midi / 12) - 1);
      return `  ${note.name}${octave.padEnd(2)} ${String(note.midi).padStart(3)}  string ${note.string} fret ${String(note.fret).padStart(2)} finger ${note.finger}  beat ${String(note.beat).padStart(4)} dur ${note.duration}${note.chordTone ? ' *' : ''}${note.duration >= 1 ? ' _' : ''}`;
    }),
    '',
    'Tab (first pass only):',
    tab(generated.notes, pair.bars),
    '',
  ];
  return lines.join('\n');
}

const spec = JSON.parse(readFileSync(specPath, 'utf8')) as {
  pairs: PairSpec[];
};
mkdirSync(outDir, { recursive: true });

const engines = new Map<string, Engine>();
for (const pair of spec.pairs) {
  for (const tree of [pair.fromTree, pair.toTree]) {
    if (!engines.has(tree)) engines.set(tree, await loadEngine(tree));
  }
}

const rows: string[] = [];
for (const pair of spec.pairs) {
  const fromEngine = engines.get(pair.fromTree);
  const toEngine = engines.get(pair.toTree);
  if (!fromEngine || !toEngine) throw new Error(`${pair.id}: engine missing`);
  const generatedA = generate(fromEngine, pair);
  const generatedB = generate(toEngine, pair);
  const lineA = spellLine(generatedA.notes);
  const lineB = spellLine(generatedB.notes);
  if (lineA === lineB) throw new Error(`${pair.id}: A and B are the same line`);

  const tempo = pair.tempo ?? TEMPO;
  const loopPasses = pair.loopPasses ?? 1;
  const playedA = await loopNotes(generatedA.notes, loopPasses);
  const playedB = await loopNotes(generatedB.notes, loopPasses);
  const rendered = {
    A: await render(generatedA.notes, tempo, loopPasses),
    B: await render(generatedB.notes, tempo, loopPasses),
  };
  const rawPeak = Math.max(samplePeak(rendered.A), samplePeak(rendered.B));
  if (rawPeak <= 0) throw new Error(`${pair.id} is silent`);

  const probeDir = mkdtempSync(join(tmpdir(), 'feel-probe-'));
  let gain = 0.25 / rawPeak;
  let probeA: { lufs: number; peakDbfs: number };
  let probeB: { lufs: number; peakDbfs: number };
  try {
    const probeWavA = join(probeDir, 'a.wav');
    const probeWavB = join(probeDir, 'b.wav');
    writeWav(probeWavA, rendered.A, gain);
    writeWav(probeWavB, rendered.B, gain);
    probeA = loudness(probeWavA);
    probeB = loudness(probeWavB);
  } finally {
    rmSync(probeDir, { recursive: true, force: true });
  }
  const makeup = LU_CENTER - (probeA.lufs + probeB.lufs) / 2;
  gain *= 10 ** (makeup / 20);
  const hotter = Math.max(probeA.peakDbfs, probeB.peakDbfs) + makeup;
  if (hotter > PEAK_CEILING_DB) gain *= 10 ** ((PEAK_CEILING_DB - hotter) / 20);

  const measured: Record<
    Side,
    { lufs: number; peakDbfs: number; seconds: number }
  > = {
    A: { lufs: 0, peakDbfs: 0, seconds: 0 },
    B: { lufs: 0, peakDbfs: 0, seconds: 0 },
  };
  for (const side of ['A', 'B'] as const) {
    const wav = join(outDir, `${pair.stem}_${side}.wav`);
    const mp3 = join(outDir, `${pair.stem}_${side}.mp3`);
    writeWav(wav, rendered[side], gain);
    encodeMp3(wav, mp3);
    const level = loudness(wav);
    measured[side] = { ...level, seconds: rendered[side].length / RATE };
    rmSync(wav);
  }

  writeFileSync(
    join(outDir, `${pair.stem}_A.txt`),
    readout(
      fromEngine,
      pair,
      'A',
      pair.fromLabel,
      generatedA,
      playedA.notes,
      playedA.loopBeats,
      playedA.closing,
    ),
  );
  writeFileSync(
    join(outDir, `${pair.stem}_B.txt`),
    readout(
      toEngine,
      pair,
      'B',
      pair.toLabel,
      generatedB,
      playedB.notes,
      playedB.loopBeats,
      playedB.closing,
    ),
  );

  const gap = Math.abs(measured.A.lufs - measured.B.lufs);
  const plan = generatedB.plan as {
    rhythm?: string;
    contour?: string;
    cells?: string[];
  };
  rows.push(
    [
      `## ${pair.id}: ${pair.fromLabel} → ${pair.toLabel}`,
      '',
      pair.listen,
      '',
      `- Settings: ${pair.root} ${pair.scaleId}${pair.chord ? ` over ${pair.chord}` : ' on the tonic chord'}, ${pair.bars} bars, seed ${pair.seed}, ${tempo} bpm straight, ${loopPasses > 1 ? `Loop on (${loopPasses} passes, closing cadence dropped and the next pass wrapping onto the opening note)` : 'Loop off'}, no locks`,
      `- What changed: ${pair.changed}`,
      `- Plan (B): ${plan.rhythm} rhythm, ${plan.contour} contour, cadence reached on the bar line; cells ${(plan.cells ?? []).join(' | ')}`,
      `- A ${measured.A.seconds.toFixed(2)}s ${measured.A.lufs.toFixed(1)} LUFS, B ${measured.B.seconds.toFixed(2)}s ${measured.B.lufs.toFixed(1)} LUFS, shared gain ${gain.toFixed(4)}, loudness gap ${gap.toFixed(2)} LU`,
      `- A notes: ${lineA}`,
      `- B notes: ${lineB}`,
      `- Files: \`${pair.stem}_A.mp3\` / \`${pair.stem}_B.mp3\`, tab readouts \`${pair.stem}_A.txt\` / \`${pair.stem}_B.txt\``,
      '',
    ].join('\n'),
  );
  console.log(
    `${pair.id} ${pair.stem}: A ${measured.A.lufs.toFixed(1)} / B ${measured.B.lufs.toFixed(1)} LUFS, gap ${gap.toFixed(2)} LU`,
  );
}

writeFileSync(
  join(outDir, 'clips.md'),
  [
    '# Phrase-feel listen pack',
    '',
    `Rendered straight (swing amount ${SWING}) at each pair's own tempo, Loop off unless the pair says otherwise, no locks.`,
    'Every side is generated by the engine at its own commit and rendered through the app path:',
    '`schedulePhrase` → `scheduleVoicing` + `dampPhraseNote`, so each note rings to the next onset with the soft release and rests stay audible.',
    'OfflineAudioContext, 44100 Hz mono. Both sides of a pair share one gain aimed at -16 LUFS.',
    '',
    ...rows,
  ].join('\n'),
);
console.log(`wrote ${join(outDir, 'clips.md')}`);
