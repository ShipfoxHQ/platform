import {Dialog, SettingsShell, Toast} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

export class CustomModelProviderScreen {
  private readonly shell: SettingsShell;
  private readonly toast: Toast;

  constructor(private readonly page: Page) {
    this.shell = new SettingsShell(page);
    this.toast = new Toast(page);
  }

  async goto(workspaceSlug: string): Promise<void> {
    await this.shell.goto(workspaceSlug, 'agents');
  }

  configuredProvidersSection(): Locator {
    return this.page.locator('section[aria-label="Configured providers"]');
  }

  configuredProviderRow(label: string): Locator {
    return this.configuredProvidersSection()
      .locator('li')
      .filter({has: this.page.getByText(label, {exact: true})});
  }

  async openCreateDialog(): Promise<Dialog> {
    await this.page.getByRole('button', {name: 'Configure custom provider'}).click();
    const dialog = new Dialog(this.page, 'Add custom provider');
    await dialog.expectVisible();
    return dialog;
  }

  async fillProviderIdentity(
    dialog: Dialog,
    params: {displayName: string; providerId: string; baseUrl: string},
  ): Promise<void> {
    await dialog.fill('Display name', params.displayName);
    await dialog.fill('Provider ID', params.providerId);
    await dialog.fill('Base URL', params.baseUrl);
  }

  async fetchModels(dialog: Dialog): Promise<void> {
    await dialog.confirm('Fetch models');
  }

  defaultModelField(dialog: Dialog): Locator {
    return dialog.field('Default model');
  }

  discoveredModelOption(dialog: Dialog, modelId: string): Locator {
    return this.defaultModelField(dialog).locator('option').filter({hasText: modelId});
  }

  firstModelIdField(dialog: Dialog): Locator {
    return dialog.field('Model id').first();
  }

  firstModelLabelField(dialog: Dialog): Locator {
    return dialog.field('Label').first();
  }

  async save(dialog: Dialog): Promise<void> {
    await dialog.confirm('Test & save');
  }

  async expectSavedToast(text: string | RegExp): Promise<void> {
    await this.toast.expectVisible(text);
  }

  async openEditDialog(displayName: string): Promise<Dialog> {
    await this.configuredProviderRow(displayName)
      .getByRole('button', {name: `Open ${displayName} provider actions`})
      .click();
    await this.page.getByRole('menuitem', {name: 'Edit'}).click();
    const dialog = new Dialog(this.page, `Edit ${displayName}`);
    await dialog.expectVisible();
    return dialog;
  }

  async openDeleteDialog(displayName: string): Promise<Dialog> {
    await this.configuredProviderRow(displayName)
      .getByRole('button', {name: `Open ${displayName} provider actions`})
      .click();
    await this.page.getByRole('menuitem', {name: 'Delete'}).click();
    const dialog = new Dialog(this.page, 'Delete model provider');
    await dialog.expectVisible();
    return dialog;
  }
}

export class AgentAccessSettingsScreen {
  constructor(private readonly page: Page) {}

  async goto(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/settings/agent-access`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'MCP connections', exact: true});
  }

  connectedAppsHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Connected apps', exact: true});
  }

  emptyState(): Locator {
    return this.page.getByText('No connected apps', {exact: true});
  }

  connectedAppRow(clientName: string): Locator {
    return this.page.getByRole('row').filter({hasText: clientName});
  }

  async openDisconnectDialog(clientName: string): Promise<Dialog> {
    await this.connectedAppRow(clientName)
      .getByRole('button', {name: `Disconnect ${clientName}`, exact: true})
      .click();
    const dialog = new Dialog(this.page, `Disconnect ${clientName}?`);
    await dialog.expectVisible();
    return dialog;
  }
}

export class OAuthConsentScreen {
  constructor(private readonly page: Page) {}

  heading(clientName: string): Locator {
    return this.page.getByRole('heading', {
      name: `Allow ${clientName} to access Shipfox?`,
      exact: true,
    });
  }

  identityText(text: string): Locator {
    return this.page.getByText(text, {exact: true});
  }

  denyButton(): Locator {
    return this.page.getByRole('button', {name: 'Deny', exact: true});
  }

  allowButton(): Locator {
    return this.page.getByRole('button', {name: 'Allow access', exact: true});
  }
}

export interface AgentScreenFixtures {
  agentAccessSettings: AgentAccessSettingsScreen;
  customModelProviders: CustomModelProviderScreen;
  oauthConsent: OAuthConsentScreen;
}

export const agentScreens = {
  agentAccessSettings: async ({page}: {page: Page}, use: FixtureUse<AgentAccessSettingsScreen>) => {
    await use(new AgentAccessSettingsScreen(page));
  },
  customModelProviders: async (
    {page}: {page: Page},
    use: FixtureUse<CustomModelProviderScreen>,
  ) => {
    await use(new CustomModelProviderScreen(page));
  },
  oauthConsent: async ({page}: {page: Page}, use: FixtureUse<OAuthConsentScreen>) => {
    await use(new OAuthConsentScreen(page));
  },
};
