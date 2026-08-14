import {useAuthState, useRefreshAuth} from '@shipfox/client-auth';
import {useRouteSearch} from '@shipfox/client-shell/runtime';
import {createSingleFlight, sessionStorageOrUndefined} from '@shipfox/client-ui';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Panel} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useEffect, useMemo, useRef, useState} from 'react';
import {useCompleteIntegrationCallback} from '#application/complete-integration-callback.js';
import type {IntegrationConnection} from '#core/models.js';
import {connectSentry} from '#hooks/api/integrations.js';
import {
  classifySentryConnectError,
  clearSentryInstallWorkspace,
  parseSentryCallbackParams,
  preselectSentryWorkspace,
  readSentryInstallWorkspace,
  type SentryConnectFailure,
} from '#sentry-callback.js';
import {resolveWorkspaceSlug} from '#workspace-navigation.js';

const connectRequests = createSingleFlight<string, IntegrationConnection>();

export function SentryCallbackPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshAuth = useRefreshAuth();
  const {workspaces, isLoading} = useAuthState();
  const completeIntegrationCallback = useCompleteIntegrationCallback();

  const params = useRouteSearch(parseSentryCallbackParams);
  const storedWorkspaceId = useMemo(
    () => readSentryInstallWorkspace(sessionStorageOrUndefined()),
    [],
  );
  const preselection = preselectSentryWorkspace(storedWorkspaceId, workspaces);
  const preselectedId = preselection.kind === 'pick' ? preselection.preselectedId : undefined;

  const [connectingId, setConnectingId] = useState<string | undefined>();
  const [failure, setFailure] = useState<
    {workspaceId: string; failure: SentryConnectFailure} | undefined
  >();
  const [retryLocked, setRetryLocked] = useState(false);
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  // Wait for auth before treating an empty workspace list as "no workspace": on
  // a cold return from Sentry, `workspaces` is [] until the session refresh
  // resolves, and bouncing to `/` then would discard the one-shot grant code.
  const noWorkspace = !isLoading && preselection.kind === 'none';
  useEffect(() => {
    if (!noWorkspace) return;
    toast.error('You need a workspace before installing Sentry.');
    navigate({to: '/', replace: true});
  }, [noWorkspace, navigate]);

  const retryAfterSeconds =
    failure?.failure.kind === 'retryable' ? failure.failure.retryAfterSeconds : undefined;
  useEffect(() => {
    // No backoff window (any non-rate-limited failure) re-enables Retry, so a
    // prior rate-limit lock can never strand the button in a disabled state.
    if (!retryAfterSeconds) {
      setRetryLocked(false);
      return;
    }
    setRetryLocked(true);
    const timer = setTimeout(() => setRetryLocked(false), retryAfterSeconds * 1000);
    return () => clearTimeout(timer);
  }, [retryAfterSeconds]);

  if (!params) {
    return (
      <CallbackColumn>
        <Callout role="alert" type="error">
          <Text size="sm">
            This Sentry link is missing required parameters. Start the install again from your
            workspace settings.
          </Text>
        </Callout>
        <ButtonLink asChild variant="muted" className="w-fit">
          <Link to="/">Back to Shipfox</Link>
        </ButtonLink>
      </CallbackColumn>
    );
  }

  // Hold the loader until auth resolves; the workspace list and the
  // noWorkspace redirect both depend on a settled `workspaces`.
  if (isLoading) return <FullPageLoader />;

  if (noWorkspace) return null;

  const connect = (workspaceId: string) => {
    setConnectingId(workspaceId);
    setFailure(undefined);
    const key = `${params.installationId}|${workspaceId}|${params.code}`;
    const request = connectRequests.run(
      key,
      async () =>
        await completeIntegrationCallback({
          input: workspaceId,
          refreshAuth,
          complete: async (selectedWorkspaceId, token) =>
            await connectSentry({
              body: {
                workspace_id: selectedWorkspaceId,
                code: params.code,
                installation_id: params.installationId,
              },
              token,
            }),
        }),
    );

    request
      .then(async () => {
        clearSentryInstallWorkspace(sessionStorageOrUndefined());
        if (disposedRef.current) return;
        toast.success('Sentry installed.');
        const workspaceSlug = await resolveWorkspaceSlug({
          workspaceId,
          fallbackWorkspaces: workspaces,
          queryClient,
        });
        if (disposedRef.current) return;
        await navigate(
          workspaceSlug
            ? {
                to: '/w/$workspaceSlug/settings/integrations',
                params: {workspaceSlug},
                replace: true,
              }
            : {to: '/', replace: true},
        );
      })
      .catch((error: unknown) => {
        if (disposedRef.current) return;
        const classified = classifySentryConnectError(error);
        if (classified.kind === 'terminal') {
          // Only a fresh install (new grant code) can recover; the stored
          // handoff has served its purpose either way.
          clearSentryInstallWorkspace(sessionStorageOrUndefined());
        }
        setConnectingId(undefined);
        setFailure({workspaceId, failure: classified});
      });
  };

  const orderedWorkspaces = preselectedId
    ? [
        ...workspaces.filter((workspace) => workspace.id === preselectedId),
        ...workspaces.filter((workspace) => workspace.id !== preselectedId),
      ]
    : workspaces;

  const failureWorkspaceId = failure?.workspaceId ?? preselectedId ?? workspaces[0]?.id;
  const failureWorkspace = failureWorkspaceId
    ? workspaces.find(({id}) => id === failureWorkspaceId)
    : undefined;

  return (
    <CallbackColumn>
      <header className="flex flex-col gap-inline">
        <Header variant="h2">Install Sentry</Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          {params.orgSlug
            ? `Install the Sentry org "${params.orgSlug}" in a workspace.`
            : 'Install this Sentry integration in a workspace.'}
        </Text>
      </header>

      {failure ? (
        <Callout role="alert" type="error">
          <div className="flex flex-col gap-inline">
            <Text size="sm">{failure.failure.message}</Text>
            {failure.failure.kind === 'retryable' ? (
              <Button
                size="sm"
                variant="secondary"
                className="w-fit"
                disabled={retryLocked || connectingId !== undefined}
                onClick={() => connect(failure.workspaceId)}
              >
                Retry
              </Button>
            ) : null}
            {failure.failure.kind === 'terminal' &&
            failure.failure.startOver &&
            failureWorkspace ? (
              <Button asChild size="sm" variant="secondary" className="w-fit">
                <Link
                  to="/w/$workspaceSlug/integrations/sentry"
                  params={{workspaceSlug: failureWorkspace.slug}}
                >
                  Start over
                </Link>
              </Button>
            ) : null}
          </div>
        </Callout>
      ) : null}

      <section className="flex flex-col gap-inline" aria-label="Choose a workspace">
        {orderedWorkspaces.map((workspace) => (
          <Panel key={workspace.id} className="p-panel-compact">
            <div className="flex items-center justify-between gap-cluster">
              <Text size="md" bold className="truncate">
                {workspace.name}
              </Text>
              <Button
                variant="secondary"
                disabled={connectingId !== undefined}
                isLoading={connectingId === workspace.id}
                onClick={() => connect(workspace.id)}
              >
                Install
              </Button>
            </div>
          </Panel>
        ))}
      </section>

      {failureWorkspace ? (
        <ButtonLink asChild variant="muted" className="w-fit">
          <Link
            to="/w/$workspaceSlug/settings/integrations"
            params={{workspaceSlug: failureWorkspace.slug}}
          >
            Back to settings
          </Link>
        </ButtonLink>
      ) : null}
    </CallbackColumn>
  );
}

function CallbackColumn({children}: {children: React.ReactNode}) {
  return (
    <main className="flex min-h-screen px-row py-frame">
      <div className="mx-auto flex w-full flex-col justify-center gap-section">{children}</div>
    </main>
  );
}
