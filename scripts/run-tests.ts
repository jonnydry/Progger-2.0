import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Node test suite in slices, so CI can run them as parallel jobs.
 *
 * - unit: no browser and no dev server.
 * - browser: launches Chromium or Firefox, mostly against the vinext dev
 *   server.
 * - render: the two long real-browser audio renders. CI gives them their own
 *   job so the timing-sensitive app journeys do not share a runner with them.
 *
 * A file is a browser test when it, or a local helper it imports, imports
 * `launchNamed` from tests/browser-launch.ts, `acquireDevServer` from
 * tests/dev-server.ts, or a value from playwright. The split follows the
 * imports, so a new browser test joins the browser slice with no list to
 * update. Dynamic `import()` is not followed. A browser test it misses
 * still fails loudly in the unit job, which sets CI and has no browsers.
 */
export type Slice = 'unit' | 'browser' | 'render';

export const RENDER_FILES = [
  'tests/drone-browser-render.test.ts',
  'tests/drone-peak.test.ts',
];

/**
 * `--test-timeout` for each slice, in ms. Node 22, which CI runs, applies it
 * to each test file as a whole, and it cuts off a longer per-test timeout.
 * Node 26 applies it to each test that sets no timeout of its own. Each value
 * sits above the sum of the explicit per-test timeouts in any one file of its
 * slice: 3 min in unit, 9 min in browser, 22 min in render (drone-peak
 * without the nightly sweep).
 */
export const SLICE_TIMEOUT_MS: Record<Slice, number> = {
  unit: 10 * 60_000,
  browser: 15 * 60_000,
  render: 25 * 60_000,
};

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TESTS = join(ROOT, 'tests');
const BROWSER_LAUNCH = join(TESTS, 'browser-launch.ts');
const DEV_SERVER = join(TESTS, 'dev-server.ts');

/** Value names an import clause binds. `import type` binds none. */
function valueNames(clause: string): string[] {
  if (/^type\s/.test(clause)) return [];
  const names: string[] = [];
  const braces = /\{([\s\S]*)\}/.exec(clause);
  for (const part of braces?.[1].split(',') ?? []) {
    const name = part.trim();
    if (name && !name.startsWith('type '))
      names.push(name.split(/\s+as\s+/)[0]);
  }
  const rest = clause
    .replace(/\{[\s\S]*\}/, '')
    .replace(/,/g, ' ')
    .trim();
  if (rest) names.push(rest);
  return names;
}

/** True when `file` or a local helper it imports drives a real browser. */
export function drivesBrowser(file: string, seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  const source = readFileSync(file, 'utf8');
  // `import ... from` and `export ... from`. The clause cannot hold a quote
  // or a semicolon, so a side-effect import never merges into the next one.
  for (const [, clause, from] of source.matchAll(
    /^(?:import|export)\s+([^;'"]*?)\s+from\s+['"]([^'"]+)['"]/gm,
  )) {
    const names = valueNames(clause);
    if (names.length === 0) continue;
    if (from === 'playwright') return true;
    if (!from.startsWith('.')) continue;
    const target = resolve(dirname(file), from);
    const whole = names.some((name) => name.startsWith('*'));
    if (target === BROWSER_LAUNCH) {
      if (whole || names.includes('launchNamed')) return true;
      continue;
    }
    if (target === DEV_SERVER) {
      if (whole || names.includes('acquireDevServer')) return true;
      continue;
    }
    if (
      target.startsWith(`${TESTS}${sep}`) &&
      target.endsWith('.ts') &&
      drivesBrowser(target, seen)
    ) {
      return true;
    }
  }
  return false;
}

/** Every tests/*.test.ts file, in exactly one slice, as repo-relative paths. */
export function testSlices(): Record<Slice, string[]> {
  const slices: Record<Slice, string[]> = { unit: [], browser: [], render: [] };
  const files = readdirSync(TESTS)
    .filter((name) => name.endsWith('.test.ts'))
    .sort()
    .map((name) => `tests/${name}`);
  for (const file of files) {
    if (RENDER_FILES.includes(file)) slices.render.push(file);
    else if (drivesBrowser(join(ROOT, file))) slices.browser.push(file);
    else slices.unit.push(file);
  }
  return slices;
}

async function missingBrowsers(): Promise<string[]> {
  const { chromium, firefox } = await import('playwright');
  const missing: string[] = [];
  for (const [name, type] of [
    ['chromium', chromium],
    ['firefox', firefox],
  ] as const) {
    let path = '';
    try {
      path = type.executablePath();
    } catch {
      /* not installed */
    }
    if (!path || !existsSync(path)) missing.push(name);
  }
  return missing;
}

function usage(message: string): never {
  process.stderr.write(
    `${message}\n` +
      'usage: run-tests.ts <unit|browser|render|all> [--list] [tests/<file>.test.ts ...] [node --test flags]\n',
  );
  process.exit(2);
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (
    mode !== 'unit' &&
    mode !== 'browser' &&
    mode !== 'render' &&
    mode !== 'all'
  ) {
    usage(`unknown slice ${mode ?? '(none)'}`);
  }
  const slices = testSlices();
  for (const file of RENDER_FILES) {
    if (!existsSync(join(ROOT, file))) {
      usage(`${file} is listed as a render test but does not exist`);
    }
  }
  const files =
    mode === 'all'
      ? [...slices.unit, ...slices.browser, ...slices.render].sort()
      : slices[mode];
  const picked = rest
    .filter((arg) => arg.endsWith('.test.ts'))
    .map((arg) => relative(ROOT, resolve(arg)).split(sep).join('/'));
  for (const file of picked) {
    if (!files.includes(file)) usage(`${file} is not in the ${mode} slice`);
  }
  const run = picked.length ? picked : files;
  if (run.length === 0) usage(`the ${mode} slice has no test files`);
  if (rest.includes('--list')) {
    process.stdout.write(`${run.join('\n')}\n`);
    return;
  }
  const flags = rest.filter(
    (arg) => arg !== '--list' && !arg.endsWith('.test.ts'),
  );

  if (run.some((file) => !slices.unit.includes(file))) {
    const missing = await missingBrowsers();
    if (missing.length) {
      const names = missing.join(' and ');
      const fix = 'npx playwright install --with-deps chromium firefox';
      if (process.env.CI) {
        process.stderr.write(`${names} not installed. Run: ${fix}\n`);
        process.exit(1);
      }
      process.stderr.write(
        `warning: ${names} not installed, so tests that need ${missing.length > 1 ? 'them' : 'it'} will skip. Run: ${fix}\n`,
      );
    }
  }

  // CI points TEST_RESULTS at a directory it uploads when a job fails.
  const results = process.env.TEST_RESULTS
    ? resolve(process.env.TEST_RESULTS)
    : '';
  const reporters: string[] = [];
  if (results) {
    mkdirSync(results, { recursive: true });
    reporters.push(
      '--test-reporter=spec',
      '--test-reporter-destination=stdout',
      '--test-reporter=spec',
      `--test-reporter-destination=${join(results, `${mode}.log`)}`,
      '--test-reporter=junit',
      `--test-reporter-destination=${join(results, `${mode}.xml`)}`,
    );
  }
  const timeout =
    mode === 'all'
      ? Math.max(...Object.values(SLICE_TIMEOUT_MS))
      : SLICE_TIMEOUT_MS[mode];
  const child = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      '--test',
      `--test-timeout=${timeout}`,
      ...reporters,
      ...flags,
      ...run,
    ],
    { cwd: ROOT, stdio: 'inherit' },
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code) => {
    process.exit(code ?? 1);
  });
}

const entry = process.argv[1];
if (entry && realpathSync(entry) === fileURLToPath(import.meta.url)) {
  await main();
}
