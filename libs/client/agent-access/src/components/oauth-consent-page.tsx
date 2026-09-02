import {AuthShell, useAuthState, useRouteSearch} from '@shipfox/client-shell/runtime';
import {Badge} from '@shipfox/react-ui/badge';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Panel} from '@shipfox/react-ui/panel';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useEffect, useState} from 'react';
import type {OAuthConsent} from '#core/agent-access.js';
import {
  useApproveOAuthConsentMutation,
  useDenyOAuthConsentMutation,
  useOAuthConsentQuery,
} from '#hooks/api/consent.js';
import {validateOAuthConsentSearch} from '#routes/inputs.js';
import {oauthConsentErrorMessage} from './errors.js';
import {formatAgentAccessTimestamp} from './format.js';

export function OAuthConsentRoutePage() {
  const search = useRouteSearch(validateOAuthConsentSearch);
  if (!search.requestId) {
    return (
      <AuthShell
        title="Access request unavailable"
        description="The link is missing its request identifier."
      >
        <Panel>
          <EmptyState
            icon="linkUnlink"
            title="Open a new access request"
            description="Return to the agent and start the connection again."
            variant="panel"
          />
        </Panel>
      </AuthShell>
    );
  }
  return <OAuthConsentPage requestId={search.requestId} />;
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
        title="Access request unavailable"
        description="Shipfox could not open this agent access request."
      >
        <Panel>
          <EmptyState
            icon="linkUnlink"
            title="Could not load access request"
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
      description="Review the verified request before choosing a workspace."
      className="relative flex w-full max-w-[640px] flex-col items-stretch gap-region"
    >
      <Panel className="overflow-hidden">
        <div className="flex flex-col gap-group p-panel">
          <div className="flex items-start justify-between gap-group max-[520px]:flex-col">
            <div className="min-w-0">
              <Text bold className="truncate">
                {consent.clientName}
              </Text>
              <Text size="sm" className="text-foreground-neutral-muted">
                External agent client
              </Text>
            </div>
            <Badge variant="info" iconLeft="eyeLine">
              Read-only
            </Badge>
          </div>

          <dl className="grid grid-cols-[minmax(112px,auto)_minmax(0,1fr)] gap-x-group gap-y-inline border-t border-border-neutral-base pt-group text-sm max-[520px]:grid-cols-1 max-[520px]:gap-y-tight">
            <dt className="text-foreground-neutral-muted">Client identity</dt>
            <dd className="min-w-0">
              <Code variant="paragraph" className="block break-all">
                {consent.clientIdentityOrigin}
              </Code>
            </dd>
            <dt className="text-foreground-neutral-muted">Returns to</dt>
            <dd className="min-w-0">
              <Code variant="paragraph" className="block break-all">
                {consent.redirectHostname}
              </Code>
            </dd>
            <dt className="text-foreground-neutral-muted">Request expires</dt>
            <dd>{formatAgentAccessTimestamp(consent.expiresAt)}</dd>
          </dl>

          {consent.isLoopbackRedirect ? (
            <Callout type="warning" role="status">
              <Text size="sm">
                This request returns to an app running on this device. Continue only if you started
                the connection.
              </Text>
            </Callout>
          ) : null}
        </div>
      </Panel>

      <fieldset className="flex min-w-0 flex-col gap-inline" disabled={isSubmitting}>
        <legend className="mb-inline">
          <Text bold>Workspace</Text>
        </legend>
        {consent.workspaces.length > 0 ? (
          <RadioGroup value={workspaceId} onValueChange={setWorkspaceId} aria-label="Workspace">
            {consent.workspaces.map((workspace) => {
              const sessionWorkspace = auth.workspaces.find(({id}) => id === workspace.id);
              return (
                <RadioGroupItem key={workspace.id} value={workspace.id}>
                  <Text bold className="truncate">
                    {sessionWorkspace?.name ?? 'Workspace'}
                  </Text>
                  <Text size="sm" className="truncate text-foreground-neutral-muted">
                    {sessionWorkspace?.slug ?? workspace.id} · {workspace.role}
                  </Text>
                </RadioGroupItem>
              );
            })}
          </RadioGroup>
        ) : (
          <Callout type="warning">
            <Text size="sm">No eligible workspaces are available for this request.</Text>
          </Callout>
        )}
      </fieldset>

      {error ? (
        <Callout type="error" role="alert">
          <Text size="sm">{oauthConsentErrorMessage(error)}</Text>
        </Callout>
      ) : null}

      <div className="flex items-center justify-end gap-inline max-[520px]:flex-col-reverse max-[520px]:items-stretch">
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
          Allow read-only access
        </Button>
      </div>
      <Text size="sm" className="text-center text-foreground-neutral-muted">
        You can revoke this connection later in workspace settings.
      </Text>
    </AuthShell>
  );
}

function OAuthConsentLoading() {
  return (
    <AuthShell title="Review agent access" description="Loading the verified access request.">
      <Panel role="status" aria-label="Loading access request" className="p-panel">
        <div className="flex flex-col gap-group">
          <Skeleton className="h-20 w-192" />
          <Skeleton className="h-80 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      </Panel>
    </AuthShell>
  );
}
