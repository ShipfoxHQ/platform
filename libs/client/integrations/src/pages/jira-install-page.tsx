import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {useCallback} from 'react';
import {RedirectInstallPage} from '#components/redirect-install-page.js';
import {useCreateJiraInstallMutation} from '#hooks/api/integrations.js';
import {saveJiraInstallWorkspace} from '#jira-callback.js';

export function JiraInstallPage() {
  const createInstall = useCreateJiraInstallMutation();
  const installRequest = useCallback(
    async (body: {workspace_id: string}) => await createInstall.mutateAsync(body),
    [createInstall],
  );

  return (
    <RedirectInstallPage
      installRequest={installRequest}
      errorFallbackMessage="Could not start Jira install."
      loadingLabel="Connecting Jira"
      beforeRedirect={(workspaceId) => {
        try {
          saveJiraInstallWorkspace(sessionStorageOrUndefined(), workspaceId);
        } catch {
          // Storage is only a navigation hint; the signed state is authoritative.
        }
      }}
    />
  );
}
