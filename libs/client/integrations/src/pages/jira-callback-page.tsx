import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {useRouteSearch} from '@shipfox/client-shell/runtime';
import {sessionStorageOrUndefined} from '@shipfox/client-ui';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Card} from '@shipfox/react-ui/card';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  useCompleteIntegrationCallback,
  useCompleteIntegrationCallbackResult,
} from '#application/complete-integration-callback.js';
import {CallbackStatusShell} from '#components/callback-status-shell.js';
import type {IntegrationConnection, JiraSite} from '#core/models.js';
import {
  useCompleteJiraCallbackMutation,
  useCompleteJiraSiteSelectionMutation,
} from '#hooks/api/integrations.js';
import {
  clearJiraInstallWorkspace,
  parseJiraCallbackQuery,
  readJiraInstallWorkspace,
  serializeJiraCallbackQuery,
} from '#jira-callback.js';
import {
  JIRA_CALLBACK_CACHE_SIZE,
  jiraCallbackRequests,
  jiraCompletedConnections,
  jiraSiteSelectionRequests,
  jiraToastedCallbacks,
} from '#jira-callback-state.js';
import {classifyJiraCallbackError, type JiraCallbackFailure} from '#jira-form-errors.js';
import {rememberCallbackKey, resolveWorkspaceSlug} from '#workspace-navigation.js';

export function JiraCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const {workspaces, isLoading} = useAuthState();
  const completeIntegrationCallback = useCompleteIntegrationCallback();
  const completeIntegrationCallbackResult = useCompleteIntegrationCallbackResult();
  const {mutateAsync: completeJiraCallback} = useCompleteJiraCallbackMutation();
  const {mutateAsync: completeJiraSiteSelection} = useCompleteJiraSiteSelectionMutation();
  const params = useRouteSearch(parseJiraCallbackQuery);
  const callbackKey = params ? serializeJiraCallbackQuery(params) : undefined;
  const workspaceId = useMemo(() => readJiraInstallWorkspace(sessionStorageOrUndefined()), []);
  const [sites, setSites] = useState<JiraSite[] | undefined>();
  const [failure, setFailure] = useState<JiraCallbackFailure | undefined>();
  const [selectedCloudId, setSelectedCloudId] = useState<string | undefined>();
  const [completedWorkspace, setCompletedWorkspace] = useState<{
    slug?: string | undefined;
  }>();
  const disposedRef = useRef(false);
  const callbackKeyRef = useRef(callbackKey);
  callbackKeyRef.current = callbackKey;
  const [callbackStateKey, setCallbackStateKey] = useState(callbackKey);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  const completeConnection = useCallback(
    async (
      connection: IntegrationConnection,
      callbackKey: string,
      isActive: () => boolean = () => true,
    ) => {
      if (disposedRef.current || !isActive()) return;
      const completedConnection = jiraCompletedConnections.get(callbackKey);
      if (completedConnection) {
        const workspaceSlug = await resolveWorkspaceSlug({
          workspaceId: completedConnection.workspaceId,
          fallbackWorkspaces: workspaces,
          queryClient,
        });
        if (!disposedRef.current && isActive())
          setCompletedWorkspace(workspaceSlug ? {slug: workspaceSlug} : {});
        return;
      }
      rememberCompletedConnection(callbackKey, connection);
      try {
        clearJiraInstallWorkspace(sessionStorageOrUndefined());
      } catch {
        // The successful API response remains the source of truth for navigation.
      }
      if (disposedRef.current || !isActive()) return;
      if (!jiraToastedCallbacks.has(callbackKey)) {
        rememberCallbackKey(jiraToastedCallbacks, callbackKey);
        toast.success('Jira installed.');
      }
      let workspaceSlug: string | undefined;
      try {
        workspaceSlug = await resolveWorkspaceSlug({
          workspaceId: connection.workspaceId,
          fallbackWorkspaces: workspaces,
          queryClient,
        });
        if (disposedRef.current || !isActive()) return;
        if (!workspaceSlug) {
          setCompletedWorkspace({});
          return;
        }
        setCompletedWorkspace({slug: workspaceSlug});
        await navigate({
          to: '/w/$workspaceSlug/settings/integrations',
          params: {workspaceSlug},
          replace: true,
        });
      } catch {
        if (!disposedRef.current && isActive()) setCompletedWorkspace({slug: workspaceSlug});
      }
    },
    [navigate, queryClient, workspaces],
  );

  useEffect(() => {
    if (callbackKey === undefined) return;
    setCallbackStateKey(callbackKey);
    setSites(undefined);
    setSelectedCloudId(undefined);
    setFailure(undefined);
    setCompletedWorkspace(undefined);
  }, [callbackKey]);

  useEffect(() => {
    if (!params || !callbackKey || isLoading) return;

    let active = true;

    const completedConnection = jiraCompletedConnections.get(callbackKey);
    if (completedConnection) {
      void completeConnection(completedConnection, callbackKey, () => active);
      return () => {
        active = false;
      };
    }

    const request = jiraCallbackRequests.run(callbackKey, async () => {
      return await completeIntegrationCallbackResult({
        input: params,
        refreshAuth,
        complete: async (query, token) => await completeJiraCallback({query, token}),
        getConnection: (result) => ('sites' in result ? undefined : result),
      });
    });

    request.then(
      async (result) => {
        if (disposedRef.current || !active) return;
        if ('sites' in result) {
          setFailure(undefined);
          setSites(result.sites);
          return;
        }
        await completeConnection(result, callbackKey, () => active);
      },
      (error: unknown) => {
        if (!disposedRef.current && active) setFailure(classifyJiraCallbackError(error));
      },
    );

    return () => {
      active = false;
    };
  }, [
    callbackKey,
    completeIntegrationCallbackResult,
    completeJiraCallback,
    completeConnection,
    isLoading,
    params,
    refreshAuth,
  ]);

  function selectSite(site: JiraSite) {
    if (!params || !callbackKey || selectedCloudId) return;
    setSelectedCloudId(site.cloudId);
    setFailure(undefined);
    const selectionKey = callbackKey;
    const request = jiraSiteSelectionRequests.run(params.state, async () => {
      return await completeIntegrationCallback({
        input: {cloud_id: site.cloudId, state: params.state},
        refreshAuth,
        complete: async (body, token) => await completeJiraSiteSelection({body, token}),
      });
    });
    request.then(
      async (connection) => {
        if (disposedRef.current || callbackKeyRef.current !== selectionKey) return;
        jiraCallbackRequests.clear(selectionKey);
        await completeConnection(
          connection,
          selectionKey,
          () => callbackKeyRef.current === selectionKey,
        );
      },
      (error: unknown) => {
        if (disposedRef.current || callbackKeyRef.current !== selectionKey) return;
        setSelectedCloudId(undefined);
        setFailure(classifyJiraCallbackError(error));
      },
    );
  }

  if (!params) {
    return (
      <JiraCallbackFailurePage
        failure={classifyJiraCallbackError(new Error('invalid callback'))}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );
  }

  if (isLoading) return <FullPageLoader aria-label="Connecting Jira" />;

  if (callbackStateKey === callbackKey && completedWorkspace)
    return (
      <CallbackStatusShell
        title="Jira connected"
        status="success"
        message={
          completedWorkspace.slug
            ? 'Jira is connected. Continue in integrations settings.'
            : 'Jira is connected. Return to Shipfox to continue.'
        }
        workspaceSlug={completedWorkspace.slug}
        installPath="/w/$workspaceSlug/integrations/jira"
      />
    );

  if (callbackStateKey === callbackKey && sites)
    return (
      <JiraSiteSelectionPage
        sites={sites}
        selectedCloudId={selectedCloudId}
        failure={failure}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
        onSelect={selectSite}
      />
    );

  if (callbackStateKey === callbackKey && failure)
    return (
      <JiraCallbackFailurePage
        failure={failure}
        workspaceSlug={workspaces.find(({id}) => id === workspaceId)?.slug}
      />
    );

  return <FullPageLoader aria-label="Connecting Jira" />;
}

function rememberCompletedConnection(key: string, connection: IntegrationConnection): void {
  jiraCompletedConnections.delete(key);
  jiraCompletedConnections.set(key, connection);
  while (jiraCompletedConnections.size > JIRA_CALLBACK_CACHE_SIZE) {
    const oldestKey = jiraCompletedConnections.keys().next().value;
    if (oldestKey === undefined) return;
    jiraCompletedConnections.delete(oldestKey);
  }
}

function JiraCallbackFailurePage({
  failure,
  workspaceSlug,
}: {
  failure: JiraCallbackFailure;
  workspaceSlug: string | undefined;
}) {
  return (
    <CallbackStatusShell
      title={failure.title}
      message={failure.message}
      startOver={failure.startOver}
      switchAccount={failure.signIn}
      workspaceSlug={workspaceSlug}
      installPath="/w/$workspaceSlug/integrations/jira"
    />
  );
}

function JiraSiteSelectionPage({
  sites,
  selectedCloudId,
  failure,
  workspaceSlug,
  onSelect,
}: {
  sites: JiraSite[];
  selectedCloudId: string | undefined;
  failure: JiraCallbackFailure | undefined;
  workspaceSlug: string | undefined;
  onSelect: (site: JiraSite) => void;
}) {
  return (
    <main className="flex min-h-screen bg-background-subtle-base px-16 py-32">
      <div className="mx-auto flex w-full max-w-[480px] flex-col justify-center gap-20">
        <header className="flex flex-col gap-8">
          <Header variant="h2">Choose a Jira site</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Select the Jira site to connect to this Shipfox workspace.
          </Text>
        </header>

        {failure ? (
          <Callout role="alert" type="error">
            <Text size="sm">{failure.message}</Text>
          </Callout>
        ) : null}

        <section className="flex flex-col gap-8" aria-label="Choose a Jira site">
          {sites.map((site) => (
            <Card key={site.cloudId} className="p-16">
              <div className="flex items-center justify-between gap-12">
                <div className="min-w-0">
                  <Text size="md" bold className="truncate">
                    {site.name}
                  </Text>
                  <Text size="sm" className="truncate text-foreground-neutral-muted">
                    {site.url}
                  </Text>
                </div>
                <Button
                  variant="secondary"
                  disabled={selectedCloudId !== undefined}
                  isLoading={selectedCloudId === site.cloudId}
                  onClick={() => onSelect(site)}
                >
                  Connect
                </Button>
              </div>
            </Card>
          ))}
        </section>

        <div className="flex flex-col gap-8 sm:flex-row sm:items-center">
          {failure?.startOver && workspaceSlug ? (
            <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
              <Link to="/w/$workspaceSlug/integrations/jira" params={{workspaceSlug}}>
                Start over
              </Link>
            </ButtonLink>
          ) : null}
          {workspaceSlug ? (
            <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
              <Link to="/w/$workspaceSlug/settings/integrations" params={{workspaceSlug}}>
                Back to integrations
              </Link>
            </ButtonLink>
          ) : (
            <ButtonLink asChild variant="muted" className="min-h-44 w-full sm:w-fit">
              <Link to="/">Back to Shipfox</Link>
            </ButtonLink>
          )}
        </div>
      </div>
    </main>
  );
}
