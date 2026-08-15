import {beforeEach, describe, expect, it, vi} from '@shipfox/vitest/vi';

const expectMock = vi.fn();
const toHaveURL = vi.fn();
const toBeVisible = vi.fn();
const toHaveAttribute = vi.fn();

type SettingsTab =
  | 'members'
  | 'runners'
  | 'provisioners'
  | 'agents'
  | 'secrets'
  | 'variables'
  | 'integrations'
  | 'events';

const settingsTabLabels: Record<SettingsTab, string> = {
  members: 'Members',
  runners: 'Runners',
  provisioners: 'Runner provisioners',
  agents: 'Agents',
  secrets: 'Secrets',
  variables: 'Variables',
  integrations: 'Integrations',
  events: 'Events',
};

function settingsPath(workspaceSlug: string, tab: SettingsTab): string {
  return `/w/${workspaceSlug}/settings/${tab}`;
}

function locator(name: string) {
  return {
    name,
    click: vi.fn(),
    fill: vi.fn(),
    innerText: vi.fn(),
    getByLabel: vi.fn((label: unknown) => locator(`label:${String(label)}`)),
    getByRole: vi.fn((role: string, options?: {name?: unknown}) =>
      locator(`${role}:${String(options?.name)}`),
    ),
    getByText: vi.fn((text: unknown) => locator(`text:${String(text)}`)),
    locator: vi.fn((selector: string) => locator(selector)),
    nth: vi.fn((index: number) => locator(`nth:${index}`)),
  };
}

function page() {
  return {
    goto: vi.fn(),
    getByLabel: vi.fn((label: unknown) => locator(`label:${String(label)}`)),
    getByPlaceholder: vi.fn((placeholder: string) => locator(`placeholder:${placeholder}`)),
    getByRole: vi.fn((role: string, options?: {name?: unknown}) =>
      locator(`${role}:${String(options?.name)}`),
    ),
    getByText: vi.fn((text: unknown) => locator(`text:${String(text)}`)),
  };
}

describe('ui page objects', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    expectMock.mockReturnValue({toHaveURL, toBeVisible, toHaveAttribute});
    vi.doMock('@shipfox/playwright', () => ({
      expect: expectMock,
    }));
  });

  it('exposes the top-nav accessible labels', async () => {
    const pageObject = page();
    const {TopNav} = await import('./page-objects.js');
    const nav = new TopNav(pageObject as never);

    nav.currentWorkspace('Platform');
    nav.workspaceSwitcherTrigger();
    nav.projectSwitcherTrigger();
    nav.userMenuTrigger();

    expect(pageObject.getByRole).toHaveBeenCalledWith('link', {name: 'Platform', exact: true});
    expect(pageObject.getByLabel).toHaveBeenCalledWith('Switch workspace');
    expect(pageObject.getByLabel).toHaveBeenCalledWith('Switch project');
    expect(pageObject.getByLabel).toHaveBeenCalledWith('User menu');
  });

  it('wires workspace switcher controls to stable selectors', async () => {
    const pageObject = page();
    const {WorkspaceSwitcher} = await import('./page-objects.js');
    const switcher = new WorkspaceSwitcher(pageObject as never);

    switcher.searchInput();
    switcher.workspaceOption('Platform');
    switcher.createWorkspaceOption();
    switcher.noResults();

    expect(pageObject.getByPlaceholder).toHaveBeenCalledWith('Search workspaces...');
    expect(pageObject.getByRole).toHaveBeenCalledWith('option', {name: 'Platform'});
    expect(pageObject.getByRole).toHaveBeenCalledWith('option', {name: 'Create workspace'});
    expect(pageObject.getByText).toHaveBeenCalledWith('No workspaces found.');
  });

  it('exposes setup shell navigation affordances', async () => {
    const pageObject = page();
    const {SetupShell} = await import('./page-objects.js');
    const setup = new SetupShell(pageObject as never);

    setup.sourceControlHeading();
    setup.agentHarnessHeading();
    setup.projectTab();
    setup.settingsTab();
    setup.projectSwitcher();
    setup.workspaceSwitcher();

    expect(pageObject.getByRole).toHaveBeenCalledWith('heading', {name: 'Install source control'});
    expect(pageObject.getByRole).toHaveBeenCalledWith('heading', {
      name: 'Choose agent harness',
    });
    expect(pageObject.getByRole).toHaveBeenCalledWith('tab', {name: 'Projects'});
    expect(pageObject.getByRole).toHaveBeenCalledWith('tab', {name: 'Settings'});
    expect(pageObject.getByLabel).toHaveBeenCalledWith('Switch project');
    expect(pageObject.getByLabel).toHaveBeenCalledWith('Switch workspace');
  });

  it.each(
    Object.entries(settingsTabLabels) as Array<[SettingsTab, string]>,
  )('maps the %s settings tab to its route and nav label', async (tab, label) => {
    const pageObject = page();
    const nav = locator('nav');
    const link = locator('link');
    pageObject.getByRole.mockReturnValue(nav);
    nav.getByRole.mockReturnValue(link);
    const {SettingsShell} = await import('./page-objects.js');
    const shell = new SettingsShell(pageObject as never);

    await shell.goto('workspace-1', tab);

    expect(pageObject.goto).toHaveBeenCalledWith(settingsPath('workspace-1', tab));
    expect(expectMock).toHaveBeenCalledWith(pageObject);
    expect(toHaveURL).toHaveBeenCalledWith(
      new RegExp(`${settingsPath('workspace-1', tab)}/?$`, 'u'),
    );
    expect(nav.getByRole).toHaveBeenCalledWith('link', {name: label});
    expect(toHaveAttribute).toHaveBeenCalledWith('aria-current', 'page');
  });

  it('scopes table row lookups to the parent locator', async () => {
    const parent = locator('table');
    const row = locator('row');
    const cells = locator('cells');
    const cell = locator('cell');
    parent.locator.mockReturnValue(row);
    row.locator.mockReturnValue(cells);
    cells.nth.mockReturnValue(cell);
    const {DataTableRow} = await import('./page-objects.js');

    const tableRow = new DataTableRow(parent as never, 'API_TOKEN');
    tableRow.cell(2);
    tableRow.actionMenuButton('Actions for API_TOKEN');

    expect(parent.locator).toHaveBeenCalledWith('tr', {hasText: 'API_TOKEN'});
    expect(row.locator).toHaveBeenCalledWith('td');
    expect(cells.nth).toHaveBeenCalledWith(2);
    expect(row.getByRole).toHaveBeenCalledWith('button', {name: 'Actions for API_TOKEN'});
  });
});
