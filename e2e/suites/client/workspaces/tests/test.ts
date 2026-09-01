import {test as base, expect} from '@shipfox/e2e-core/playwright';
import {type GiteaFixtures, giteaHelper} from '@shipfox/e2e-driver-gitea';
import {type WorkspaceFixtures, workspaceFixtures} from '@shipfox/e2e-kit/fixtures';
import {SetupShell, TopNav, WorkspaceSwitcher} from '@shipfox/e2e-kit/ui';
import {
  type IntegrationsScreenFixtures,
  integrationsScreens,
} from '@shipfox/e2e-screens-integrations';
import {type WorkspacesScreenFixtures, workspacesScreens} from '@shipfox/e2e-screens-workspaces';
import type {Page} from '@shipfox/playwright';

interface WorkspacesShellFixtures {
  setupShell: SetupShell;
  topNav: TopNav;
  workspaceSwitcher: WorkspaceSwitcher;
}

const workspacesShellFixtures = {
  setupShell: async ({page}: {page: Page}, use: (fixture: SetupShell) => Promise<void>) => {
    await use(new SetupShell(page));
  },
  topNav: async ({page}: {page: Page}, use: (fixture: TopNav) => Promise<void>) => {
    await use(new TopNav(page));
  },
  workspaceSwitcher: async (
    {page}: {page: Page},
    use: (fixture: WorkspaceSwitcher) => Promise<void>,
  ) => {
    await use(new WorkspaceSwitcher(page));
  },
};

export const test = base.extend<
  WorkspaceFixtures &
    GiteaFixtures &
    IntegrationsScreenFixtures &
    WorkspacesScreenFixtures &
    WorkspacesShellFixtures
>({
  ...workspaceFixtures,
  ...giteaHelper,
  ...integrationsScreens,
  ...workspacesScreens,
  ...workspacesShellFixtures,
});
export {expect};
