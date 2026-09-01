import type {Page} from '@shipfox/playwright';

export const INITIAL_CHECKLIST_COUNT_RE = /2 of 4 done/u;
export const LINEAR_CHECKLIST_COUNT_RE = /3 of 4 done/u;
export const CLOUD_CHECKLIST_COUNT_RE = /2 of 3 done/u;

type InstallationRunners = 'managed' | 'none';

async function stubModelProviderDependencies(page: Page, workspaceId: string) {
  await page.route('**/agent/model-provider-catalog', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        providers: [],
        managed_provider_id: 'managed-default',
        instance_default_provider_id: null,
      }),
    });
  });
  await page.route(`**/workspaces/${workspaceId}/agent/model-providers`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({configs: [], default_provider_id: null, default_harness_id: null}),
    });
  });
}

export async function stubChecklistDependencies(
  page: Page,
  workspaceId: string,
  installationRunners: InstallationRunners = 'none',
) {
  await page.route(`**/workspaces/${workspaceId}/provisioners/active`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({provisioners: [], installation_runners: installationRunners}),
    });
  });
  await stubModelProviderDependencies(page, workspaceId);
}
