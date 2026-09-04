import {SettingsShell, Toast} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;
const SELECTED_REPOSITORY_MODE_RE = /Only your projects' repositories/u;
const ALL_REPOSITORY_MODE_RE = /Every repository this integration can access/u;

export class IntegrationsCatalogueScreen {
  private readonly shell: SettingsShell;

  constructor(private readonly page: Page) {
    this.shell = new SettingsShell(page);
  }

  async goto(workspaceSlug: string): Promise<void> {
    await this.shell.goto(workspaceSlug, 'integrations');
  }

  availableHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Available integrations'});
  }

  installLink(name: string): Locator {
    return this.page.getByRole('link', {name: `Install ${name}`});
  }

  emptyInstalledState(): Locator {
    return this.page.getByText('No integrations installed yet');
  }

  installedSection(): Locator {
    return this.page.locator('section[aria-label="Installed integrations"]');
  }

  installedProviderName(name: string): Locator {
    return this.installedSection().getByText(name, {exact: true});
  }

  installedStatus(text: string | RegExp): Locator {
    return this.installedSection().getByText(text);
  }

  installedActionsButton(name: string): Locator {
    return this.installedSection().getByLabel(`Open ${name} integration actions`);
  }
}

export class SourceControlSetupScreen {
  constructor(private readonly page: Page) {}

  async gotoRoot(): Promise<void> {
    await this.page.goto('/');
  }

  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/integrations`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Install source control'});
  }

  agentHarnessHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Choose agent harness'});
  }

  providerLink(workspaceSlug: string, provider: string): Locator {
    return this.page.locator(`a[href$="/w/${workspaceSlug}/integrations/${provider}"]`);
  }

  skipModelProviderButton(): Locator {
    return this.page.getByRole('button', {name: 'Skip for now'});
  }

  projectTab(): Locator {
    return this.page.getByRole('tab', {name: 'Projects'});
  }

  settingsTab(): Locator {
    return this.page.getByRole('tab', {name: 'Settings'});
  }

  projectSwitcher(): Locator {
    return this.page.getByLabel('Switch project');
  }

  workspaceSwitcher(): Locator {
    return this.page.getByLabel('Switch workspace');
  }
}

export class ProviderInstallScreen {
  private readonly toast: Toast;

  constructor(private readonly page: Page) {
    this.toast = new Toast(page);
  }

  async goto(workspaceSlug: string, provider: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/integrations/${provider}`);
  }

  organizationField(): Locator {
    return this.page.getByLabel('Organization');
  }

  async installOrganization(name: string): Promise<void> {
    await this.organizationField().fill(name);
    await this.page.getByRole('button', {name: 'Install'}).click();
  }

  async expectInstalled(message: string): Promise<void> {
    await this.toast.expectVisible(message);
  }
}

export class ConnectionDetailsScreen {
  private readonly toast: Toast;

  constructor(private readonly page: Page) {
    this.toast = new Toast(page);
  }

  async goto(workspaceSlug: string, connectionSlug: string): Promise<void> {
    await this.page.goto(
      `/w/${workspaceSlug}/settings/integrations/${encodeURIComponent(connectionSlug)}`,
    );
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Repository access'});
  }

  selectedMode(): Locator {
    return this.page.getByRole('radio', {name: SELECTED_REPOSITORY_MODE_RE});
  }

  allMode(): Locator {
    return this.page.getByRole('radio', {name: ALL_REPOSITORY_MODE_RE});
  }

  projectsRepositoriesHeading(): Locator {
    return this.page.getByRole('heading', {name: "Your projects' repositories"});
  }

  repository(name: string): Locator {
    return this.page.getByText(name, {exact: true});
  }

  saveButton(): Locator {
    return this.page.getByRole('button', {name: 'Save changes'});
  }

  async saveMode(): Promise<void> {
    const saveResponse = this.page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname.endsWith('/repository-access'),
    );
    await Promise.all([saveResponse, this.saveButton().click()]);
    await this.toast.expectVisible('Access mode saved.');
  }

  providerNotice(): Locator {
    return this.page.getByRole('link', {name: 'Change repositories on GitHub'});
  }
}

export class SentryCallbackScreen {
  constructor(private readonly page: Page) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Install Sentry'});
  }

  message(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  installButton(): Locator {
    return this.page.getByRole('button', {name: 'Install'});
  }

  retryButton(): Locator {
    return this.page.getByRole('button', {name: 'Retry'});
  }

  backToShipfoxLink(): Locator {
    return this.page.getByRole('link', {name: 'Back to Shipfox'});
  }

  startOverLink(): Locator {
    return this.page.getByRole('link', {name: 'Start over'});
  }
}

export interface IntegrationsScreenFixtures {
  integrationsCatalogue: IntegrationsCatalogueScreen;
  connectionDetails: ConnectionDetailsScreen;
  providerInstall: ProviderInstallScreen;
  sentryCallback: SentryCallbackScreen;
  sourceControlSetup: SourceControlSetupScreen;
}

export const integrationsScreens = {
  integrationsCatalogue: async (
    {page}: {page: Page},
    use: FixtureUse<IntegrationsCatalogueScreen>,
  ) => {
    await use(new IntegrationsCatalogueScreen(page));
  },
  connectionDetails: async ({page}: {page: Page}, use: FixtureUse<ConnectionDetailsScreen>) => {
    await use(new ConnectionDetailsScreen(page));
  },
  providerInstall: async ({page}: {page: Page}, use: FixtureUse<ProviderInstallScreen>) => {
    await use(new ProviderInstallScreen(page));
  },
  sentryCallback: async ({page}: {page: Page}, use: FixtureUse<SentryCallbackScreen>) => {
    await use(new SentryCallbackScreen(page));
  },
  sourceControlSetup: async ({page}: {page: Page}, use: FixtureUse<SourceControlSetupScreen>) => {
    await use(new SourceControlSetupScreen(page));
  },
};
