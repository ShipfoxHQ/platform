import {expect, type Page} from '@shipfox/playwright';

type AppLocator = ReturnType<Page['locator']>;

export type SettingsTab =
  | 'members'
  | 'runners'
  | 'provisioners'
  | 'agents'
  | 'secrets'
  | 'variables'
  | 'integrations'
  | 'events';

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  members: 'Members',
  runners: 'Runners',
  provisioners: 'Runner provisioners',
  agents: 'Agents',
  secrets: 'Secrets',
  variables: 'Variables',
  integrations: 'Integrations',
  events: 'Events',
};

export function settingsPath(workspaceSlug: string, tab: SettingsTab): string {
  return `/w/${workspaceSlug}/settings/${tab}`;
}

export class TopNav {
  constructor(private readonly page: Page) {}

  currentWorkspace(name: string): AppLocator {
    return this.page.getByRole('link', {name, exact: true});
  }

  workspaceSwitcherTrigger(): AppLocator {
    return this.page.getByLabel('Switch workspace');
  }

  projectSwitcherTrigger(): AppLocator {
    return this.page.getByLabel('Switch project');
  }

  userMenuTrigger(): AppLocator {
    return this.page.getByLabel('User menu');
  }
}

export class WorkspaceSwitcher {
  private readonly topNav: TopNav;

  constructor(private readonly page: Page) {
    this.topNav = new TopNav(page);
  }

  async open(): Promise<void> {
    await this.topNav.workspaceSwitcherTrigger().click();
  }

  searchInput(): AppLocator {
    return this.page.getByPlaceholder('Search workspaces...');
  }

  async search(query: string): Promise<void> {
    await this.searchInput().fill(query);
  }

  workspaceOption(name: string | RegExp): AppLocator {
    return this.page.getByRole('option', {name});
  }

  async pickWorkspace(name: string): Promise<void> {
    await this.workspaceOption(name).click();
  }

  createWorkspaceOption(): AppLocator {
    return this.page.getByRole('option', {name: 'Create workspace'});
  }

  async clickCreateWorkspace(): Promise<void> {
    await this.createWorkspaceOption().click();
  }

  noResults(): AppLocator {
    return this.page.getByText('No workspaces found.');
  }

  async pressEnter(): Promise<void> {
    await this.page.keyboard.press('Enter');
  }

  async scrollWorkspaceOptionsToEnd(): Promise<void> {
    await this.page.evaluate(() => {
      let el = document.querySelector('[role="option"]')?.parentElement ?? null;
      while (el && el.scrollHeight <= el.clientHeight) {
        el = el.parentElement;
      }
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}

export class SetupShell {
  constructor(private readonly page: Page) {}

  sourceControlHeading(): AppLocator {
    return this.page.getByRole('heading', {name: 'Install source control'});
  }

  agentHarnessHeading(): AppLocator {
    return this.page.getByRole('heading', {name: 'Choose agent harness'});
  }

  projectTab(): AppLocator {
    return this.page.getByRole('tab', {name: 'Projects'});
  }

  settingsTab(): AppLocator {
    return this.page.getByRole('tab', {name: 'Settings'});
  }

  projectSwitcher(): AppLocator {
    return this.page.getByLabel('Switch project');
  }

  workspaceSwitcher(): AppLocator {
    return this.page.getByLabel('Switch workspace');
  }

  async expectNavigationHidden(): Promise<void> {
    await expect(this.projectTab()).toHaveCount(0);
    await expect(this.settingsTab()).toHaveCount(0);
    await expect(this.projectSwitcher()).toHaveCount(0);
    await expect(this.workspaceSwitcher()).toBeVisible();
  }
}

export class SettingsShell {
  constructor(private readonly page: Page) {}

  async goto(workspaceSlug: string, tab: SettingsTab): Promise<void> {
    await this.page.goto(settingsPath(workspaceSlug, tab));
    await expect(this.page).toHaveURL(new RegExp(`${settingsPath(workspaceSlug, tab)}/?$`, 'u'));
    await expect(this.activeNavLink(tab)).toHaveAttribute('aria-current', 'page');
  }

  nav(): AppLocator {
    return this.page.getByRole('navigation', {name: 'Workspace settings'});
  }

  activeNavLink(tab: SettingsTab): AppLocator {
    return this.nav().getByRole('link', {name: SETTINGS_TAB_LABELS[tab]});
  }
}

export class Dialog {
  constructor(
    private readonly page: Page,
    private readonly name: string | RegExp,
  ) {}

  locator(): AppLocator {
    return this.page.getByRole('dialog', {name: this.name});
  }

  field(label: string | RegExp): AppLocator {
    return this.locator().getByLabel(label);
  }

  async fill(label: string | RegExp, value: string): Promise<void> {
    await this.field(label).fill(value);
  }

  confirmButton(name: string | RegExp): AppLocator {
    return this.locator().getByRole('button', {name});
  }

  async confirm(name: string | RegExp): Promise<void> {
    await this.confirmButton(name).click();
  }

  async expectVisible(): Promise<void> {
    await expect(this.locator()).toBeVisible();
  }

  async expectClosed(): Promise<void> {
    await expect(this.locator()).toBeHidden();
  }
}

export class Toast {
  constructor(private readonly page: Page) {}

  message(text: string | RegExp): AppLocator {
    return this.page.getByText(text);
  }

  async expectVisible(text: string | RegExp): Promise<void> {
    await expect(this.message(text)).toBeVisible();
  }
}

export class DataTableRow {
  readonly row: AppLocator;

  constructor(parent: AppLocator, text: string | RegExp) {
    this.row = parent.locator('tr', {hasText: text});
  }

  cell(index: number): AppLocator {
    return this.row.locator('td').nth(index);
  }

  async cellText(index: number): Promise<string> {
    return await this.cell(index).innerText();
  }

  actionMenuButton(name: string | RegExp): AppLocator {
    return this.row.getByRole('button', {name});
  }

  async openActionMenu(name: string | RegExp): Promise<void> {
    await this.actionMenuButton(name).click();
  }
}
