import {Dialog, SettingsShell} from '@shipfox/e2e-kit/ui';
import type {Page} from '@shipfox/playwright';

type Locator = ReturnType<Page['locator']>;
type FixtureUse<T> = (fixture: T) => Promise<void>;
const LAST_WORKSPACE_KEY = 'shipfox.lastWorkspaceId';
const SETUP_INDICATOR_NAME_RE = /Get started/u;
const SETUP_STATUS_NAME_RE = /^(?:\d+ of \d+ done|You're set up)$/u;
const SETUP_DIALOG_NAME_RE = /Get started/u;
const SETTINGS_ROOT_URL_RE = /\/settings(?:\/members)?\/?$/u;
const SHOW_ALL_STEPS_NAME_RE = /^Show all \d+ steps$/u;
// Bounds one in-app route change. A client-side click is fast when it lands, so
// this only has to be long enough to absorb CI scheduling noise before the
// caller recovers with a document load.
const IN_APP_NAVIGATION_TIMEOUT_MS = 5_000;

function lastWorkspaceStorageKey(principalId: string): string {
  return `${LAST_WORKSPACE_KEY}.principal.${encodeURIComponent(principalId)}`;
}

export class WorkspaceOnboardingScreen {
  constructor(private readonly page: Page) {}

  async gotoRoot(): Promise<void> {
    await this.page.goto('/');
  }

  async gotoWorkspace(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Create your workspace'});
  }

  workspaceNameField(): Locator {
    return this.page.getByLabel('Workspace name');
  }

  createWorkspaceButton(): Locator {
    return this.page.getByRole('button', {name: 'Create workspace'});
  }

  async createWorkspace(name: string): Promise<void> {
    await this.workspaceNameField().fill(name);
    await this.createWorkspaceButton().click();
  }
}

export class WorkspaceHomeScreen {
  constructor(private readonly page: Page) {}

  async gotoRoot(): Promise<void> {
    await this.page.goto('/');
  }

  async goto(workspaceSlug: string): Promise<void> {
    const workspacePath = `/w/${workspaceSlug}`;
    const workspaceUrlRe = new RegExp(`/w/${workspaceSlug}/?$`, 'u');
    if (!this.isBlank() && new URL(this.page.url()).pathname === workspacePath) return;
    const followed = await this.followMountedLink(workspaceUrlRe, [
      `a[role="tab"][href="${workspacePath}"]`,
      `a[aria-current="page"][href="${workspacePath}"]`,
    ]);
    if (!followed) {
      await this.page.goto(workspacePath, {waitUntil: 'commit'});
      await this.page.waitForURL(workspaceUrlRe);
    }
    await this.page
      .locator(`a[role="tab"][href="${workspacePath}"][aria-selected="true"]`)
      .waitFor({state: 'visible'});
  }

  async gotoIntegrations(workspaceSlug: string): Promise<void> {
    const integrationsPath = `/w/${workspaceSlug}/integrations`;
    if (new URL(this.page.url()).pathname === integrationsPath) return;
    await this.page.goto(integrationsPath, {waitUntil: 'commit'});
    await this.page.waitForURL(new RegExp(`/w/${workspaceSlug}/integrations/?$`, 'u'));
  }

  async gotoSettings(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/settings`);
  }

  async gotoSettingsGeneral(): Promise<void> {
    await this.gotoSettingsSection('General');
  }

  async gotoSettingsIntegrations(): Promise<void> {
    await this.gotoSettingsSection('Integrations');
  }

  private async gotoSettingsSection(section: 'General' | 'Integrations'): Promise<void> {
    const sectionPath = `/settings/${section.toLowerCase()}`;
    const sectionUrlRe = new RegExp(`${sectionPath}/?$`, 'u');
    if (await this.followSettingsNavigation(section, sectionUrlRe)) return;
    const [, workspaceSegment, workspaceSlug] = new URL(this.page.url()).pathname.split('/');
    if (workspaceSegment !== 'w' || !workspaceSlug) {
      throw new Error(`Cannot reach ${sectionPath} from ${this.page.url()}`);
    }
    await this.page.goto(`/w/${workspaceSlug}${sectionPath}`, {waitUntil: 'commit'});
    await this.page.waitForURL(sectionUrlRe);
  }

  private async followSettingsNavigation(
    section: 'General' | 'Integrations',
    sectionUrlRe: RegExp,
  ): Promise<boolean> {
    try {
      await this.settingsTab().click({noWaitAfter: true, timeout: IN_APP_NAVIGATION_TIMEOUT_MS});
      await this.page.waitForURL(SETTINGS_ROOT_URL_RE, {timeout: IN_APP_NAVIGATION_TIMEOUT_MS});
      await this.page
        .getByRole('navigation', {name: 'Workspace settings'})
        .getByRole('link', {name: section, exact: true})
        .click({noWaitAfter: true, timeout: IN_APP_NAVIGATION_TIMEOUT_MS});
      await this.page.waitForURL(sectionUrlRe, {timeout: IN_APP_NAVIGATION_TIMEOUT_MS});
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clicks the first mounted link whose selector matches exactly once, so an
   * in-app route change replaces a dev-server document load. Reports whether
   * the route settled: a client-side click that loses to a re-render or to a
   * competing navigation raises nothing, it just leaves a URL that never
   * changes, which would otherwise hold `waitForURL` until the test times out.
   */
  private async followMountedLink(targetUrlRe: RegExp, selectors: string[]): Promise<boolean> {
    if (this.isBlank()) return false;
    for (const selector of selectors) {
      const link = this.page.locator(selector);
      if ((await link.count()) !== 1) continue;
      try {
        await link.click({noWaitAfter: true, timeout: IN_APP_NAVIGATION_TIMEOUT_MS});
        await this.page.waitForURL(targetUrlRe, {timeout: IN_APP_NAVIGATION_TIMEOUT_MS});
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  private isBlank(): boolean {
    return this.page.url() === 'about:blank';
  }

  settingsTab(): Locator {
    return this.page.getByRole('tab', {name: 'Settings'});
  }

  createProjectNameField(): Locator {
    return this.page.getByLabel('Project name');
  }

  createProjectButton(): Locator {
    return this.page.getByRole('button', {name: 'Create project'});
  }

  async createProject(name: string): Promise<void> {
    await this.createProjectNameField().fill(name);
    await this.createProjectButton().click();
  }

  showSetupGuideButton(): Locator {
    return this.page.getByRole('button', {name: 'Show the setup guide'});
  }

  currentWorkspaceSlug(): string | undefined {
    return new URL(this.page.url()).pathname.split('/')[2];
  }

  async readMaybeLastWorkspaceId(principalId: string): Promise<string | undefined> {
    const key = lastWorkspaceStorageKey(principalId);
    const raw = await this.page.evaluate((key) => window.localStorage.getItem(key), key);
    if (!raw) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    return typeof parsed === 'string' ? parsed : undefined;
  }

  async readLastWorkspaceId(principalId: string): Promise<string> {
    const key = lastWorkspaceStorageKey(principalId);
    const workspaceId = await this.readMaybeLastWorkspaceId(principalId);
    if (workspaceId === undefined) {
      throw new Error(`localStorage[${key}] is not set`);
    }
    return workspaceId;
  }
}

export class WorkspaceSetupChecklistScreen {
  constructor(private readonly page: Page) {}

  panel(): Locator {
    return this.page.getByRole('main').getByRole('region', {name: 'Get started'});
  }

  indicator(): Locator {
    return this.page.getByRole('button', {name: SETUP_INDICATOR_NAME_RE});
  }

  row(title: string | RegExp): Locator {
    return this.panel().getByRole('listitem').filter({hasText: title});
  }

  heading(): Locator {
    return this.panel().getByRole('heading', {name: 'Get started'});
  }

  firstRow(): Locator {
    return this.panel().getByRole('listitem').first();
  }

  async expandAllStepsIfNeeded(): Promise<void> {
    const expandButton = this.panel().getByRole('button', {name: SHOW_ALL_STEPS_NAME_RE});
    if ((await expandButton.count()) === 1) {
      await expandButton.click();
    }
  }

  connectLink(): Locator {
    return this.panel().getByRole('link', {name: 'Connect'});
  }

  text(text: string | RegExp): Locator {
    return this.panel().getByText(text);
  }

  countLabel(count: string | RegExp): Locator {
    return this.panel().getByText(count);
  }

  hideButton(): Locator {
    return this.panel().getByRole('button', {name: 'Hide setup guide'});
  }

  completionMessage(): Locator {
    return this.dialog().getByText("You're set up");
  }

  status(): Locator {
    return this.page.getByRole('status').filter({hasText: SETUP_STATUS_NAME_RE});
  }

  doneButton(): Locator {
    return this.dialog().getByRole('button', {name: 'Done', exact: true});
  }

  dialog(): Locator {
    return this.page.getByRole('dialog', {name: SETUP_DIALOG_NAME_RE});
  }
}
export class MembersSettingsScreen {
  private readonly shell: SettingsShell;

  constructor(private readonly page: Page) {
    this.shell = new SettingsShell(page);
  }

  async goto(workspaceSlug: string): Promise<void> {
    await this.shell.goto(workspaceSlug, 'members');
  }

  async gotoDefault(workspaceSlug: string): Promise<void> {
    await this.page.goto(`/w/${workspaceSlug}/settings`);
  }

  heading(): Locator {
    return this.page.getByRole('heading', {name: 'Members'});
  }

  pendingInvitationsHeading(): Locator {
    return this.page.getByRole('heading', {name: 'Pending invitations'});
  }

  emptyPendingInvitations(): Locator {
    return this.page.getByText('No pending invitations.');
  }

  memberText(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  memberRow(text: string | RegExp): Locator {
    return this.page.getByRole('row', {name: text});
  }

  async memberCellText(rowName: string | RegExp, index: number): Promise<string> {
    return (await this.memberRow(rowName).getByRole('cell').nth(index).innerText()).trim();
  }

  inviteButton(): Locator {
    return this.page.getByRole('button', {name: 'Invite member'});
  }

  async openInviteDialog(): Promise<Dialog> {
    await this.inviteButton().click();
    const dialog = new Dialog(this.page, 'Invite a member');
    await dialog.expectVisible();
    return dialog;
  }

  pendingInvitationRow(email: string | RegExp): Locator {
    return this.page.getByRole('row', {name: email});
  }

  async pendingInvitationExpiresText(email: string | RegExp): Promise<string> {
    return (await this.pendingInvitationRow(email).getByRole('cell').nth(2).innerText()).trim();
  }

  revokeInvitationButton(): Locator {
    return this.page.getByRole('button', {name: 'Revoke invitation'});
  }

  confirmRevokeButton(): Locator {
    return this.page.getByRole('button', {name: 'Revoke'});
  }
}

export class InvitationAcceptScreen {
  constructor(private readonly page: Page) {}

  async goto(rawToken?: string): Promise<void> {
    const suffix = rawToken === undefined ? '' : `?token=${encodeURIComponent(rawToken)}`;
    await this.page.goto(`/invitations/accept${suffix}`);
  }

  heading(name: string | RegExp): Locator {
    return this.page.getByRole('heading', {name});
  }

  message(text: string | RegExp): Locator {
    return this.page.getByText(text);
  }

  link(name: string | RegExp): Locator {
    return this.page.getByRole('link', {name});
  }

  field(name: string | RegExp): Locator {
    return this.page.getByLabel(name);
  }

  button(name: string | RegExp): Locator {
    return this.page.getByRole('button', {name});
  }
}

export interface WorkspacesScreenFixtures {
  invitationAccept: InvitationAcceptScreen;
  membersSettings: MembersSettingsScreen;
  workspaceHome: WorkspaceHomeScreen;
  workspaceOnboarding: WorkspaceOnboardingScreen;
  workspaceSetupChecklist: WorkspaceSetupChecklistScreen;
}

export const workspacesScreens = {
  invitationAccept: async ({page}: {page: Page}, use: FixtureUse<InvitationAcceptScreen>) => {
    await use(new InvitationAcceptScreen(page));
  },
  membersSettings: async ({page}: {page: Page}, use: FixtureUse<MembersSettingsScreen>) => {
    await use(new MembersSettingsScreen(page));
  },
  workspaceHome: async ({page}: {page: Page}, use: FixtureUse<WorkspaceHomeScreen>) => {
    await use(new WorkspaceHomeScreen(page));
  },
  workspaceOnboarding: async ({page}: {page: Page}, use: FixtureUse<WorkspaceOnboardingScreen>) => {
    await use(new WorkspaceOnboardingScreen(page));
  },
  workspaceSetupChecklist: async (
    {page}: {page: Page},
    use: FixtureUse<WorkspaceSetupChecklistScreen>,
  ) => {
    await use(new WorkspaceSetupChecklistScreen(page));
  },
};
