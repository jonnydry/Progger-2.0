import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';

/** Audio modules the headroom render reads, plus the cello loops. */
const SOURCE_FILES = [
  'lib/audio-output.ts',
  'lib/drone-audio.ts',
  'lib/drone-levels.ts',
  'lib/drone.ts',
  'lib/voicing-audio.ts',
];

export function headroomSourceFiles(): string[] {
  const assets = readdirSync('public/audio/drone')
    .filter((name) => name.endsWith('.m4a'))
    .sort()
    .map((name) => `public/audio/drone/${name}`);
  return [...SOURCE_FILES, ...assets];
}

/** Stable hash of the audio sources and the drone asset files. */
export function headroomSourceHash(): string {
  const hash = createHash('sha256');
  for (const file of headroomSourceFiles()) {
    hash.update(file);
    hash.update('\0');
    hash.update(readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}
