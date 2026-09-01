import type {WorkspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import type {Page} from '@shipfox/playwright';

export const INITIAL_CHECKLIST_COUNT_RE = /2 of 4 done/u;
export const LINEAR_CHECKLIST_COUNT_RE = /3 of 4 done/u;
export const CLOUD_CHECKLIST_COUNT_RE = /2 of 3 done/u;
export const LINEAR_AUTHORIZE_ORIGIN = 'https://linear.app';
export const LINEAR_AUTHORIZE_URL_RE = /^https:\/\/linear\.app\//u;

type InstallationRunners = 'managed' | 'none';

export interface ChecklistWorkspace {
  id: string;
  slug: string;
}

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

/**
 * Arranges the workspace the checklist reads: an owner, a project so the
 * workspace is past onboarding, a browser session, and the stubbed runner and
 * model-provider families that pin the checklist to a known count.
 */
export async function createChecklistWorkspace({
  auth,
  page,
  projects,
  workspaces,
  name,
  installationRunners = 'none',
}: Pick<WorkspaceFixtures, 'auth' | 'projects' | 'workspaces'> & {
  page: Page;
  name: string;
  installationRunners?: InstallationRunners;
}): Promise<ChecklistWorkspace> {
  const user = await auth.createUser();
  const workspace = await workspaces.create({userId: user.user.id, name});
  await projects.createProject({workspaceId: workspace.id});
  await auth.loginAs(page, user);
  await stubChecklistDependencies(page, workspace.id, installationRunners);
  return {id: workspace.id, slug: workspace.slug};
}

/** Serves Linear's authorize page so the install redirect stays inside the browser. */
export async function stubLinearAuthorizePage(page: Page) {
  await page.route(`${LINEAR_AUTHORIZE_ORIGIN}/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>Linear OAuth</title>',
    });
  });
}

/** Answers the callback exchange the client makes on its way back from Linear. */
export async function stubLinearCallback(page: Page, workspaceId: string) {
  await page.route('**/integrations/linear/callback/api**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: '00000000-0000-4000-8000-0000000000ad',
        workspace_id: workspaceId,
        provider: 'linear',
        external_account_id: 'linear-e2e-org',
        slug: 'linear_e2e',
        display_name: 'Linear E2E',
        lifecycle_status: 'active',
        capabilities: ['agent_tools'],
        external_url: 'https://linear.app/e2e',
        created_at: '2026-01-15T12:00:00.000Z',
        updated_at: '2026-01-15T12:00:00.000Z',
      }),
    });
  });
}
