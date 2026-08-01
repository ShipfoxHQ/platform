import {DataTableRow, Dialog, SettingsShell} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

export class RunnerTokensScreen {
  private readonly shell: SettingsShell;

  constructor(private readonly page: Page) {
    this.shell = new SettingsShell(page);
  }

  async gotoManualTokens(workspaceSlug: string): Promise<void> {
    await this.shell.goto(workspaceSlug, 'runners');
  }

  async gotoProvisionerTokens(workspaceSlug: string): Promise<void> {
    await this.shell.goto(workspaceSlug, 'provisioners');
  }

  manualTokensSection(): Locator {
    return this.page.locator('section', {hasText: 'Runner registration tokens'});
  }

  provisionerTokensSection(): Locator {
    return this.page.locator('section', {hasText: 'Runner provisioner registration tokens'});
  }

  manualTokenRow(name: string): Locator {
    return new DataTableRow(this.manualTokensSection(), name).row;
  }

  provisionerTokenRow(name: string): Locator {
    return new DataTableRow(this.provisionerTokensSection(), name).row;
  }

  manualTokenCell(name: string, index: number): Locator {
    return new DataTableRow(this.manualTokensSection(), name).cell(index);
  }

  provisionerTokenCell(name: string, index: number): Locator {
    return new DataTableRow(this.provisionerTokensSection(), name).cell(index);
  }

  manualEmptyState(): Locator {
    return this.manualTokensSection().getByText('No usable manual registration tokens');
  }

  provisionerEmptyState(): Locator {
    return this.provisionerTokensSection().getByText('No usable provisioner registration tokens');
  }

  async openManualCreateDialog(): Promise<Dialog> {
    await this.manualTokensSection().getByRole('button', {name: 'Create token'}).click();
    const dialog = new Dialog(this.page, 'Create manual registration token');
    await dialog.expectVisible();
    return dialog;
  }

  async openProvisionerCreateDialog(): Promise<Dialog> {
    await this.provisionerTokensSection().getByRole('button', {name: 'Create token'}).click();
    const dialog = new Dialog(this.page, 'Create provisioner registration token');
    await dialog.expectVisible();
    return dialog;
  }

  rawToken(dialog: Dialog, tokenPrefix: RegExp): Locator {
    return dialog.locator().locator('p.font-code').filter({hasText: tokenPrefix});
  }

  async createTokenFromDialog(dialog: Dialog, name: string): Promise<void> {
    await dialog.fill('Token name', name);
    await dialog.confirm('Create token');
  }

  async openManualRevokeDialog(name: string): Promise<Dialog> {
    await this.manualTokenRow(name)
      .getByRole('button', {name: `Open ${name} registration token actions`})
      .click();
    await this.page.getByRole('menuitem', {name: 'Revoke token'}).click();
    const dialog = new Dialog(this.page, 'Revoke token');
    await dialog.expectVisible();
    return dialog;
  }

  async openProvisionerRevokeDialog(name: string): Promise<Dialog> {
    await this.provisionerTokenRow(name)
      .getByRole('button', {name: `Open ${name} token actions`})
      .click();
    await this.page.getByRole('menuitem', {name: 'Revoke token'}).click();
    const dialog = new Dialog(this.page, 'Revoke token');
    await dialog.expectVisible();
    return dialog;
  }
}

export interface RunnerScreenFixtures {
  runnerTokens: RunnerTokensScreen;
}

export const runnerScreens = {
  runnerTokens: async ({page}: {page: Page}, use: FixtureUse<RunnerTokensScreen>) => {
    await use(new RunnerTokensScreen(page));
  },
};
