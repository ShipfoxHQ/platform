import type {ListIntegrationProvidersResponseDto} from '@shipfox/api-integration-core-dto';
import {stableScreenshot} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';
import {expect, test} from './test.js';

const ADDED_DATE_RE = /^Added /u;
const VISUAL_GITEA_CONNECTION_NAME = 'Gitea visual-test-org';
const VISUAL_ADDED_DATE = 'Added Jan 15, 2026';

// The e2e API may enable a different provider set, so stub the list to keep the
// multi-tile grid deterministic. Typed against the real response DTO so a
// contract change fails `turbo type`; e2e packages depend on *-dto packages
// for types only because the runtime schema would load package dist, which
// self-references src under the test runner.
const CATALOGUE_PROVIDERS: ListIntegrationProvidersResponseDto = {
  providers: [
    {provider: 'github', display_name: 'GitHub', capabilities: ['source_control']},
    {provider: 'sentry', display_name: 'Sentry', capabilities: []},
    {provider: 'linear', display_name: 'Linear', capabilities: ['agent_tools']},
    {provider: 'gitea', display_name: 'Gitea', capabilities: ['source_control']},
  ],
};

async function stubProviders(page: Page): Promise<void> {
  await page.route('**/integration-providers', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(CATALOGUE_PROVIDERS),
    });
  });
}

test('settings catalogue lists available providers with an empty installed state', async ({
  page,
  integrationsCatalogue,
  createReadyWorkspace,
}) => {
  const {workspaceSlug} = await createReadyWorkspace({
    name: 'Integrations Settings Workspace',
  });

  await stubProviders(page);

  await integrationsCatalogue.goto(workspaceSlug);

  await expect(integrationsCatalogue.availableHeading()).toBeVisible();
  await expect(integrationsCatalogue.installLink('GitHub')).toBeVisible();
  await expect(integrationsCatalogue.installLink('Sentry')).toBeVisible();
  await expect(integrationsCatalogue.installLink('Linear')).toBeVisible();
  await expect(integrationsCatalogue.installLink('Gitea')).toBeVisible();
  await expect(integrationsCatalogue.emptyInstalledState()).toBeVisible();

  await stableScreenshot(page, 'integrations/settings-empty');
});

test('settings catalogue shows an installed provider after Gitea install', async ({
  page,
  gitea,
  integrationsCatalogue,
  providerInstall,
  createReadyWorkspace,
}) => {
  const {workspaceSlug} = await createReadyWorkspace({
    name: 'Integrations Installed Workspace',
  });

  const org = await gitea.createOrg();

  await providerInstall.goto(workspaceSlug, 'gitea');
  await providerInstall.installOrganization(org.org);
  await providerInstall.expectInstalled('Gitea organization installed.');

  await integrationsCatalogue.goto(workspaceSlug);

  const installedName = integrationsCatalogue.installedProviderName(`Gitea ${org.org}`);
  await expect(installedName).toBeVisible();
  await expect(integrationsCatalogue.installedStatus('Connected')).toHaveCount(0);
  await expect(integrationsCatalogue.installedStatus(ADDED_DATE_RE)).toBeVisible();

  await stableScreenshot(page, 'integrations/settings-installed', [
    {locator: installedName, text: VISUAL_GITEA_CONNECTION_NAME},
    {locator: integrationsCatalogue.installedStatus(ADDED_DATE_RE), text: VISUAL_ADDED_DATE},
    {
      locator: integrationsCatalogue.installedActionsButton(`Gitea ${org.org}`),
      attributes: {'aria-label': `Open ${VISUAL_GITEA_CONNECTION_NAME} integration actions`},
    },
  ]);
});
