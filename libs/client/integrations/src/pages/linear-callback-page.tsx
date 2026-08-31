import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {useRouteSearch} from '@shipfox/client-shell/runtime';
import {createSingleFlight, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {useQueryClient} from '@tanstack/react-query';
import {useNavigate} from '@tanstack/react-router';
import {type Dispatch, type SetStateAction, useEffect, useMemo, useState} from 'react';
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
import {rememberCallbackKey, resolveWorkspaceSlug} from '#workspace-navigation.js';

// Retain only recent completions: this bounds long-lived callback pages while
// still covering StrictMode and immediate Back/Forward remounts.
const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const completedCallbacks = new Set<string>();
// Keeps the success toast firing once per distinct callback even though the
// effect re-runs against the cached request as the mutation identity churns.
const toastedCallbacks = new Set<string>();
type CompletedLinearWorkspace = {slug?: string | undefined};

export function LinearCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const {mutateAsync: completeLinearCallback} = useCompleteLinearCallbackMutation();
  const {workspaces, isLoading} = useAuthState();
  const params = useRouteSearch(parseLinearCallbackQuery);
  const workspaceId = useMemo(() => readLinearInstallWorkspace(sessionStorageOrUndefined()), []);
  const [failure, setFailure] = useState<LinearCallbackFailure | undefined>();
  const [completedWorkspace, setCompletedWorkspace] = useState<CompletedLinearWorkspace>();
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
      async (connection) =>
        await handleLinearCallbackSuccess({
          connection,
          key,
          isDisposed: () => disposed,
          workspaces,
          queryClient,
          navigate,
          setCompletedWorkspace,
        }),
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
    queryClient,
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
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );
  }

  if (completedWorkspace)
    return (
      <CallbackStatusShell
        title="Linear connected"
        status="success"
        message={
          completedWorkspace.slug
            ? 'Linear is connected. Continue in integrations settings.'
            : 'Linear is connected. Return to Shipfox to continue.'
        }
        workspaceSlug={completedWorkspace.slug}
        installPath="/w/$workspaceSlug/integrations/linear"
      />
    );

  if (!failure) return <FullPageLoader aria-label="Connecting Linear" />;

  return (
    <LinearCallbackFailurePage
      failure={failure}
      workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
    />
  );
}

async function handleLinearCallbackSuccess({
  connection,
  key,
  isDisposed,
  workspaces,
  queryClient,
  navigate,
  setCompletedWorkspace,
}: {
  connection: IntegrationConnection;
  key: string;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  navigate: ReturnType<typeof useNavigate>;
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedLinearWorkspace | undefined>>;
}) {
  if (isDisposed()) return;
  if (completedCallbacks.has(key)) {
    await showResolvedLinearWorkspace({
      connection,
      isDisposed,
      workspaces,
      queryClient,
      setCompletedWorkspace,
    });
    return;
  }
  rememberCallbackKey(completedCallbacks, key);
  try {
    clearLinearInstallWorkspace(sessionStorageOrUndefined());
  } catch {
    // The successful API response remains the source of truth for navigation.
  }
  if (isDisposed()) return;
  if (!toastedCallbacks.has(key)) {
    rememberCallbackKey(toastedCallbacks, key);
    toast.success('Linear installed.');
  }
  await navigateToLinearWorkspace({
    connection,
    isDisposed,
    workspaces,
    queryClient,
    navigate,
    setCompletedWorkspace,
  });
}

type LinearWorkspaceResolution = {
  connection: IntegrationConnection;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  setCompletedWorkspace: Dispatch<SetStateAction<CompletedLinearWorkspace | undefined>>;
};

async function showResolvedLinearWorkspace(params: LinearWorkspaceResolution) {
  const workspaceSlug = await resolveWorkspaceSlug({
    workspaceId: params.connection.workspaceId,
    fallbackWorkspaces: params.workspaces,
    queryClient: params.queryClient,
  });
  if (!params.isDisposed()) {
    params.setCompletedWorkspace(workspaceSlug ? {slug: workspaceSlug} : {});
  }
}

async function navigateToLinearWorkspace(
  params: LinearWorkspaceResolution & {navigate: ReturnType<typeof useNavigate>},
) {
  let workspaceSlug: string | undefined;
  try {
    workspaceSlug = await resolveWorkspaceSlug({
      workspaceId: params.connection.workspaceId,
      fallbackWorkspaces: params.workspaces,
      queryClient: params.queryClient,
    });
    if (params.isDisposed()) return;
    if (!workspaceSlug) {
      params.setCompletedWorkspace({});
      return;
    }
    params.setCompletedWorkspace({slug: workspaceSlug});
    await params.navigate({
      to: '/w/$workspaceSlug/settings/integrations',
      params: {workspaceSlug},
      replace: true,
    });
  } catch {
    if (!params.isDisposed()) params.setCompletedWorkspace({slug: workspaceSlug});
  }
}

function LinearCallbackFailurePage({
  failure,
  workspaceSlug,
}: {
  failure: LinearCallbackFailure;
  workspaceSlug: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title ?? 'Linear install could not be completed'}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceSlug={workspaceSlug}
      installPath="/w/$workspaceSlug/integrations/linear"
    />
  );
}
