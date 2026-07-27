import {type APIRequestContext, expect, type Page, test} from '@shipfox/playwright';
import {storybooks} from '../../preview-manifest.js';

type StorybookIndexEntry = {
  id: string;
  type: string;
};

type StorybookIndex = {
  entries: Record<string, StorybookIndexEntry>;
};

type PreviewMetadata = {
  commitSha: string;
};

const compositionStoryUrlPattern = /\/\?path=\/story\/react-ui_/;

async function getRepresentativeStoryId(request: APIRequestContext, path: string): Promise<string> {
  const response = await request.get(`${path}index.json`);
  expect(response.ok()).toBe(true);

  const index = (await response.json()) as StorybookIndex;
  const story = Object.values(index.entries).find((entry) => entry.type === 'story');
  if (story === undefined) throw new Error(`${path} has no representative story`);

  return story.id;
}

function collectBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`page: ${error.message}`));
  page.on('requestfailed', (request) => {
    const errorText = request.failure()?.errorText;
    if (errorText !== 'net::ERR_ABORTED') {
      errors.push(`request: ${request.url()} ${errorText ?? 'failed'}`);
    }
  });
  return errors;
}

test.describe('assembled Storybook preview', () => {
  test('loads Composition refs and navigates to a standalone child', async ({page}) => {
    const errors = collectBrowserErrors(page);

    await page.goto('/');

    const refs = await page.evaluate(() => {
      const value = (window as Window & {REFS?: Record<string, {url: string}>}).REFS;
      return value === undefined ? {} : value;
    });
    expect(Object.keys(refs)).toEqual(storybooks.map(({id}) => id));

    for (const storybook of storybooks) {
      await expect(page.locator('body')).toContainText(storybook.title);
    }

    await page.getByText('Accordion', {exact: true}).click();
    await expect(page).toHaveURL(compositionStoryUrlPattern);
    expect(errors).toEqual([]);
  });

  test('displays the exact deployed commit identity', async ({page, request}) => {
    const metadataResponse = await request.get('/preview-metadata.json');
    expect(metadataResponse.ok()).toBe(true);
    const metadata = (await metadataResponse.json()) as PreviewMetadata;

    await page.goto('/iframe.html?id=introduction--docs');

    await expect(page.getByText('Preview identity', {exact: true})).toBeVisible();
    await expect(page.getByText(metadata.commitSha, {exact: true})).toBeVisible();
  });

  test('renders one representative story from every child without browser errors', async ({
    browser,
    request,
  }) => {
    const context = await browser.newContext();

    for (const storybook of storybooks) {
      const storyId = await getRepresentativeStoryId(request, storybook.path);
      const page = await context.newPage();
      const errors = collectBrowserErrors(page);
      const response = await page.goto(`${storybook.path}iframe.html?id=${storyId}&viewMode=story`);

      expect(response?.ok()).toBe(true);
      await expect(page.locator('#storybook-root')).toBeVisible();
      expect(errors).toEqual([]);
      await page.close();
    }

    await context.close();
  });

  for (const storybook of storybooks) {
    test(`serves ${storybook.id} standalone URL and refreshes its deep link`, async ({
      page,
      request,
    }) => {
      const errors = collectBrowserErrors(page);

      const redirectsResponse = await request.get('/_redirects');
      expect(redirectsResponse.ok()).toBe(true);
      expect(await redirectsResponse.text()).toContain(
        `/${storybook.id}/* /${storybook.id}/index.html 200`,
      );

      const storyId = await getRepresentativeStoryId(request, storybook.path);
      const standaloneResponse = await request.get(storybook.path);
      expect(standaloneResponse.ok()).toBe(true);
      expect(await standaloneResponse.text()).toContain('id="root"');

      const deepLink = `${storybook.path}?path=/story/${storyId}`;
      const deepLinkResponse = await page.goto(deepLink, {waitUntil: 'domcontentloaded'});
      expect(deepLinkResponse?.ok()).toBe(true);
      await expect(page.locator('#root')).toBeVisible();
      await page.reload({waitUntil: 'domcontentloaded'});
      await expect(page.locator('#root')).toBeVisible();

      expect(errors).toEqual([]);
    });
  }
});
