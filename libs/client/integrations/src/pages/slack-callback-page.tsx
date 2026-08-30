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
import {useCompleteSlackCallbackMutation} from '#hooks/api/integrations.js';
import {
  classifySlackCallbackError,
  clearSlackInstallWorkspace,
  parseSlackCallbackQuery,
  readSlackInstallWorkspace,
  type SlackCallbackFailure,
  serializeSlackCallbackQuery,
} from '#slack-callback.js';
import {rememberCallbackKey, resolveWorkspaceSlug} from '#workspace-navigation.js';

// Retain only recent completions: this bounds long-lived callback pages while
// still covering StrictMode and immediate Back/Forward remounts.
const callbackRequests = createSingleFlight<string, IntegrationConnection>({
  maxTerminalResults: 32,
});
const completedCallbacks = new Set<string>();
const toastedCallbacks = new Set<string>();

export function SlackCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const {mutateAsync: completeSlackCallback} = useCompleteSlackCallbackMutation();
  const {workspaces, isLoading} = useAuthState();
  const params = useRouteSearch(parseSlackCallbackQuery);
  const workspaceId = useMemo(() => readSlackInstallWorkspace(sessionStorageOrUndefined()), []);
  const [failure, setFailure] = useState<SlackCallbackFailure>();
  const [completedWorkspace, setCompletedWorkspace] = useState<{
    slug?: string | undefined;
  }>();

  useEffect(() => {
    if (!params || isLoading) return;
    let disposed = false;
    const key = serializeSlackCallbackQuery(params);
    const request = callbackRequests.run(
      key,
      async () =>
        await completeIntegrationCallback({
          input: params,
          refreshAuth,
          complete: async (query, token) => await completeSlackCallback({query, token}),
        }),
    );
    request.then(
      async (connection) =>
        await handleSlackCallbackSuccess({
          connection,
          key,
          isDisposed: () => disposed,
          workspaces,
          queryClient,
          navigate,
          setCompletedWorkspace,
        }),
      (error: unknown) => {
        if (!disposed) setFailure(classifySlackCallbackError(error));
      },
    );
    return () => {
      disposed = true;
    };
  }, [
    completeIntegrationCallback,
    completeSlackCallback,
    isLoading,
    navigate,
    params,
    queryClient,
    refreshAuth,
    workspaces,
  ]);

  if (!params)
    return (
      <CallbackStatusShell
        title="Invalid Slack callback"
        message="This Slack link is missing required parameters. Start the install again from workspace settings."
        startOver
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
        installPath="/w/$workspaceSlug/integrations/slack"
      />
    );
  if (completedWorkspace)
    return (
      <CallbackStatusShell
        title="Slack connected"
        status="success"
        message={
          completedWorkspace.slug
            ? 'Slack is connected. Continue in integrations settings.'
            : 'Slack is connected. Return to Shipfox to continue.'
        }
        workspaceSlug={completedWorkspace.slug}
        installPath="/w/$workspaceSlug/integrations/slack"
      />
    );
  if (failure)
    return (
      <CallbackStatusShell
        {...failure}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
        switchAccount={failure.signIn}
        installPath="/w/$workspaceSlug/integrations/slack"
      />
    );
  return <FullPageLoader aria-label="Connecting Slack" />;
}

type SlackWorkspaceResolution = {
  connection: IntegrationConnection;
  isDisposed: () => boolean;
  workspaces: ReturnType<typeof useAuthState>['workspaces'];
  queryClient: ReturnType<typeof useQueryClient>;
  setCompletedWorkspace: Dispatch<SetStateAction<{slug?: string | undefined} | undefined>>;
};

async function handleSlackCallbackSuccess(
  params: SlackWorkspaceResolution & {key: string; navigate: ReturnType<typeof useNavigate>},
) {
  if (params.isDisposed()) return;
  if (completedCallbacks.has(params.key)) {
    await showResolvedSlackWorkspace(params);
    return;
  }
  rememberCallbackKey(completedCallbacks, params.key);
  try {
    clearSlackInstallWorkspace(sessionStorageOrUndefined());
  } catch {
    // The successful API response remains the source of truth.
  }
  if (params.isDisposed()) return;
  if (!toastedCallbacks.has(params.key)) {
    rememberCallbackKey(toastedCallbacks, params.key);
    toast.success('Slack installed.');
  }
  await navigateToSlackWorkspace(params);
}

async function showResolvedSlackWorkspace(params: SlackWorkspaceResolution) {
  const workspaceSlug = await resolveWorkspaceSlug({
    workspaceId: params.connection.workspaceId,
    fallbackWorkspaces: params.workspaces,
    queryClient: params.queryClient,
  });
  if (!params.isDisposed()) {
    params.setCompletedWorkspace(workspaceSlug ? {slug: workspaceSlug} : {});
  }
}

async function navigateToSlackWorkspace(
  params: SlackWorkspaceResolution & {navigate: ReturnType<typeof useNavigate>},
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
