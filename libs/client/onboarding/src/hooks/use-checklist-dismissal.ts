import {
  dismissWorkspaceSetupChecklist,
  isWorkspaceSetupChecklistDismissed,
  WORKSPACE_SETUP_CHECKLIST_DISMISSAL_EVENT,
} from '@shipfox/client-shell/runtime';
import {useCallback, useEffect, useState} from 'react';

export function useChecklistDismissal(workspaceId: string) {
  const [dismissed, setDismissed] = useState(() => isWorkspaceSetupChecklistDismissed(workspaceId));

  useEffect(() => {
    const refresh = () => setDismissed(isWorkspaceSetupChecklistDismissed(workspaceId));
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener(WORKSPACE_SETUP_CHECKLIST_DISMISSAL_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(WORKSPACE_SETUP_CHECKLIST_DISMISSAL_EVENT, refresh);
    };
  }, [workspaceId]);

  const dismiss = useCallback(() => {
    dismissWorkspaceSetupChecklist(workspaceId);
    setDismissed(true);
  }, [workspaceId]);

  return {dismissed, dismiss};
}
