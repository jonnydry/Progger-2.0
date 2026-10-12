import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { QUALITIES, voicings } from '../lib/harmony.ts';
import { ROOTS } from '../lib/music.ts';
import { voicingMidi } from '../lib/voicing-audio.ts';

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry === 'ui' || entry === 'node_modules') continue;
      found.push(...sourceFiles(path));
      continue;
    }
    if (entry.endsWith('.ts') || entry.endsWith('.tsx')) found.push(path);
  }
  return found;
}

void test('the smallest voicing the app can play uses two strings', () => {
  let listed = 0;
  let minStrings = 6;
  const unique = new Set<string>();
  const sizes = new Map<number, number>();
  for (const root of ROOTS) {
    for (const quality of QUALITIES) {
      for (const voicing of voicings(root, quality)) {
        const strings = voicing.frets.filter((fret) => fret !== null).length;
        listed += 1;
        minStrings = Math.min(minStrings, strings);
        sizes.set(strings, (sizes.get(strings) ?? 0) + 1);
        unique.add(voicing.frets.map((fret) => (fret === null ? 'x' : fret)).join(','));
      }
    }
  }
  assert.equal(minStrings, 2);
  assert.equal(unique.size, 8629);
  assert.ok(listed > unique.size);
  assert.equal(sizes.get(1), undefined);
  const catalog = readFileSync(new URL('../lib/harmony.ts', import.meta.url), 'utf8');
  assert.match(catalog, /if \(count<2 \|\| count>4\) continue;/);

  const production = [...sourceFiles('app'), ...sourceFiles('components')];
  const playSites = production.filter((file) =>
    readFileSync(file, 'utf8').includes('.play('),
  );
  assert.deepEqual(playSites, ['components/voicing-audition.tsx']);
  const audition = readFileSync('components/voicing-audition.tsx', 'utf8');
  assert.match(audition, /player\.current\?\.play\(frets\)/);
  const browser = readFileSync('components/voicing-browser.tsx', 'utf8');
  assert.match(browser, /const current = voicings\[index\]/);
  assert.match(browser, /frets=\{current\.frets\}/);
  const page = readFileSync('app/page.tsx', 'utf8');
  assert.match(page, /voicings\(root, quality\)/);
  assert.match(page, /voicings=\{chordVoicings\}/);
  const fretboard = readFileSync('components/fretboard.tsx', 'utf8');
  assert.equal(fretboard.includes('voicing-audio'), false);
  assert.equal(fretboard.includes('VoicingPlayer'), false);
  assert.equal(fretboard.includes('.play('), false);

  // The player function accepts one sounding string. No app path supplies one.
  assert.deepEqual(voicingMidi([null, null, null, null, null, 0]), [64]);
});
