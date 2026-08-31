import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  ConnectionStatusBadge,
  type IntegrationConnection,
  IntegrationIcon,
  useIntegrationConnectionsQuery,
} from '@shipfox/client-integrations';
import {useChrome} from '@shipfox/client-shell/runtime';
import {QueryLoadError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {Icon} from '@shipfox/react-ui/icon';
import {Input} from '@shipfox/react-ui/input';
import {
  Panel,
  PanelActions,
  PanelBody,
  PanelCell,
  PanelCellAction,
  PanelGrid,
  PanelHeader,
} from '@shipfox/react-ui/panel';
import {Skeleton} from '@shipfox/react-ui/skeleton';
import {Text} from '@shipfox/react-ui/typography';
import {Link, useNavigate} from '@tanstack/react-router';
import type {Project} from '#core/project.js';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';

export function ProjectsHubPage({search = ''}: {search?: string}) {
  const workspace = useActiveWorkspace();
  const {WorkspaceSetupChecklist} = useChrome();
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

  const isSearching = Boolean(search) && query.isFetching && !query.isFetchingNextPage;

  return (
    <div className="flex w-full flex-col gap-section">
      {WorkspaceSetupChecklist ? <WorkspaceSetupChecklist /> : null}

      <section aria-label="Projects">
        <Panel>
          <PanelHeader className="flex-wrap max-[640px]:items-stretch">
            <div className="min-w-0 flex-1 max-[640px]:basis-full">
              <Input
                type="search"
                value={search}
                onChange={(event) => {
                  const next = event.target.value.trim();
                  navigate({search: (next ? {search: next} : {}) as never, replace: true});
                }}
                placeholder="Search projects…"
                aria-label="Search projects"
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
            </div>
            <PanelActions className="max-[640px]:ml-0 max-[640px]:w-full">
              <Button asChild iconLeft="addLine" className="max-[640px]:w-full">
                <Link to="/w/$workspaceSlug/projects/new" params={{workspaceSlug: workspace.slug}}>
                  New project
                </Link>
              </Button>
            </PanelActions>
          </PanelHeader>

          <PanelBody>
            <ProjectsPanelContent
              query={query}
              projects={projects}
              search={search}
              workspaceSlug={workspace.slug}
              connectionsById={connectionsById}
              connectionsResolved={connectionsQuery.isSuccess}
              connectionsSettled={connectionsQuery.isSuccess || connectionsQuery.isError}
              onClear={() => navigate({search: {} as never, replace: true})}
            />
          </PanelBody>
        </Panel>
      </section>
    </div>
  );
}

function ProjectsPanelContent({
  query,
  projects,
  search,
  workspaceSlug,
  connectionsById,
  connectionsResolved,
  connectionsSettled,
  onClear,
}: {
  query: ReturnType<typeof useProjectsInfiniteQuery>;
  projects: Project[];
  search: string;
  workspaceSlug: string;
  connectionsById: ReadonlyMap<string, IntegrationConnection>;
  connectionsResolved: boolean;
  connectionsSettled: boolean;
  onClear: () => void;
}) {
  const hasNoData = !query.data;
  const hasNoProjects = projects.length === 0;
  if (query.isPending || (Boolean(search) && hasNoData && query.isFetching)) {
    return <ProjectsSkeleton />;
  }
  if (query.isError && hasNoData) {
    return <QueryLoadError query={query} subject="projects" variant="panel" />;
  }
  if (hasNoProjects && !search) {
    return <EmptyProjects workspaceSlug={workspaceSlug} />;
  }
  if (!query.isFetching && hasNoProjects && search) {
    return <NoSearchResults search={search} onClear={onClear} />;
  }
  if (hasNoProjects) return null;
  return (
    <ProjectsList
      query={query}
      projects={projects}
      workspaceSlug={workspaceSlug}
      connectionsById={connectionsById}
      connectionsResolved={connectionsResolved}
      connectionsSettled={connectionsSettled}
    />
  );
}

function ProjectsList({
  query,
  projects,
  workspaceSlug,
  connectionsById,
  connectionsResolved,
  connectionsSettled,
}: {
  query: ReturnType<typeof useProjectsInfiniteQuery>;
  projects: Project[];
  workspaceSlug: string;
  connectionsById: ReadonlyMap<string, IntegrationConnection>;
  connectionsResolved: boolean;
  connectionsSettled: boolean;
}) {
  return (
    <>
      <PanelGrid aria-label="Projects list">
        {projects.map((project) => (
          <ProjectCell
            project={project}
            connection={connectionsById.get(project.source.connectionId)}
            connectionsResolved={connectionsResolved}
            connectionsSettled={connectionsSettled}
            key={project.id}
            workspaceSlug={workspaceSlug}
          />
        ))}
      </PanelGrid>
      {query.error && query.data ? (
        <div className="border-t border-border-neutral-base p-panel-compact">
          <Callout role="alert" type="error">
            <Text size="sm">Could not load the next page. Existing projects are still shown.</Text>
          </Callout>
        </div>
      ) : null}
      {query.hasNextPage ? (
        <div className="flex justify-center border-t border-border-neutral-base p-panel-compact">
          <Button
            variant="secondary"
            isLoading={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
          >
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ProjectsSkeleton() {
  return (
    <PanelGrid role="status" aria-label="Loading projects">
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <PanelCell key={row}>
          <div className="flex items-center gap-cluster px-row py-row">
            <Skeleton className="size-24 shrink-0" />
            <Skeleton className="h-16 w-1/2" />
          </div>
        </PanelCell>
      ))}
    </PanelGrid>
  );
}

function EmptyProjects({workspaceSlug}: {workspaceSlug: string}) {
  return (
    <EmptyState
      icon="folderLine"
      title="Create your first project"
      description="Connect a repository-backed project to start building workflows."
      variant="panel"
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
      variant="panel"
      action={
        <Button size="sm" variant="secondary" onClick={onClear}>
          Clear search
        </Button>
      }
    />
  );
}

function ProjectCell({
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
    <PanelCell>
      <PanelCellAction asChild>
        <Link
          to="/w/$workspaceSlug/p/$projectSlug"
          params={{workspaceSlug, projectSlug: project.slug}}
        >
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
          <span className="flex min-w-0 flex-1 items-center gap-inline">
            <Text as="span" size="md" bold className="truncate">
              {project.name}
            </Text>
            {status ? <ConnectionStatusBadge status={status} className="shrink-0" /> : null}
          </span>
        </Link>
      </PanelCellAction>
    </PanelCell>
  );
}
