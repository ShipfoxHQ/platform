import {DataTableRow, Dialog, SettingsShell, Toast} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;

abstract class KeyValueSettingsScreen {
  protected readonly shell: SettingsShell;
  protected readonly toast: Toast;

  constructor(
    protected readonly page: Page,
    private readonly tab: 'secrets' | 'variables',
    private readonly sectionLabel: string,
    private readonly createButtonName: string,
    private readonly createDialogName: string,
    private readonly updateDialogName: string,
    private readonly createdToast: string,
    private readonly updatedToast: string,
    private readonly deletedToast: string,
    private readonly emptyText: string,
  ) {
    this.shell = new SettingsShell(page);
    this.toast = new Toast(page);
  }

  async goto(workspaceSlug: string): Promise<void> {
    await this.shell.goto(workspaceSlug, this.tab);
  }

  section(): Locator {
    return this.page.locator(`section[aria-label="${this.sectionLabel}"]`);
  }

  emptyState(): Locator {
    return this.section().getByText(this.emptyText);
  }

  rowByKey(key: string): Locator {
    return new DataTableRow(this.section(), key).row;
  }

  toastMessage(text: string | RegExp): Locator {
    return this.toast.message(text);
  }

  async openRowActions(key: string): Promise<void> {
    await this.rowByKey(key)
      .getByRole('button', {name: `Actions for ${key}`})
      .click();
  }

  async openCreateDialog(): Promise<Dialog> {
    await this.section().getByRole('button', {name: this.createButtonName}).first().click();
    const dialog = new Dialog(this.page, this.createDialogName);
    await dialog.expectVisible();
    return dialog;
  }

  async create(key: string, value: string): Promise<void> {
    const dialog = await this.openCreateDialog();

    await dialog.fill('Name', key);
    await dialog.locator().getByRole('textbox', {name: 'Value'}).fill(value);
    await dialog.confirm(this.createButtonName);

    await this.toast.expectVisible(this.createdToast);
  }

  async openUpdateDialog(key: string): Promise<Dialog> {
    await this.openRowActions(key);
    await this.page.getByRole('menuitem', {name: 'Edit value'}).click();
    const dialog = new Dialog(this.page, this.updateDialogName);
    await dialog.expectVisible();
    return dialog;
  }

  async updateValue(key: string, value: string): Promise<void> {
    const dialog = await this.openUpdateDialog(key);

    await dialog.locator().getByRole('textbox', {name: 'Value'}).fill(value);
    await dialog.confirm(this.updateDialogName);

    await this.toast.expectVisible(this.updatedToast);
  }

  async delete(key: string): Promise<void> {
    await this.openRowActions(key);
    await this.page.getByRole('menuitem', {name: 'Delete'}).click();
    const dialog = new Dialog(this.page, new RegExp(`Delete ${key}`, 'u'));

    await dialog.confirm('Delete');

    await this.toast.expectVisible(this.deletedToast);
  }
}

export class SecretsSettingsScreen extends KeyValueSettingsScreen {
  constructor(page: Page) {
    super(
      page,
      'secrets',
      'Secrets',
      'Create secret',
      'Create secret',
      'Update secret',
      'Secret created',
      'Secret updated',
      'Secret deleted',
      'No secrets yet',
    );
  }

  async createSecret(key: string, value: string): Promise<void> {
    await this.create(key, value);
  }

  async updateSecretValue(key: string, value: string): Promise<void> {
    await this.updateValue(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    await this.delete(key);
  }

  valueHidden(key: string): Locator {
    return this.rowByKey(key).getByLabel('Value hidden');
  }
}

export class VariablesSettingsScreen extends KeyValueSettingsScreen {
  constructor(page: Page) {
    super(
      page,
      'variables',
      'Variables',
      'Create variable',
      'Create variable',
      'Update variable',
      'Variable created',
      'Variable updated',
      'Variable deleted',
      'No variables yet',
    );
  }

  async createVariable(key: string, value: string): Promise<void> {
    await this.create(key, value);
  }

  async updateVariableValue(key: string, value: string): Promise<void> {
    await this.updateValue(key, value);
  }

  async deleteVariable(key: string): Promise<void> {
    await this.delete(key);
  }
}

export interface SecretsScreenFixtures {
  secretsScreen: SecretsSettingsScreen;
  variablesScreen: VariablesSettingsScreen;
}

export const secretsScreens = {
  secretsScreen: async ({page}: {page: Page}, use: FixtureUse<SecretsSettingsScreen>) => {
    await use(new SecretsSettingsScreen(page));
  },
  variablesScreen: async ({page}: {page: Page}, use: FixtureUse<VariablesSettingsScreen>) => {
    await use(new VariablesSettingsScreen(page));
  },
};
