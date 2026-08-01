import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {useRouteSearch} from '@shipfox/client-shell/runtime';
import {createSingleFlight, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useNavigate} from '@tanstack/react-router';
import {useEffect, useMemo, useState} from 'react';
import {useCompleteIntegrationCallback} from '#application/complete-integration-callback.js';
import {CallbackStatusShell} from '#components/callback-status-shell.js';
import type {IntegrationConnection} from '#core/models.js';
import {useCompleteLinearCallbackMutation} from '#hooks/api/integrations.js';
import {
  classifyLinearCallbackError,
  clearLinearInstallWorkspace,
  type LinearCallbackFailure,
  parseLinearCallbackQuery,
  readLinearInstallWorkspace,
  serializeLinearCallbackQuery,
} from '#linear-callback.js';

// Retain only recent completions: this bounds long-lived callback pages while
// still covering StrictMode and immediate Back/Forward remounts.
const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
// Keeps the success toast firing once per distinct callback even though the
// effect re-runs against the cached request as the mutation identity churns.
const toastedCallbacks = new Set<string>();

export function LinearCallbackPage() {
  const navigate = useNavigate();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const {mutateAsync: completeLinearCallback} = useCompleteLinearCallbackMutation();
  const {workspaces, isLoading} = useAuthState();
  const params = useRouteSearch(parseLinearCallbackQuery);
  const workspaceId = useMemo(() => readLinearInstallWorkspace(sessionStorageOrUndefined()), []);
  const [failure, setFailure] = useState<LinearCallbackFailure | undefined>();
  useEffect(() => {
    if (!params || isLoading) return;

    let disposed = false;
    const key = serializeLinearCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await completeIntegrationCallback({
          input: params,
          refreshAuth,
          complete: async (query, token) => await completeLinearCallback({query, token}),
        }),
    );

    request.then(
      async (connection) => {
        if (disposed) return;
        try {
          clearLinearInstallWorkspace(sessionStorageOrUndefined());
        } catch {
          // The successful API response remains the source of truth for navigation.
        }
        if (disposed) return;
        if (!toastedCallbacks.has(key)) {
          toastedCallbacks.add(key);
          toast.success('Linear installed.');
        }
        try {
          const workspace = workspaces.find(({id}) => id === connection.workspaceId);
          await navigate(
            workspace
              ? {
                  to: '/w/$workspaceSlug/settings/integrations',
                  params: {workspaceSlug: workspace.slug},
                  replace: true,
                }
              : {to: '/', replace: true},
          );
        } catch {
          // Keep the completed callback page visible if client navigation is interrupted.
        }
      },
      (error: unknown) => {
        if (disposed) return;
        setFailure(classifyLinearCallbackError(error));
      },
    );

    return () => {
      disposed = true;
    };
  }, [
    completeIntegrationCallback,
    completeLinearCallback,
    isLoading,
    navigate,
    params,
    refreshAuth,
    workspaces,
  ]);

  if (!params) {
    return (
      <LinearCallbackFailurePage
        failure={{
          title: 'Invalid Linear callback',
          message: 'Invalid Linear callback. Start the install again from workspace settings.',
          startOver: true,
          signIn: false,
        }}
        workspaceId={workspaceId}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );
  }

  if (!failure) return <FullPageLoader aria-label="Connecting Linear" />;

  return (
    <LinearCallbackFailurePage
      failure={failure}
      workspaceId={workspaceId}
      workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
    />
  );
}

function LinearCallbackFailurePage({
  failure,
  workspaceId,
  workspaceSlug,
}: {
  failure: LinearCallbackFailure;
  workspaceId: string | undefined;
  workspaceSlug: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title ?? 'Linear install could not be completed'}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceId={workspaceId}
      workspaceSlug={workspaceSlug}
      installPath="/w/$workspaceSlug/integrations/linear"
    />
  );
}
