import type {ProjectResponseDto} from '@shipfox/api-projects-dto';
import {useAuthState} from '@shipfox/client-auth';
import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
  Icon,
  Skeleton,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useProjectsInfiniteQuery} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

export function ProjectsHubPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const query = useProjectsInfiniteQuery(workspace?.id);
  const projects = query.data?.pages.flatMap((page) => page.projects) ?? [];
  const errorCopy = query.error ? projectErrorCopy(query.error) : undefined;

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-24">
        <header className="flex items-start justify-between gap-24 max-[640px]:flex-col">
          <div className="min-w-0">
            <Header variant="h1">Projects</Header>
            <Text size="md" className="text-foreground-neutral-muted break-words">
              {workspace?.name ?? 'Workspace'} · Signed in as{' '}
              {auth.user?.email ?? 'your Shipfox account'}
            </Text>
          </div>
          <div className="flex flex-col items-end gap-8 max-[640px]:items-start">
            <Button asChild iconLeft="addLine">
              <Link to="/projects/new">Create project</Link>
            </Button>
          </div>
        </header>

        {query.isPending ? <ProjectsSkeleton /> : null}

        {query.isError && !query.data ? (
          <Alert variant="error">
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                {errorCopy?.title}
              </Text>
              <Text size="sm">{errorCopy?.message}</Text>
              <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : null}

        {!query.isPending && !query.isError && projects.length === 0 ? <EmptyProjects /> : null}

        {projects.length > 0 ? (
          <section className="flex flex-col gap-12" aria-label="Projects list">
            {projects.map((project) => (
              <ProjectRow project={project} key={project.id} />
            ))}
            {query.error && query.data ? (
              <Alert variant="warning">
                <Text size="sm">
                  Could not load the next page. Existing projects are still shown.
                </Text>
              </Alert>
            ) : null}
            {query.hasNextPage ? (
              <Button
                variant="secondary"
                isLoading={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                Load more
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-12" role="status" aria-label="Loading projects">
      {[0, 1, 2].map((row) => (
        <Card className="p-18" key={row}>
          <Skeleton className="h-20 w-1/3" />
          <Skeleton className="h-16 w-2/3" />
        </Card>
      ))}
    </div>
  );
}

function EmptyProjects() {
  return (
    <Card className="items-center gap-18 p-32 text-center">
      <div className="flex size-44 items-center justify-center rounded-8 border border-border-neutral-base bg-background-neutral-base">
        <Icon name="folderLine" className="size-24 text-background-highlight-interactive" />
      </div>
      <CardHeader className="items-center">
        <CardTitle variant="h2">Create your first project</CardTitle>
        <CardDescription>
          Connect a repository-backed project to start building workflows.
        </CardDescription>
      </CardHeader>
      <Button asChild iconRight="chevronRight">
        <Link to="/projects/new">Create project</Link>
      </Button>
    </Card>
  );
}

function ProjectRow({project}: {project: ProjectResponseDto}) {
  return (
    <Card className="p-18">
      <Link to="/projects/$projectId" params={{projectId: project.id}} className="block">
        <CardContent className="flex items-center justify-between gap-18 max-[640px]:flex-col max-[640px]:items-start">
          <div className="min-w-0">
            <Text size="lg" bold className="truncate">
              {project.name}
            </Text>
            <Text size="sm" className="text-foreground-neutral-muted truncate">
              {project.source.external_repository_id}
            </Text>
          </div>
          <StatusBadge variant="success">Connected</StatusBadge>
        </CardContent>
      </Link>
    </Card>
  );
}
