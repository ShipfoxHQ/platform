import type {IntegrationConnectionDto, RepositoryDto} from '@shipfox/api-integration-core-dto';
import {createProjectBodySchema} from '@shipfox/api-projects-dto';
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
  Label,
  Skeleton,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {type FormEvent, useEffect, useRef, useState} from 'react';
import {ProjectPreviewRail, type ProjectPreviewState} from '#components/project-preview-rail.js';
import {
  integrationsQueryKeys,
  projectsQueryKeys,
  useCreateDebugConnectionMutation,
  useCreateProjectMutation,
  useRepositoriesQuery,
  useSourceConnectionsQuery,
} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

const REPOSITORY_NAME_SPLIT_RE = /[/-]/;

export function CreateProjectPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createConnection = useCreateDebugConnectionMutation();
  const createProject = useCreateProjectMutation();
  const errorRef = useRef<HTMLDivElement>(null);
  const connectionsQuery = useSourceConnectionsQuery(workspace?.id);
  const connections = connectionsQuery.data?.connections ?? [];
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const selectedConnection = connections.find(
    (connection) => connection.id === selectedConnectionId,
  );
  const repositoriesQuery = useRepositoriesQuery(selectedConnectionId);
  const repositories = repositoriesQuery.data?.repositories ?? [];
  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | undefined>();
  const selectedRepository = repositories.find(
    (repository) => repository.external_repository_id === selectedRepositoryId,
  );
  const [nameTouched, setNameTouched] = useState(false);
  const [name, setName] = useState('');
  const defaultProjectName = projectNameFromRepository(
    selectedRepository?.name ?? selectedRepositoryId ?? '',
  );
  const projectName = nameTouched ? name : defaultProjectName;
  const [formError, setFormError] = useState<string | undefined>();
  const [previewState, setPreviewState] = useState<ProjectPreviewState>('waiting');

  useEffect(() => {
    if (!selectedConnectionId && connections[0]) {
      setSelectedConnectionId(connections[0].id);
      setSelectedRepositoryId(undefined);
    }
  }, [connections, selectedConnectionId]);

  function selectConnection(connectionId: string) {
    setSelectedConnectionId(connectionId);
    setSelectedRepositoryId(undefined);
  }

  useEffect(() => {
    if (!selectedRepositoryId && repositories[0]) {
      setSelectedRepositoryId(repositories[0].external_repository_id);
    }
  }, [repositories, selectedRepositoryId]);

  async function onConnectDebug() {
    setFormError(undefined);
    if (!workspace) {
      setFormError('Workspace is still loading. Try again in a moment.');
      return;
    }

    try {
      const connection = await createConnection.mutateAsync({workspace_id: workspace.id});
      setSelectedConnectionId(connection.id);
      setSelectedRepositoryId(undefined);
      await queryClient.invalidateQueries({
        queryKey: integrationsQueryKeys.sourceConnections(workspace.id),
      });
      toast.success('Debug source control connected.');
    } catch (error) {
      const copy = projectErrorCopy(error);
      setFormError(`${copy.title}: ${copy.message}`);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setPreviewState('ready');
    if (!workspace) {
      setFormError('Workspace is still loading. Try again in a moment.');
      errorRef.current?.focus();
      return;
    }
    if (!selectedConnection) {
      setFormError('Connect a source-control integration before creating a project.');
      errorRef.current?.focus();
      return;
    }
    if (!selectedRepository) {
      setFormError('Choose a repository before creating a project.');
      errorRef.current?.focus();
      return;
    }
    if (!projectName.trim()) {
      setFormError('Project name is required.');
      errorRef.current?.focus();
      return;
    }

    setPreviewState('creating');
    try {
      const projectBody = createProjectBodySchema.parse({
        workspace_id: workspace.id,
        name: projectName.trim(),
        source: {
          connection_id: selectedConnection.id,
          external_repository_id: selectedRepository.external_repository_id,
        },
      });
      const project = await createProject.mutateAsync(projectBody);

      setPreviewState('created');
      await queryClient.invalidateQueries({queryKey: projectsQueryKeys.list(workspace.id)});
      queryClient.setQueryData(projectsQueryKeys.detail(project.id), project);
      toast.success('Project created.');
      await navigate({to: '/projects/$projectId', params: {projectId: project.id}});
    } catch (error) {
      const copy = projectErrorCopy(error);
      setPreviewState('error');
      if (copy.existingProjectId) {
        toast.info('Project already exists.');
        await navigate({to: '/projects/$projectId', params: {projectId: copy.existingProjectId}});
        return;
      }
      setFormError(`${copy.title}: ${copy.message}`);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-24">
        <header className="flex flex-col gap-8">
          <Button asChild variant="transparent" className="w-fit px-0">
            <Link to="/">Back to Projects</Link>
          </Button>
          <div>
            <Header variant="h1">Create project</Header>
            <Text size="md" className="text-foreground-neutral-muted">
              Connect source control, choose a repository, and create a project.
            </Text>
          </div>
        </header>

        <section className="grid gap-24 lg:grid-cols-[minmax(0,560px)_minmax(320px,1fr)]">
          <form onSubmit={onSubmit} noValidate aria-labelledby="create-project-title">
            <Card className="gap-20 p-24">
              <CardHeader>
                <CardTitle id="create-project-title" variant="h2">
                  Source setup
                </CardTitle>
                <CardDescription>
                  Debug source control provides local repositories for development.
                </CardDescription>
              </CardHeader>

              {formError ? (
                <Alert variant="error" animated={false}>
                  <div ref={errorRef} tabIndex={-1}>
                    {formError}
                  </div>
                </Alert>
              ) : null}

              <CardContent className="flex flex-col gap-18">
                <SourceConnectionPicker
                  connections={connections}
                  isLoading={connectionsQuery.isPending}
                  selectedConnectionId={selectedConnectionId}
                  onSelect={selectConnection}
                  onConnectDebug={onConnectDebug}
                  isConnecting={createConnection.isPending}
                />

                <RepositoryPicker
                  repositories={repositories}
                  isLoading={repositoriesQuery.isPending && Boolean(selectedConnectionId)}
                  selectedRepositoryId={selectedRepositoryId}
                  onSelect={setSelectedRepositoryId}
                  disabled={!selectedConnectionId}
                />

                <div className="flex flex-col gap-8">
                  <Label htmlFor="project-name">Project name</Label>
                  <input
                    id="project-name"
                    className="h-40 rounded-6 border border-border-neutral-base bg-background-neutral-base px-12 text-sm"
                    value={projectName}
                    onChange={(event) => {
                      setNameTouched(true);
                      setName(event.target.value);
                    }}
                    placeholder="Platform"
                  />
                </div>
              </CardContent>

              <Button
                type="submit"
                iconRight="chevronRight"
                isLoading={createProject.isPending}
                disabled={!selectedConnection || !selectedRepository}
              >
                Create project
              </Button>
            </Card>
          </form>

          <ProjectPreviewRail
            repositoryId={selectedRepositoryId ?? ''}
            connectionName={selectedConnection?.display_name}
            projectName={projectName}
            state={previewState}
            createdProject={createProject.data}
          />
        </section>
      </div>
    </main>
  );
}

function SourceConnectionPicker({
  connections,
  isLoading,
  selectedConnectionId,
  onSelect,
  onConnectDebug,
  isConnecting,
}: {
  connections: IntegrationConnectionDto[];
  isLoading: boolean;
  selectedConnectionId: string | undefined;
  onSelect: (connectionId: string) => void;
  onConnectDebug: () => void;
  isConnecting: boolean;
}) {
  return (
    <div className="flex flex-col gap-10">
      <div className="flex items-center justify-between gap-12">
        <Label>Source connection</Label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          isLoading={isConnecting}
          onClick={onConnectDebug}
        >
          Connect Debug
        </Button>
      </div>
      {isLoading ? <Skeleton className="h-58 w-full" /> : null}
      {!isLoading && connections.length === 0 ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-14">
          <Text size="sm" bold>
            No source-control connection
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            Connect Debug source control to list repositories.
          </Text>
        </div>
      ) : null}
      {connections.map((connection) => (
        <ConnectionButton
          key={connection.id}
          connection={connection}
          selected={connection.id === selectedConnectionId}
          onClick={() => onSelect(connection.id)}
        />
      ))}
    </div>
  );
}

function ConnectionButton({
  connection,
  selected,
  onClick,
}: {
  connection: IntegrationConnectionDto;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-14 text-left aria-pressed:border-border-highlights-interactive"
    >
      <Text size="sm" bold>
        {connection.display_name}
      </Text>
      <Text size="xs" className="text-foreground-neutral-muted">
        {connection.provider} · {connection.external_account_id}
      </Text>
    </button>
  );
}

function RepositoryPicker({
  repositories,
  isLoading,
  selectedRepositoryId,
  onSelect,
  disabled,
}: {
  repositories: RepositoryDto[];
  isLoading: boolean;
  selectedRepositoryId: string | undefined;
  onSelect: (repositoryId: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-10">
      <Label>Repository</Label>
      {disabled ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-14">
          <Text size="sm">Connect source control first.</Text>
        </div>
      ) : null}
      {isLoading ? <Skeleton className="h-58 w-full" /> : null}
      {!disabled && !isLoading && repositories.length === 0 ? (
        <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-14">
          <Text size="sm">No repositories found.</Text>
        </div>
      ) : null}
      {repositories.map((repository) => (
        <button
          key={repository.external_repository_id}
          type="button"
          aria-pressed={repository.external_repository_id === selectedRepositoryId}
          onClick={() => onSelect(repository.external_repository_id)}
          className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-14 text-left aria-pressed:border-border-highlights-interactive"
        >
          <Text size="sm" bold>
            {repository.full_name}
          </Text>
          <Text size="xs" className="text-foreground-neutral-muted">
            {repository.external_repository_id} · {repository.default_branch}
          </Text>
        </button>
      ))}
    </div>
  );
}

function projectNameFromRepository(repositoryId: string): string {
  return repositoryId
    .trim()
    .split(REPOSITORY_NAME_SPLIT_RE)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
