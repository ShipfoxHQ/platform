import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  ConnectionStatusBadge,
  type IntegrationConnection,
  IntegrationIcon,
  useIntegrationConnectionsQuery,
} from '@shipfox/client-integrations';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Card} from '@shipfox/react-ui/card';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Input} from '@shipfox/react-ui/input';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Header, Text} from '@shipfox/react-ui/typography';
import {Link, useNavigate} from '@tanstack/react-router';
import {ModelProviderReminderBanner} from '#components/model-provider-reminder-banner.js';
import type {Project} from '#core/project.js';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';

export function ProjectsHubPage({search = ''}: {search?: string}) {
  const workspace = useActiveWorkspace();
  const navigate = useNavigate();
  const query = useProjectsInfiniteQuery(workspace.id, search || undefined);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];

  // The provider logo and connection health live on the integration connection,
  // not the project, so resolve them once for the whole list and index by id.
  // Skip the fetch when there are no cards to annotate.
  const connectionsQuery = useIntegrationConnectionsQuery(
    projects.length > 0 ? workspace.id : undefined,
  );
  const connectionsById = new Map(
    (connectionsQuery.data ?? []).map((connection) => [connection.id, connection]),
  );

  const isInitialLoading = query.isPending;
  const isSearching = Boolean(search) && query.isFetching && !query.isFetchingNextPage;
  const hasNoData = !query.data;

  return (
    <div className="flex w-full flex-col gap-section">
      <header className="flex flex-col gap-group">
        <div className="flex items-start justify-between gap-section max-[640px]:flex-col">
          <Header variant="h2">Projects</Header>
        </div>
        <div className="flex items-center gap-cluster max-[640px]:flex-col max-[640px]:items-stretch">
          <Input
            type="search"
            value={search}
            onChange={(event) => {
              const next = event.target.value.trim();
              navigate({search: (next ? {search: next} : {}) as never, replace: true});
            }}
            placeholder="Search projects…"
            aria-label="Search projects"
            className="flex-1"
            iconLeft={<Icon name="searchLine" className="size-16" />}
            iconRight={
              isSearching ? (
                <Icon
                  name="spinner"
                  size={16}
                  className="text-foreground-neutral-muted"
                  aria-hidden="true"
                />
              ) : undefined
            }
          />
          <Button asChild iconLeft="addLine" className="shrink-0 max-[640px]:w-full">
            <Link to="/w/$workspaceSlug/projects/new" params={{workspaceSlug: workspace.slug}}>
              New project
            </Link>
          </Button>
        </div>
      </header>

      <ModelProviderReminderBanner workspaceId={workspace.id} />

      {isInitialLoading || (search && hasNoData && query.isFetching) ? <ProjectsSkeleton /> : null}

      {query.isError && hasNoData ? <QueryLoadError query={query} subject="projects" /> : null}

      {!isInitialLoading && !query.isError && projects.length === 0 && !search ? (
        <EmptyProjects workspaceSlug={workspace.slug} />
      ) : null}

      {!query.isFetching && !query.isError && projects.length === 0 && search ? (
        <NoSearchResults
          search={search}
          onClear={() => navigate({search: {} as never, replace: true})}
        />
      ) : null}

      {projects.length > 0 ? (
        <section className="flex flex-col gap-group" aria-label="Projects list">
          <ul className="grid grid-cols-2 gap-cluster max-[760px]:grid-cols-1">
            {projects.map((project) => (
              <ProjectCard
                project={project}
                connection={connectionsById.get(project.source.connectionId)}
                connectionsResolved={connectionsQuery.isSuccess}
                connectionsSettled={connectionsQuery.isSuccess || connectionsQuery.isError}
                key={project.id}
                workspaceSlug={workspace.slug}
              />
            ))}
          </ul>
          {query.error && query.data ? (
            <Callout role="alert" type="error">
              <Text size="sm">
                Could not load the next page. Existing projects are still shown.
              </Text>
            </Callout>
          ) : null}
          {query.hasNextPage ? (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                isLoading={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                Load more
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function ProjectsSkeleton() {
  return (
    <ul
      role="status"
      aria-label="Loading projects"
      className="grid grid-cols-2 gap-cluster max-[760px]:grid-cols-1"
    >
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <li key={row}>
          <Card className="h-full p-panel-compact">
            <div className="flex items-center gap-cluster">
              <Skeleton className="size-24 shrink-0" />
              <Skeleton className="h-16 w-1/2" />
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function EmptyProjects({workspaceSlug}: {workspaceSlug: string}) {
  return (
    <EmptyState
      icon="folderLine"
      title="Create your first project"
      description="Connect a repository-backed project to start building workflows."
      action={
        <Button asChild iconRight="chevronRight">
          <Link to="/w/$workspaceSlug/projects/new" params={{workspaceSlug}}>
            Create project
          </Link>
        </Button>
      }
    />
  );
}

function NoSearchResults({search, onClear}: {search: string; onClear: () => void}) {
  return (
    <EmptyState
      icon="searchLine"
      title={`No projects match “${search}”`}
      description="Try a different search, or clear it to see all projects."
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

function ProjectCard({
  project,
  connection,
  connectionsResolved,
  connectionsSettled,
  workspaceSlug,
}: {
  project: Project;
  connection: IntegrationConnection | undefined;
  connectionsResolved: boolean;
  connectionsSettled: boolean;
  workspaceSlug: string;
}) {
  // On a resolved fetch, `active` carries no badge while a missing connection
  // reads as an error so a broken source is still flagged. An unresolved or
  // failed fetch shows nothing, so a fetch failure never flags every card.
  const status = connectionsResolved ? (connection?.lifecycleStatus ?? 'error') : undefined;

  return (
    <li>
      <Link
        to="/w/$workspaceSlug/p/$projectSlug"
        params={{workspaceSlug, projectSlug: project.slug}}
        className="block h-full rounded-8 focus-visible:shadow-button-neutral-focus focus-visible:outline-none"
      >
        <Card className="h-full p-panel-compact transition-colors hover:bg-background-components-hover">
          <div className="flex min-w-0 items-center gap-cluster">
            {/* Settle on success or error: a failed fetch falls back to the
                neutral provider icon rather than spinning forever. */}
            {connectionsSettled ? (
              <IntegrationIcon
                source={connection?.provider}
                aria-hidden
                className="size-24 shrink-0 text-foreground-neutral-base"
              />
            ) : (
              <Skeleton className="size-24 shrink-0" />
            )}
            <div className="flex min-w-0 flex-1 items-center gap-inline">
              <Text size="md" bold className="truncate">
                {project.name}
              </Text>
              {status ? <ConnectionStatusBadge status={status} className="shrink-0" /> : null}
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}
