import {
  type BrowserStorageKey,
  createTypedBrowserStorage,
  localStorageOrUndefined,
} from '@shipfox/client-ui';

const workspaceSetupChecklistDismissalKey = {
  key: 'shipfox.workspaceSetupChecklist.dismissed',
  lifetime: 'persistent',
  principalScope: 'workspace',
  serialize: (dismissed: boolean) => JSON.stringify(dismissed),
  parse: (raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'boolean' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
} satisfies BrowserStorageKey<boolean>;

export const WORKSPACE_SETUP_CHECKLIST_DISMISSAL_EVENT =
  'shipfox.workspaceSetupChecklist.dismissalChanged';

/**
 * Reads whether the checklist was dismissed on this device at call time.
 * Consumers that mount the value as UI state own any re-read or subscription.
 */
export function isWorkspaceSetupChecklistDismissed(workspaceId: string): boolean {
  return workspaceSetupChecklistDismissalStorage(workspaceId).read() === true;
}

export function dismissWorkspaceSetupChecklist(workspaceId: string): void {
  workspaceSetupChecklistDismissalStorage(workspaceId).write(true);
  dispatchWorkspaceSetupChecklistDismissalChange();
}

export function clearWorkspaceSetupChecklistDismissal(workspaceId: string): void {
  workspaceSetupChecklistDismissalStorage(workspaceId).remove();
  dispatchWorkspaceSetupChecklistDismissalChange();
}

function dispatchWorkspaceSetupChecklistDismissalChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(WORKSPACE_SETUP_CHECKLIST_DISMISSAL_EVENT));
}

function workspaceSetupChecklistDismissalStorage(workspaceId: string) {
  return createTypedBrowserStorage(localStorageOrUndefined, workspaceSetupChecklistDismissalKey, {
    workspaceId,
  });
}
