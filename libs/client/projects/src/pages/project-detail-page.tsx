import {
  Alert,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Header,
  Skeleton,
  StatusBadge,
  Text,
} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useProjectQuery} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

export function ProjectDetailPage({projectId}: {projectId: string}) {
  const query = useProjectQuery(projectId);
  const errorCopy = query.error ? projectErrorCopy(query.error) : undefined;

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-24">
        <Button asChild variant="transparent" className="w-fit px-0">
          <Link to="/">Back to Projects</Link>
        </Button>

        {query.isPending ? (
          <Card className="p-24">
            <Skeleton className="h-28 w-1/3" />
            <Skeleton className="h-18 w-1/2" />
          </Card>
        ) : null}

        {query.isError ? (
          <Alert variant="error" animated={false}>
            <div className="flex flex-col gap-8">
              <Text size="sm" bold>
                {errorCopy?.title ?? 'Project unavailable'}
              </Text>
              <Text size="sm">
                {query.error && 'status' in query.error && query.error.status === 404
                  ? 'This project was not found.'
                  : errorCopy?.message}
              </Text>
              <Button size="sm" variant="secondary" onClick={() => query.refetch()}>
                Retry
              </Button>
            </div>
          </Alert>
        ) : null}

        {query.data ? (
          <>
            <header className="flex items-start justify-between gap-24 max-[640px]:flex-col">
              <div className="min-w-0">
                <Header variant="h1" className="break-words">
                  {query.data.name}
                </Header>
                <Text size="md" className="text-foreground-neutral-muted break-words">
                  {query.data.repository.full_name}
                </Text>
              </div>
              <StatusBadge variant="success">Connected</StatusBadge>
            </header>

            <section className="grid gap-18 lg:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="p-20">
                <CardHeader>
                  <CardTitle variant="h2">Repository identity</CardTitle>
                  <CardDescription>Immutable provider binding for this project.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-12 sm:grid-cols-2">
                  <Metadata label="Provider" value={query.data.repository.provider} />
                  <Metadata label="Provider host" value={query.data.repository.provider_host} />
                  <Metadata
                    label="External repository id"
                    value={query.data.repository.external_repository_id}
                  />
                  <Metadata label="Default branch" value={query.data.repository.default_branch} />
                  <Metadata label="Visibility" value={query.data.repository.visibility} />
                  <Metadata label="Clone URL" value={query.data.repository.clone_url} />
                  <Metadata label="HTML URL" value={query.data.repository.html_url} />
                </CardContent>
              </Card>

              <Card className="p-20">
                <CardHeader>
                  <CardTitle variant="h3">Workflow discovery</CardTitle>
                  <CardDescription>
                    Definitions from .shipfox workflows will appear here in a later phase.
                  </CardDescription>
                </CardHeader>
              </Card>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Metadata({label, value}: {label: string; value: string}) {
  return (
    <div className="min-w-0 rounded-8 border border-border-neutral-base bg-background-neutral-base p-14">
      <Text size="xs" className="text-foreground-neutral-muted">
        {label}
      </Text>
      <Text size="sm" className="break-words">
        {value}
      </Text>
    </div>
  );
}
