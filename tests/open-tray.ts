import type { Page } from 'playwright';

/**
 * Open the stash. The server-rendered Stash button accepts a click before
 * React attaches its handler. networkidle does not wait for that, so on a
 * busy runner the click is lost and `#practice-tray` never appears.
 * React records props on the node once the handler is attached.
 *
 * A second click while the panel chunk is still loading toggles the tray
 * shut, so this retries only when `aria-expanded` is still false.
 */
export async function openTray(page: Page) {
  const button = page.locator('.tray-open');
  await button.waitFor();
  await page.waitForFunction(() => {
    const node = document.querySelector('.tray-open');
    if (!(node instanceof HTMLElement)) return false;
    return Object.keys(node).some((key) => key.startsWith('__reactProps'));
  });
  await button.click();
  const tray = page.locator('#practice-tray');
  const opened = await tray
    .waitFor({ state: 'visible', timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  if (opened) return;
  if ((await button.getAttribute('aria-expanded')) === 'true') {
    await tray.waitFor({ state: 'visible' });
    return;
  }
  await button.click();
  await tray.waitFor({ state: 'visible' });
}
