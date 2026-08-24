import {
  dismissWorkspaceSetupChecklist,
  isWorkspaceSetupChecklistDismissed,
} from '@shipfox/client-shell/runtime';
import {useCallback, useEffect, useState} from 'react';

const CHECKLIST_DISMISSAL_EVENT = 'shipfox.workspaceSetupChecklist.dismissalChanged';

export function useChecklistDismissal(workspaceId: string) {
  const [dismissed, setDismissed] = useState(() => isWorkspaceSetupChecklistDismissed(workspaceId));

  useEffect(() => {
    const refresh = () => setDismissed(isWorkspaceSetupChecklistDismissed(workspaceId));
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener(CHECKLIST_DISMISSAL_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener(CHECKLIST_DISMISSAL_EVENT, refresh);
    };
  }, [workspaceId]);

  const dismiss = useCallback(() => {
    dismissWorkspaceSetupChecklist(workspaceId);
    setDismissed(true);
    window.dispatchEvent(new Event(CHECKLIST_DISMISSAL_EVENT));
  }, [workspaceId]);

  return {dismissed, dismiss};
}
