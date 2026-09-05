import {AuthShell, useAuthState, useRouteSearch} from '@shipfox/client-shell/runtime';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel} from '@shipfox/react-ui/panel';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useEffect, useState} from 'react';
import type {OAuthConsent} from '#agent-access/core/agent-access.js';
import {validateOAuthConsentSearch} from '#agent-access/routes/inputs.js';
import {createOAuthConsentLoginRedirect} from '#agent-access/routes/login-redirect.js';
import {
  useApproveOAuthConsentMutation,
  useDenyOAuthConsentMutation,
  useOAuthConsentQuery,
} from '#hooks/api/agent-access/consent.js';
import {oauthConsentErrorMessage} from './errors.js';
import {formatAgentAccessTimestamp} from './format.js';

export function OAuthConsentRoutePage({
  onGuestRedirect = redirectGuestToLogin,
}: {
  onGuestRedirect?: (url: string) => void;
} = {}) {
  const auth = useAuthState();
  const search = useRouteSearch(validateOAuthConsentSearch);

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      const returnUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      onGuestRedirect(createOAuthConsentLoginRedirect(returnUrl).href);
    }
  }, [auth.isAuthenticated, auth.isLoading, onGuestRedirect]);

  if (auth.isLoading || !auth.isAuthenticated) return <OAuthConsentLoading />;

  if (!search.requestId) {
    return (
      <AuthShell
        title="Connection request unavailable"
        description="The link is missing its request identifier."
      >
        <Panel>
          <EmptyState
            icon="linkUnlink"
            title="Open a new connection request"
            description="Return to your MCP client and start the connection again."
            variant="panel"
          />
        </Panel>
      </AuthShell>
    );
  }
  return <OAuthConsentPage requestId={search.requestId} />;
}

function redirectGuestToLogin(url: string) {
  window.location.assign(url);
}

export function OAuthConsentPage({
  requestId,
  onRedirect = (url) => window.location.assign(url),
}: {
  requestId: string;
  onRedirect?: (url: string) => void;
}) {
  const consentQuery = useOAuthConsentQuery(requestId);

  if (consentQuery.isPending) return <OAuthConsentLoading />;

  if (consentQuery.data === undefined) {
    return (
      <AuthShell
        title="Connection request unavailable"
        description="Shipfox could not open this connection request."
      >
        <Panel>
          <EmptyState
            icon="linkUnlink"
            title="Could not load connection request"
            description={oauthConsentErrorMessage(consentQuery.error)}
            action={
              <Button
                size="sm"
                variant="secondary"
                isLoading={consentQuery.isFetching}
                onClick={() => void consentQuery.refetch()}
              >
                Try again
              </Button>
            }
            variant="panel"
          />
        </Panel>
      </AuthShell>
    );
  }

  return <OAuthConsentLoaded consent={consentQuery.data} onRedirect={onRedirect} />;
}

function OAuthConsentLoaded({
  consent,
  onRedirect,
}: {
  consent: OAuthConsent;
  onRedirect: (url: string) => void;
}) {
  const auth = useAuthState();
  const approve = useApproveOAuthConsentMutation(consent.requestId);
  const deny = useDenyOAuthConsentMutation(consent.requestId);
  const [workspaceId, setWorkspaceId] = useState(consent.workspaces[0]?.id ?? '');
  const isSubmitting = approve.isPending || deny.isPending;
  const error = approve.error ?? deny.error;

  useEffect(() => {
    if (!consent.workspaces.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(consent.workspaces[0]?.id ?? '');
    }
  }, [consent.workspaces, workspaceId]);

  async function handleApprove() {
    if (!workspaceId) return;
    try {
      onRedirect(await approve.mutateAsync(workspaceId));
    } catch {
      // React Query retains the failure for the inline alert.
    }
  }

  async function handleDeny() {
    try {
      onRedirect(await deny.mutateAsync());
    } catch {
      // React Query retains the failure for the inline alert.
    }
  }

  return (
    <AuthShell
      title={`Allow ${consent.clientName} to access Shipfox?`}
      description="Review the connection details before allowing access."
    >
      <div className="flex flex-col gap-section">
        <Panel>
          <div className="flex flex-col gap-section p-panel">
            <div className="min-w-0">
              <Text bold className="break-words">
                {consent.clientName}
              </Text>
              <Text size="sm" className="text-foreground-neutral-muted">
                External MCP client
              </Text>
            </div>

            <hr className="border-border-neutral-base" />

            <dl className="grid grid-cols-[minmax(112px,auto)_minmax(0,1fr)] gap-x-group gap-y-inline text-sm max-[520px]:flex max-[520px]:flex-col max-[520px]:gap-group">
              {consent.workspaces.length === 1 ? (
                <div className="contents max-[520px]:flex max-[520px]:flex-col max-[520px]:gap-tight">
                  <dt className="text-foreground-neutral-muted">Workspace</dt>
                  <dd className="min-w-0 break-words">
                    {auth.workspaces.find(({id}) => id === consent.workspaces[0]?.id)?.name ??
                      'Current workspace'}
                  </dd>
                </div>
              ) : null}
              <div className="contents max-[520px]:flex max-[520px]:flex-col max-[520px]:gap-tight">
                <dt className="text-foreground-neutral-muted">Client identity</dt>
                <dd className="min-w-0">
                  <Code variant="paragraph" className="block break-all">
                    {consent.clientIdentityOrigin}
                  </Code>
                </dd>
              </div>
              <div className="contents max-[520px]:flex max-[520px]:flex-col max-[520px]:gap-tight">
                <dt className="text-foreground-neutral-muted">Access</dt>
                <dd>Read workspace data</dd>
              </div>
              <div className="contents max-[520px]:flex max-[520px]:flex-col max-[520px]:gap-tight">
                <dt className="text-foreground-neutral-muted">Returns to</dt>
                <dd className="min-w-0">
                  {consent.isLoopbackRedirect ? (
                    <Text size="sm">{consent.clientName} on this device</Text>
                  ) : (
                    <Code variant="paragraph" className="block break-all">
                      {consent.redirectHostname}
                    </Code>
                  )}
                </dd>
              </div>
              <div className="contents max-[520px]:flex max-[520px]:flex-col max-[520px]:gap-tight">
                <dt className="text-foreground-neutral-muted">Request expires</dt>
                <dd>{formatAgentAccessTimestamp(consent.expiresAt)}</dd>
              </div>
            </dl>
          </div>
        </Panel>

        <div className="flex flex-col gap-group">
          {consent.workspaces.length > 1 ? (
            <fieldset className="min-w-0" disabled={isSubmitting}>
              <legend className="sr-only">Workspace</legend>
              <div className="flex flex-col gap-group">
                <Text bold>Workspace</Text>
                <RadioGroup
                  value={workspaceId}
                  onValueChange={setWorkspaceId}
                  aria-label="Workspace"
                >
                  {consent.workspaces.map((workspace) => {
                    const sessionWorkspace = auth.workspaces.find(({id}) => id === workspace.id);
                    return (
                      <RadioGroupItem key={workspace.id} value={workspace.id}>
                        <Text bold className="break-words">
                          {sessionWorkspace?.name ?? 'Workspace'}
                        </Text>
                      </RadioGroupItem>
                    );
                  })}
                </RadioGroup>
              </div>
            </fieldset>
          ) : null}
          {consent.workspaces.length === 0 ? (
            <Callout type="warning">
              <Text size="sm">
                No eligible workspaces are available for this connection request.
              </Text>
            </Callout>
          ) : null}

          {error ? (
            <Callout type="error" role="alert">
              <Text size="sm">{oauthConsentErrorMessage(error)}</Text>
            </Callout>
          ) : null}

          <div className="grid grid-cols-2 gap-inline min-[520px]:flex min-[520px]:items-center min-[520px]:justify-end">
            <Button
              variant="secondary"
              isLoading={deny.isPending}
              disabled={approve.isPending}
              onClick={() => void handleDeny()}
            >
              Deny
            </Button>
            <Button
              isLoading={approve.isPending}
              disabled={!workspaceId || deny.isPending}
              onClick={() => void handleApprove()}
            >
              Allow access
            </Button>
          </div>
          <Text size="sm" className="text-center text-foreground-neutral-muted">
            You can disconnect this app later in workspace settings.
          </Text>
        </div>
      </div>
    </AuthShell>
  );
}

function OAuthConsentLoading() {
  return (
    <AuthShell
      title="Review connection request"
      description="Loading the verified connection request."
    >
      <Panel role="status" aria-label="Loading connection request" className="p-panel">
        <div className="flex flex-col gap-group">
          <Skeleton className="h-20 w-192" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </Panel>
    </AuthShell>
  );
}
