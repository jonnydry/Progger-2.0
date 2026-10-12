import { existsSync } from 'node:fs';
import { chromium, firefox, type Browser } from 'playwright';

export type BrowserName = 'chromium' | 'firefox';

type SkipTest = {
  skip: (reason?: string) => void;
};

function browserType(name: BrowserName) {
  return name === 'chromium' ? chromium : firefox;
}

function browserInstalled(name: BrowserName): boolean {
  try {
    return existsSync(browserType(name).executablePath());
  } catch {
    return false;
  }
}

/**
 * Playwright chooses the browser binary. A missing binary or a launch
 * failure skips on a local run and fails when CI is set.
 */
export async function launchNamed(
  name: BrowserName,
  test: SkipTest,
): Promise<Browser> {
  if (!browserInstalled(name)) {
    const message = `${name} browser binary is missing`;
    if (process.env.CI) throw new Error(message);
    test.skip(message);
    throw new Error(message);
  }
  try {
    return await browserType(name).launch({
      headless: true,
      ...(name === 'chromium'
        ? { args: ['--no-sandbox', '--use-angle=swiftshader'] }
        : {
            firefoxUserPrefs: {
              'media.cubeb.sandbox': false,
            },
          }),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const message = `${name} failed to launch: ${detail}`;
    if (process.env.CI) throw new Error(message);
    test.skip(message);
    throw new Error(message);
  }
}
