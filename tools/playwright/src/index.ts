import {
  argosScreenshot as upstreamArgosScreenshot,
  type ArgosScreenshotOptions,
} from '@argos-ci/playwright';
import type {Frame, Page} from '@playwright/test';

export type {ArgosScreenshotOptions} from '@argos-ci/playwright';
export {
  type APIRequestContext,
  type BrowserContext,
  defineConfig,
  devices,
  expect,
  type Page,
  type PlaywrightTestConfig,
  request,
  test,
} from '@playwright/test';

// `document.fonts.ready` resolves once every font face requested so far has
// finished loading. Argos's built-in `waitForFonts` only checks
// `document.fonts.status === "loaded"`, which is satisfied before a
// `font-display: swap` face has even started fetching. The fallback can be
// captured on cold CI. Awaiting `document.fonts.ready` first closes that window.
async function waitForFonts(handler: Page | Frame): Promise<void> {
  await handler.evaluate(() => document.fonts.ready);
}

export async function argosScreenshot(
  handler: Page | Frame,
  name: string,
  options?: ArgosScreenshotOptions,
): Promise<ReturnType<typeof upstreamArgosScreenshot>> {
  await waitForFonts(handler);
  return upstreamArgosScreenshot(handler, name, options);
}
