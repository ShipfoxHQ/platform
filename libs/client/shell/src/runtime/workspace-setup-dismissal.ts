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

/** Whether the workspace setup checklist was dismissed on this device. */
export function isWorkspaceSetupChecklistDismissed(workspaceId: string): boolean {
  return workspaceSetupChecklistDismissalStorage(workspaceId).read() === true;
}

export function dismissWorkspaceSetupChecklist(workspaceId: string): void {
  workspaceSetupChecklistDismissalStorage(workspaceId).write(true);
}

export function clearWorkspaceSetupChecklistDismissal(workspaceId: string): void {
  workspaceSetupChecklistDismissalStorage(workspaceId).remove();
}

function workspaceSetupChecklistDismissalStorage(workspaceId: string) {
  return createTypedBrowserStorage(localStorageOrUndefined, workspaceSetupChecklistDismissalKey, {
    workspaceId,
  });
}
