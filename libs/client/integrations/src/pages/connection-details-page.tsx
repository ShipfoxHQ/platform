import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Panel, PanelBody, PanelHeader, PanelRow, PanelTitle} from '@shipfox/react-ui/panel';
import {RadioGroup, RadioGroupItem} from '@shipfox/react-ui/radio-group';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {type ReactNode, useEffect, useState} from 'react';
import type {
  IntegrationConnection,
  RepositoryAccess,
  RepositoryAccessMode,
  RepositoryAccessOrigin,
} from '#core/models.js';
import {
  useIntegrationConnectionRepositoryAccessQuery,
  useIntegrationConnectionsQuery,
  useUpdateIntegrationConnectionRepositoryAccessMutation,
} from '#hooks/api/integrations.js';

export function ConnectionDetailsPage({
  workspaceSlug,
  connectionSlug,
}: {
  workspaceSlug: string;
  connectionSlug: string;
}) {
  const workspace = useActiveWorkspace();
  const connectionsQuery = useIntegrationConnectionsQuery(workspace.id);

  if (connectionsQuery.isPending) return <FullPageLoader aria-label="Loading connection details" />;

  if (connectionsQuery.isError && connectionsQuery.data === undefined) {
    return (
      <ConnectionDetailsShell workspaceSlug={workspaceSlug}>
        <QueryLoadError query={connectionsQuery} subject="integrations" />
      </ConnectionDetailsShell>
    );
  }

  const connection = connectionsQuery.data?.find(({slug}) => slug === connectionSlug);
  if (!connection) {
    return (
      <ConnectionDetailsShell workspaceSlug={workspaceSlug}>
        <EmptyState
          icon="errorWarningLine"
          tone="error"
          title="Integration connection not found"
          description="This integration does not exist, or you don't have access to it."
        />
      </ConnectionDetailsShell>
    );
  }

  return (
    <ConnectionDetailsShell workspaceSlug={workspaceSlug} connectionName={connection.displayName}>
      <RepositoryAccessSettings key={connection.id} connection={connection} />
    </ConnectionDetailsShell>
  );
}

function ConnectionDetailsShell({
  workspaceSlug,
  connectionName,
  children,
}: {
  workspaceSlug: string;
  connectionName?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-section">
      <Link
        to="/w/$workspaceSlug/settings/integrations"
        params={{workspaceSlug}}
        className="self-start text-sm text-foreground-neutral-muted hover:text-foreground-neutral-base"
      >
        Back to integrations
      </Link>
      <div className="flex min-w-0 flex-col gap-tight">
        <Header variant="h1">Repository access</Header>
        {connectionName ? (
          <Text size="sm" className="text-foreground-neutral-muted">
            {connectionName}
          </Text>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function RepositoryAccessSettings({connection}: {connection: IntegrationConnection}) {
  const accessQuery = useIntegrationConnectionRepositoryAccessQuery(connection.id);

  if (accessQuery.isPending) {
    return (
      <Panel>
        <PanelBody className="gap-group p-panel">
          <div role="status" className="sr-only">
            Loading repository access settings.
          </div>
          <Skeleton className="h-20 w-240" />
          <Skeleton className="h-48 w-full" />
        </PanelBody>
      </Panel>
    );
  }

  if (accessQuery.isError && accessQuery.data === undefined) {
    if (isForbiddenError(accessQuery.error)) return <AccessDeniedState />;
    if (isUnsupportedError(accessQuery.error)) return <UnsupportedState />;
    return (
      <Panel>
        <QueryLoadError query={accessQuery} subject="repository access settings" variant="panel" />
      </Panel>
    );
  }

  const access = accessQuery.data
    ? combineRepositoryAccessPages(accessQuery.data.pages)
    : undefined;
  if (!access) return <UnsupportedState />;

  return (
    <RepositoryAccessForm
      connection={connection}
      access={access}
      hasNextPage={accessQuery.hasNextPage}
      isFetchingNextPage={accessQuery.isFetchingNextPage}
      loadMoreError={accessQuery.isFetchNextPageError}
      onLoadMore={() => void accessQuery.fetchNextPage()}
    />
  );
}

function RepositoryAccessForm({
  connection,
  access,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  onLoadMore,
}: {
  connection: IntegrationConnection;
  access: RepositoryAccess;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
}) {
  const updateAccess = useUpdateIntegrationConnectionRepositoryAccessMutation();
  const [selectedMode, setSelectedMode] = useState<RepositoryAccessMode>(access.mode);
  const [persistedMode, setPersistedMode] = useState<RepositoryAccessMode>(access.mode);

  useEffect(() => {
    setSelectedMode(access.mode);
    setPersistedMode(access.mode);
  }, [access.mode]);

  const mutationError = updateAccess.error;
  if (isForbiddenError(mutationError)) return <AccessDeniedState />;
  if (isUnsupportedError(mutationError)) return <UnsupportedState />;

  const isDirty = selectedMode !== persistedMode;

  async function saveMode() {
    if (!isDirty) return;
    try {
      const savedMode = await updateAccess.mutateAsync({
        connectionId: connection.id,
        mode: selectedMode,
      });
      setPersistedMode(savedMode);
      toast.success('Repository access settings saved.');
    } catch {
      // The recoverable error is rendered from the mutation state below.
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-group">
      <Panel>
        <PanelHeader>
          <PanelTitle>Repository access mode</PanelTitle>
        </PanelHeader>
        <PanelBody className="gap-group p-panel">
          <Text size="sm" className="text-foreground-neutral-muted">
            Choose how Shipfox checks repository targets for this connection.
          </Text>
          <RadioGroup
            aria-label="Repository access mode"
            value={selectedMode}
            variant="cell"
            onValueChange={(value) => {
              if (isRepositoryAccessMode(value)) setSelectedMode(value);
            }}
            disabled={updateAccess.isPending}
          >
            <RadioGroupItem value="selected">
              <Text as="span" size="sm" bold>
                Selected direct targets
              </Text>
              <Text as="span" size="xs" className="text-foreground-neutral-muted">
                Shipfox checks repositories named directly by a checkout or tool against projects
                and manual grants. Some ID-based, organization-scoped, and indirect GitHub effects
                remain installation-scoped.
              </Text>
            </RadioGroupItem>
            <RadioGroupItem value="all">
              <Text as="span" size="sm" bold>
                All installation repositories
              </Text>
              <Text as="span" size="xs" className="text-foreground-neutral-muted">
                Shipfox performs no repository allowlist check; GitHub installation access is the
                boundary.
              </Text>
            </RadioGroupItem>
          </RadioGroup>

          {mutationError ? (
            <Callout role="alert" type="error">
              <CalloutContent>
                <CalloutTitle>Repository access settings were not saved</CalloutTitle>
                <CalloutDescription>
                  Try again. The current repository access mode is unchanged.
                </CalloutDescription>
              </CalloutContent>
            </Callout>
          ) : null}

          <div className="flex items-center gap-group">
            <Button
              type="button"
              isLoading={updateAccess.isPending}
              disabled={!isDirty}
              onClick={() => void saveMode()}
            >
              Save changes
            </Button>
            {updateAccess.isPending ? (
              <Text size="xs" role="status" className="text-foreground-neutral-muted">
                Saving repository access settings…
              </Text>
            ) : null}
          </div>
        </PanelBody>
      </Panel>

      {access.mode === 'selected' ? (
        <SelectedRepositories
          access={access}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          loadMoreError={loadMoreError}
          onLoadMore={onLoadMore}
        />
      ) : null}
      {connection.provider === 'github' ? (
        <GithubInstallationNotice connection={connection} />
      ) : null}
    </div>
  );
}

function SelectedRepositories({
  access,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  onLoadMore,
}: {
  access: RepositoryAccess;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Selected direct targets</PanelTitle>
      </PanelHeader>
      <PanelBody>
        {access.repositories.length === 0 ? (
          <EmptyState
            icon="folderOpenLine"
            title="No selected repositories"
            description="Repositories connected through projects or manual grants will appear here."
            variant="panel"
          />
        ) : (
          <ul>
            {access.repositories.map((repository) => (
              <PanelRow asChild key={repository.externalRepositoryId}>
                <li>
                  <div className="flex min-w-0 flex-col gap-tight">
                    <Text size="sm" bold>
                      {repository.owner}/{repository.name}
                    </Text>
                    <Text size="xs" className="truncate text-foreground-neutral-muted">
                      {repository.externalRepositoryId}
                    </Text>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-tight">
                    {repository.origins.map((origin) => (
                      <OriginLabel key={originKey(origin)} origin={origin} />
                    ))}
                  </div>
                </li>
              </PanelRow>
            ))}
          </ul>
        )}
        {loadMoreError ? (
          <Callout role="alert" type="error" className="m-panel-compact">
            <CalloutContent>
              <CalloutDescription>
                Could not load more selected repositories. Existing targets are still shown.
              </CalloutDescription>
            </CalloutContent>
          </Callout>
        ) : null}
        {hasNextPage ? (
          <div className="flex justify-center border-t border-border-neutral-base p-panel-compact">
            <Button
              type="button"
              variant="secondary"
              isLoading={isFetchingNextPage}
              onClick={onLoadMore}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </PanelBody>
    </Panel>
  );
}

function combineRepositoryAccessPages(pages: RepositoryAccess[]): RepositoryAccess | undefined {
  const firstPage = pages[0];
  if (!firstPage) return undefined;
  const nextCursor = pages.at(-1)?.nextCursor;
  return {
    mode: firstPage.mode,
    repositories: pages.flatMap((page) => page.repositories),
    ...(nextCursor === undefined ? {} : {nextCursor}),
  };
}

function OriginLabel({origin}: {origin: RepositoryAccessOrigin}) {
  return (
    <Text size="xs" className="text-foreground-neutral-muted">
      {origin.type === 'project' ? `Project: ${origin.projectName}` : 'Manual grant'}
    </Text>
  );
}

function GithubInstallationNotice({connection}: {connection: IntegrationConnection}) {
  const installationUrl = connection.externalUrl ?? 'https://github.com/settings/installations';
  return (
    <Callout type="info">
      <CalloutContent>
        <CalloutTitle>GitHub installation access still applies</CalloutTitle>
        <CalloutDescription>
          Selected mode limits repositories named directly by a checkout or tool. It does not limit
          every indirect or organization-scoped GitHub effect. For strict repository isolation,
          update the GitHub App installation&apos;s repository selection.{' '}
          <a href={installationUrl} target="_blank" rel="noreferrer noopener">
            Manage GitHub installation
          </a>
        </CalloutDescription>
      </CalloutContent>
    </Callout>
  );
}

function AccessDeniedState() {
  return (
    <EmptyState
      icon="errorWarningLine"
      tone="error"
      title="Access denied"
      description="Only workspace administrators can view or change repository access settings."
    />
  );
}

function UnsupportedState() {
  return (
    <EmptyState
      icon="errorWarningLine"
      tone="neutral"
      title="Repository access controls unavailable"
      description="This integration provider does not support repository access controls."
    />
  );
}

function isForbiddenError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.code === 'forbidden');
}

function isUnsupportedError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'integration-repository-access-unsupported';
}

function isRepositoryAccessMode(value: string): value is RepositoryAccessMode {
  return value === 'selected' || value === 'all';
}

function originKey(origin: RepositoryAccessOrigin): string {
  return origin.type === 'project' ? `project:${origin.projectId}` : `manual:${origin.grantId}`;
}
