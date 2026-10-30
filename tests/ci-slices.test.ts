import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RENDER_FILES,
  SLICE_TIMEOUT_MS,
  drivesBrowser,
  testSlices,
  type Slice,
} from '../scripts/run-tests.ts';

const ci = readFileSync(
  new URL('../.github/workflows/ci.yml', import.meta.url),
  'utf8',
);

function source(file: string): string {
  return readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
}

type Job = {
  id: string;
  timeout: number;
  needs: string[];
  slices: { slice: Slice; timeout: number }[];
};

/** Just enough of ci.yml: each job's timeout, needs, and test steps. */
function ciJobs(): Job[] {
  const body = ci.slice(ci.indexOf('\njobs:\n') + 7);
  return body
    .split(/^(?= {2}[a-z][\w-]*:$)/m)
    .filter((block) => /^ {2}[a-z]/.test(block))
    .map((block) => {
      const steps = block.split(/^(?= {6}- name:)/m);
      return {
        id: /^ {2}([\w-]+):$/m.exec(block)?.[1] ?? '',
        timeout: Number(/^ {4}timeout-minutes: (\d+)$/m.exec(block)?.[1]),
        needs:
          /^ {4}needs: \[([^\]]*)\]$/m
            .exec(block)?.[1]
            .split(',')
            .map((name) => name.trim()) ?? [],
        slices: steps.flatMap((step) => {
          const slice = /run: npm run test:(unit|browser|render)$/m.exec(
            step,
          )?.[1] as Slice | undefined;
          if (!slice) return [];
          const timeout = Number(
            /^ {8}timeout-minutes: (\d+)$/m.exec(step)?.[1],
          );
          return [{ slice, timeout }];
        }),
      };
    });
}

void test('every test file runs in exactly one slice', () => {
  const { unit, browser, render } = testSlices();
  const all = readdirSync(new URL('.', import.meta.url))
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => `tests/${name}`)
    .sort();
  assert.deepEqual([...unit, ...browser, ...render].sort(), all);
  assert.deepEqual(render, [...RENDER_FILES].sort());
});

void test('a file that launches a browser or the dev server is not a unit test', () => {
  const { unit, browser, render } = testSlices();
  for (const file of unit) {
    assert.doesNotMatch(
      source(file),
      /\blaunchNamed\(|\bacquireDevServer\(/,
      file,
    );
  }
  // Imports only the share-dir helper from dev-server.ts.
  assert.ok(unit.includes('tests/dev-server.test.ts'));
  // A browser harness with no dev server.
  assert.ok(browser.includes('tests/phrase-held-release.test.ts'));
  assert.ok(browser.includes('tests/phrase-panel-loop.test.ts'));
  assert.ok(render.includes('tests/drone-peak.test.ts'));
});

void test('the slicer reads value imports, not type imports', () => {
  const dir = mkdtempSync(join(tmpdir(), 'progger-slices-'));
  const tests = fileURLToPath(new URL('.', import.meta.url));
  const from = (name: string) => `./${relative(dir, join(tests, name))}`;
  const cases: [string, boolean][] = [
    [`import { launchNamed } from '${from('browser-launch.ts')}';`, true],
    [`import {\n  acquireDevServer,\n} from '${from('dev-server.ts')}';`, true],
    [`import * as launch from '${from('browser-launch.ts')}';`, true],
    [`import { chromium } from 'playwright';`, true],
    [`import { vinextShareDir } from '${from('dev-server.ts')}';`, false],
    [`import type { BrowserName } from '${from('browser-launch.ts')}';`, false],
    [`import { type Browser } from 'playwright';`, false],
    [`import './setup.ts';\nimport type { Page } from 'playwright';`, false],
  ];
  try {
    cases.forEach(([code, browser], index) => {
      const file = join(dir, `case-${index}.test.ts`);
      writeFileSync(file, `${code}\n`);
      assert.equal(drivesBrowser(file), browser, code);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void test('CI runs every slice, and the check gate needs every job', () => {
  const jobs = ciJobs();
  const check = jobs.find((job) => job.id === 'check');
  assert.ok(check, 'ci.yml has no check job');
  assert.match(ci, /^ {2}check:\n {4}name: check\n {4}if: always\(\)$/m);
  assert.deepEqual(
    [...check.needs].sort(),
    jobs
      .filter((job) => job.id !== 'check')
      .map((job) => job.id)
      .sort(),
  );
  const ran = jobs.flatMap((job) => job.slices.map(({ slice }) => slice));
  assert.deepEqual([...ran].sort(), ['browser', 'render', 'unit']);
});

void test('a hung test file times out before its CI step, and the step before its job', () => {
  for (const job of ciJobs()) {
    for (const { slice, timeout } of job.slices) {
      assert.ok(
        SLICE_TIMEOUT_MS[slice] < timeout * 60_000,
        `${slice} file timeout is not below its step timeout`,
      );
      assert.ok(
        timeout < job.timeout,
        `${slice} step timeout is not below the ${job.id} job timeout`,
      );
    }
  }
});
