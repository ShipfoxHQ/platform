import type {BrowserStorageKey} from '@shipfox/react-ui/utils';
import {createTypedBrowserStorage, localStorageOrUndefined} from '@shipfox/react-ui/utils';
import {useCallback, useState} from 'react';

const checklistExpansionKey = {
  key: 'shipfox.workspaceSetupChecklist.expanded',
  lifetime: 'persistent',
  principalScope: 'workspace',
  serialize: (expanded: boolean) => JSON.stringify(expanded),
  parse: (raw: string) => {
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'boolean' ? parsed : undefined;
    } catch {
      return undefined;
    }
  },
} satisfies BrowserStorageKey<boolean>;

export function setWorkspaceSetupChecklistExpanded(workspaceId: string, expanded: boolean): void {
  checklistExpansionStorage(workspaceId).write(expanded);
}

/**
 * Per-device panel expansion. The panel opens collapsed so the setup guide
 * never displaces the page below it, and a reader who opens the full list keeps
 * it open on their next visit. The hosts remount per workspace, so the initial
 * read never has to follow a workspace switch.
 */
export function useChecklistExpansion(workspaceId: string) {
  const [expanded, setExpanded] = useState(
    () => checklistExpansionStorage(workspaceId).read() === true,
  );

  const toggle = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      setWorkspaceSetupChecklistExpanded(workspaceId, next);
      return next;
    });
  }, [workspaceId]);

  return {expanded, toggle};
}

function checklistExpansionStorage(workspaceId: string) {
  return createTypedBrowserStorage(localStorageOrUndefined, checklistExpansionKey, {workspaceId});
}
