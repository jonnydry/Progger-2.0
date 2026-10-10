import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

function filesUnder(directory: string, suffix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    const info = statSync(path);
    if (info.isDirectory()) found.push(...filesUnder(path, suffix));
    else if (entry.endsWith(suffix)) found.push(path);
  }
  return found;
}

void test('the drone preview is noindex and omitted from production output', () => {
  const page = readFileSync('app/lab/drone/page.tsx', 'utf8');
  assert.match(page, /index:\s*false/);
  assert.match(page, /follow:\s*false/);
  const build = readFileSync('scripts/build-vercel.mjs', 'utf8');
  assert.match(build, /VERCEL_ENV === 'production'/);
  assert.match(build, /lab\/drone\.html/);
  assert.match(build, /lab\/drone\.txt/);
  const vercel = readFileSync('vercel.json', 'utf8');
  assert.match(vercel, /X-Robots-Tag/);
  assert.match(vercel, /noindex, nofollow/);
  assert.match(vercel, /\/lab\/drone/);
});

void test('the public app does not link the drone preview', () => {
  const blocked = [
    'app/page.tsx',
    'app/layout.tsx',
    ...filesUnder('components', '.tsx').filter((file) => !file.includes('drone-lab')),
    ...filesUnder('lib', '.ts').filter((file) => !file.startsWith('lib/drone')),
  ];
  for (const file of blocked) {
    assert.equal(readFileSync(file, 'utf8').includes('lab/drone'), false, file);
  }
});

void test('the lab audio module does not touch the voicing player', () => {
  const source = readFileSync('lib/drone-audio.ts', 'utf8');
  assert.equal(source.includes('voicing-audio'), false);
  assert.equal(source.includes('VoicingPlayer'), false);
});

void test('the lab page auditions a note and a chord with the existing voicing player', () => {
  const page = readFileSync('components/drone-lab.tsx', 'utf8');
  assert.equal(page.includes('VoicingPlayer'), true);
  assert.equal(page.includes('voicing-audio'), true);
  assert.match(page, /Reed under A4/);
  assert.match(page, /Reed under Am/);
});
