import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {QueryLoadError} from '@shipfox/client-ui';
import {Badge} from '@shipfox/react-ui/badge';
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
import type {IntegrationConnection, RepositoryAccess, RepositoryAccessMode} from '#core/models.js';
import {
  useIntegrationConnectionRepositoryAccessQuery,
  useIntegrationConnectionsQuery,
  useUpdateIntegrationConnectionRepositoryAccessMutation,
} from '#hooks/api/integrations.js';
import {PROVIDER_CATALOG} from '#provider-catalog.js';

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
      <RepositoryAccessSettings
        key={connection.id}
        connection={connection}
        workspaceSlug={workspaceSlug}
      />
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

function RepositoryAccessSettings({
  connection,
  workspaceSlug,
}: {
  connection: IntegrationConnection;
  workspaceSlug: string;
}) {
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
      workspaceSlug={workspaceSlug}
      access={access}
      hasNextPage={accessQuery.hasNextPage}
      isFetchingNextPage={accessQuery.isFetchingNextPage}
      loadMoreError={accessQuery.isFetchNextPageError}
      onLoadMore={() => void accessQuery.fetchNextPage()}
      isRefreshError={accessQuery.isRefetchError}
      isRefreshing={accessQuery.isRefetching}
      onRefresh={() => void accessQuery.refetch()}
    />
  );
}

function RepositoryAccessForm({
  connection,
  workspaceSlug,
  access,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  onLoadMore,
  isRefreshError,
  isRefreshing,
  onRefresh,
}: {
  connection: IntegrationConnection;
  workspaceSlug: string;
  access: RepositoryAccess;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  isRefreshError: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
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
  const providerName = PROVIDER_CATALOG[connection.provider]?.displayName;

  async function saveMode() {
    if (!isDirty) return;
    try {
      const savedMode = await updateAccess.mutateAsync({
        connectionId: connection.id,
        mode: selectedMode,
      });
      setPersistedMode(savedMode);
      toast.success('Access mode saved.');
    } catch {
      // The recoverable error is rendered from the mutation state below.
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-group">
      <Panel>
        <PanelHeader>
          <PanelTitle>Which repositories workflows can use</PanelTitle>
        </PanelHeader>
        <PanelBody className="gap-group p-panel">
          <Text size="sm" className="text-foreground-neutral-muted">
            {providerName
              ? `This integration can only access the repositories it was given on ${providerName}.`
              : 'This integration can only access the repositories it was given.'}{' '}
            This setting decides which of those workflows may use.
          </Text>
          <RadioGroup
            aria-label="Which repositories workflows can use"
            value={selectedMode}
            variant="cell"
            onValueChange={(value) => {
              if (isRepositoryAccessMode(value)) setSelectedMode(value);
            }}
            disabled={updateAccess.isPending}
          >
            <RadioGroupItem value="selected">
              <Text as="span" size="sm" bold>
                Only your projects&apos; repositories
              </Text>
              <Text as="span" size="xs" className="text-foreground-neutral-muted">
                Workflows can check out and act on the repositories your projects use, and nothing
                else.
              </Text>
            </RadioGroupItem>
            <RadioGroupItem value="all">
              <Text as="span" size="sm" bold>
                Every repository this integration can access
              </Text>
              <Text as="span" size="xs" className="text-foreground-neutral-muted">
                {providerName
                  ? `Workflows can use any repository this integration was given access to on ${providerName}.`
                  : 'Workflows can use any repository this integration was given access to.'}
              </Text>
            </RadioGroupItem>
          </RadioGroup>

          {mutationError ? (
            <Callout role="alert" type="error">
              <CalloutContent>
                <CalloutTitle>Couldn&apos;t save the access mode</CalloutTitle>
                <CalloutDescription>The previous mode still applies. Try again.</CalloutDescription>
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
                Saving access mode…
              </Text>
            ) : null}
          </div>
        </PanelBody>
      </Panel>

      {access.mode === 'selected' ? (
        <SelectedRepositories
          workspaceSlug={workspaceSlug}
          access={access}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          loadMoreError={loadMoreError}
          onLoadMore={onLoadMore}
          isRefreshError={isRefreshError}
          isRefreshing={isRefreshing}
          onRefresh={onRefresh}
        />
      ) : null}
      <ProviderAccessNotice connection={connection} mode={access.mode} />
    </div>
  );
}

function SelectedRepositories({
  access,
  workspaceSlug,
  hasNextPage,
  isFetchingNextPage,
  loadMoreError,
  onLoadMore,
  isRefreshError,
  isRefreshing,
  onRefresh,
}: {
  access: RepositoryAccess;
  workspaceSlug: string;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  isRefreshError: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Your projects&apos; repositories</PanelTitle>
      </PanelHeader>
      <PanelBody>
        {isRefreshError ? (
          <Callout role="alert" type="error" className="m-panel-compact">
            <CalloutContent>
              <CalloutTitle>Repository access may be out of date</CalloutTitle>
              <CalloutDescription>
                The last refresh failed. The repositories already listed may have changed.
              </CalloutDescription>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                isLoading={isRefreshing}
                onClick={onRefresh}
              >
                Retry refresh
              </Button>
            </CalloutContent>
          </Callout>
        ) : null}
        {access.repositories.length === 0 ? (
          <EmptyState
            icon="folderOpenLine"
            title="No project repositories yet"
            description="Create a Shipfox project to connect a repository."
            variant="panel"
            action={
              <Button asChild variant="secondary" size="sm">
                <Link to="/w/$workspaceSlug/projects/new" params={{workspaceSlug}}>
                  Create project
                </Link>
              </Button>
            }
          />
        ) : (
          <ul>
            {access.repositories.map((repository) => {
              const repositoryName = `${repository.owner}/${repository.name}`;
              return (
                <PanelRow asChild key={repository.externalRepositoryId}>
                  <li>
                    <div className="flex min-w-0 flex-col gap-tight">
                      <Text size="sm" bold>
                        {repositoryName}
                      </Text>
                      <Text size="xs" className="truncate text-foreground-neutral-muted">
                        {repository.externalRepositoryId}
                      </Text>
                    </div>
                    <Badge variant="neutral">{repository.projectName}</Badge>
                  </li>
                </PanelRow>
              );
            })}
          </ul>
        )}
        {loadMoreError ? (
          <Callout role="alert" type="error" className="m-panel-compact">
            <CalloutContent>
              <CalloutDescription>
                Couldn&apos;t load more repositories. Those already listed are unaffected.
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

interface ProviderAccessNoticeCopy {
  title: string;
  description: string;
  /** Shown only in projects mode: tools the provider exposes that Shipfox cannot scope by repository. */
  projectsModeCaveat?: string;
  linkLabel: string;
  fallbackUrl: string;
}

// Where the outer repository list is managed is provider-specific. Providers without an entry
// get no notice; the panel copy above stays provider-neutral.
const PROVIDER_ACCESS_NOTICES: Record<string, ProviderAccessNoticeCopy> = {
  github: {
    title: 'Repository access is set on GitHub',
    description: 'To add or remove repositories the GitHub App can access, change it on GitHub.',
    projectsModeCaveat:
      "A few tools, such as replying to a review thread, don't name a repository, so Shipfox can't limit them to your projects.",
    linkLabel: 'Change repositories on GitHub',
    fallbackUrl: 'https://github.com/settings/installations',
  },
};

function ProviderAccessNotice({
  connection,
  mode,
}: {
  connection: IntegrationConnection;
  mode: RepositoryAccessMode;
}) {
  const copy = PROVIDER_ACCESS_NOTICES[connection.provider];
  if (!copy) return null;
  const caveat = mode === 'selected' ? copy.projectsModeCaveat : undefined;
  return (
    <Callout type="info">
      <CalloutContent>
        <CalloutTitle>{copy.title}</CalloutTitle>
        <CalloutDescription>
          {copy.description}
          {caveat ? ` ${caveat}` : null}{' '}
          <a
            href={connection.externalUrl ?? copy.fallbackUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            {copy.linkLabel}
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
