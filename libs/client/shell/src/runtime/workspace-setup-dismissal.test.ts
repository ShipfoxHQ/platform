// @vitest-environment jsdom
import {
  clearWorkspaceSetupChecklistDismissal,
  dismissWorkspaceSetupChecklist,
  isWorkspaceSetupChecklistDismissed,
} from './workspace-setup-dismissal.js';

const DISMISSED_KEY = 'shipfox.workspaceSetupChecklist.dismissed.workspace.workspace';

describe('workspace-setup dismissal storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('reads not dismissed before anything is stored', () => {
    expect(isWorkspaceSetupChecklistDismissed('workspace')).toBe(false);
  });

  test('dismiss writes a workspace-scoped persistent flag', () => {
    dismissWorkspaceSetupChecklist('workspace');

    expect(isWorkspaceSetupChecklistDismissed('workspace')).toBe(true);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBe('true');
  });

  test('the flag is scoped per workspace', () => {
    dismissWorkspaceSetupChecklist('workspace');

    expect(isWorkspaceSetupChecklistDismissed('workspace')).toBe(true);
    expect(isWorkspaceSetupChecklistDismissed('other-workspace')).toBe(false);
  });

  test('clear removes the flag', () => {
    dismissWorkspaceSetupChecklist('workspace');
    clearWorkspaceSetupChecklistDismissal('workspace');

    expect(isWorkspaceSetupChecklistDismissed('workspace')).toBe(false);
    expect(window.localStorage.getItem(DISMISSED_KEY)).toBeNull();
  });

  test('tolerates an unparsable persisted value', () => {
    window.localStorage.setItem(DISMISSED_KEY, 'not-a-boolean');

    expect(isWorkspaceSetupChecklistDismissed('workspace')).toBe(false);
  });

  test('degrades gracefully when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => isWorkspaceSetupChecklistDismissed('workspace')).not.toThrow();
    expect(isWorkspaceSetupChecklistDismissed('workspace')).toBe(false);
    expect(() => dismissWorkspaceSetupChecklist('workspace')).not.toThrow();
    expect(() => clearWorkspaceSetupChecklistDismissal('workspace')).not.toThrow();
  });
});
