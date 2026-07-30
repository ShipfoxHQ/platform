import {slugifyName} from '@shipfox/api-common-dto';
import {createProjectBodySchema} from '@shipfox/api-projects-dto';
import {useMaybeActiveWorkspace} from '@shipfox/client-auth';
import {
  ConnectionPicker,
  type IntegrationConnection,
  IntegrationIcon,
  RepositoryPicker,
  useRepositoriesInfiniteQuery,
  useSourceConnectionsQuery,
} from '@shipfox/client-integrations';
import {displayNameFieldError} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {Link, Navigate, useNavigate} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {ModelProviderReminderBanner} from '#components/model-provider-reminder-banner.js';
import {type CreateProjectCommand, projectNameFromRepository} from '#core/project.js';
import {useCreateProjectMutation} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

export function CreateProjectPage() {
  const workspace = useMaybeActiveWorkspace();
  const navigate = useNavigate();
  const createProject = useCreateProjectMutation();
  const errorRef = useRef<HTMLDivElement>(null);

  const connectionsQuery = useSourceConnectionsQuery(workspace?.id);
  const connections = connectionsQuery.data ?? [];

  const [selectedConnectionId, setSelectedConnectionId] = useState<string | undefined>();
  const singleConnectionId = connections.length === 1 ? connections[0]?.id : undefined;
  const effectiveSelectedConnectionId = selectedConnectionId ?? singleConnectionId;
  useEffect(() => {
    if (singleConnectionId && selectedConnectionId !== singleConnectionId) {
      setSelectedConnectionId(singleConnectionId);
    }
  }, [singleConnectionId, selectedConnectionId]);

  const selectedConnection: IntegrationConnection | undefined = connections.find(
    (connection) => connection.id === effectiveSelectedConnectionId,
  );

  const [repoFilter, setRepoFilter] = useState('');
  const debouncedRepoFilter = useDebouncedValue(repoFilter, 250);
  const trimmedFilter = debouncedRepoFilter.trim();

  const repositoriesQuery = useRepositoriesInfiniteQuery(
    effectiveSelectedConnectionId,
    trimmedFilter ? {search: trimmedFilter} : undefined,
  );
  const repositories = repositoriesQuery.data?.pages.flatMap((page) => page.repositories) ?? [];

  const [selectedRepositoryId, setSelectedRepositoryId] = useState<string | undefined>();
  useEffect(() => {
    if (!selectedRepositoryId && repositories[0]) {
      setSelectedRepositoryId(repositories[0].externalRepositoryId);
    }
  }, [repositories, selectedRepositoryId]);
  const selectedRepository = repositories.find(
    (repository) => repository.externalRepositoryId === selectedRepositoryId,
  );

  const [nameTouched, setNameTouched] = useState(false);
  const defaultProjectName = projectNameFromRepository(
    selectedRepository?.name ?? selectedRepositoryId ?? '',
  );
  const defaultProjectSlug = slugifyName(defaultProjectName, {fallback: 'project'});

  const [formError, setFormError] = useState<string | undefined>();
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugConflict, setSlugConflict] = useState(false);

  const form = useForm({
    defaultValues: {name: defaultProjectName, slug: defaultProjectSlug},
    onSubmit: async ({value}) => {
      const projectSlug = slugTouched ? value.slug : slugifyName(value.name, {fallback: 'project'});
      await createProjectFromForm(nameTouched ? value.name : defaultProjectName, projectSlug);
    },
  });

  useEffect(() => {
    if (!nameTouched && form.state.values.name !== defaultProjectName) {
      form.setFieldValue('name', defaultProjectName);
      if (!slugTouched) {
        form.setFieldValue('slug', slugifyName(defaultProjectName, {fallback: 'project'}));
      }
    }
  }, [defaultProjectName, form, nameTouched, slugTouched]);

  function selectConnection(connectionId: string) {
    setSelectedConnectionId(connectionId);
    setSelectedRepositoryId(undefined);
  }

  if (connectionsQuery.isPending) {
    return <FullPageLoader />;
  }

  if (!workspace) {
    return <FullPageLoader />;
  }

  if (!connectionsQuery.isError && connections.length === 0) {
    return <Navigate to="/workspaces/$wid/integrations" params={{wid: workspace.id}} replace />;
  }

  async function createProjectFromForm(projectName: string, projectSlug: string) {
    setFormError(undefined);
    setSlugConflict(false);
    if (!workspace) {
      setFormError('Workspace is still loading. Try again in a moment.');
      errorRef.current?.focus();
      return;
    }
    if (!selectedConnection) {
      setFormError('Choose a source integration before creating a project.');
      errorRef.current?.focus();
      return;
    }
    if (!selectedRepository) {
      setFormError('Choose a repository before creating a project.');
      errorRef.current?.focus();
      return;
    }

    try {
      const command: CreateProjectCommand = {
        workspaceId: workspace.id,
        name: projectName,
        slug: projectSlug,
        source: {
          connectionId: selectedConnection.id,
          externalRepositoryId: selectedRepository.externalRepositoryId,
        },
      };
      const project = await createProject.mutateAsync(command);
      toast.success('Project created.');
      await navigate({
        to: '/workspaces/$wid/projects/$pid',
        params: {wid: workspace.id, pid: project.id},
      });
    } catch (error) {
      const copy = projectErrorCopy(error);
      if (copy.existingProjectId) {
        toast.info('Project already exists.');
        await navigate({
          to: '/workspaces/$wid/projects/$pid',
          params: {wid: workspace.id, pid: copy.existingProjectId},
        });
        return;
      }
      if (copy.slugConflict) {
        setSlugConflict(true);
        requestAnimationFrame(() => document.getElementById('project-slug')?.focus());
        return;
      }
      setFormError(`${copy.title}: ${copy.message}`);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  const showRepoPicker = Boolean(selectedConnection);
  const filteredEmptyMessage = trimmedFilter
    ? `No repositories matching "${repoFilter.trim()}".`
    : 'No repositories visible to this connection.';

  return (
    <div className="flex w-full flex-col gap-24">
      <header className="flex flex-col gap-6">
        <Header id="create-project-title" variant="h1">
          Create project
        </Header>
        <Text size="sm" className="text-foreground-neutral-muted">
          A Shipfox project starts from a Git repository. Choose the repository Shipfox should
          track, then give the project a name.
        </Text>
      </header>

      <ModelProviderReminderBanner workspaceId={workspace.id} />

      {connectionsQuery.isError ? (
        <Callout role="alert" type="error">
          <div className="flex w-full flex-wrap items-center justify-between gap-12">
            <Text size="sm" className="min-w-[240px] flex-1">
              Could not load source integrations. Refresh the integrations list to continue.
            </Text>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => connectionsQuery.refetch()}
              className="shrink-0"
            >
              Refresh integrations
            </Button>
          </div>
        </Callout>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
        noValidate
        aria-labelledby="create-project-title"
        className="grid items-start gap-32 lg:grid-cols-[minmax(0,1fr)_340px]"
      >
        <div className="flex min-w-0 flex-col gap-32">
          <section className="flex flex-col gap-16" aria-label="Source integration">
            <div className="flex items-start justify-between gap-16">
              <div className="flex flex-col gap-4">
                <Header variant="h3">Source integration</Header>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Choose the integration that can access the repository.
                </Text>
              </div>

              {connections.length === 1 ? (
                <Button asChild variant="transparent" size="sm" className="shrink-0">
                  <Link to="/workspaces/$wid/integrations" params={{wid: workspace.id}}>
                    Add another integration
                  </Link>
                </Button>
              ) : null}
            </div>

            {connections.length > 0 ? (
              <ConnectionPicker
                connections={connections}
                selectedConnectionId={effectiveSelectedConnectionId}
                onSelect={selectConnection}
              />
            ) : null}
          </section>

          {showRepoPicker ? (
            <section className="flex flex-col gap-16" aria-label="Repository">
              <div className="flex flex-col gap-4">
                <Header variant="h3">Repository</Header>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Select the repository this project tracks.
                </Text>
              </div>

              <RepositoryPicker
                repositories={repositories}
                selectedRepositoryId={selectedRepositoryId}
                onSelect={setSelectedRepositoryId}
                isLoading={repositoriesQuery.isPending}
                isFetchingNextPage={repositoriesQuery.isFetchingNextPage}
                hasNextPage={repositoriesQuery.hasNextPage}
                onLoadMore={() => repositoriesQuery.fetchNextPage()}
                emptyMessage={filteredEmptyMessage}
                searchValue={repoFilter}
                onSearchChange={setRepoFilter}
              />
            </section>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-32">
          <div className="flex flex-col gap-18 rounded-8 border border-border-neutral-base bg-background-neutral-base p-20">
            <div className="flex flex-col gap-4">
              <Header variant="h3">Project details</Header>
              <Text size="sm" className="text-foreground-neutral-muted">
                Confirm the source and create the project.
              </Text>
            </div>

            {formError ? (
              <Callout role="alert" type="error">
                <div ref={errorRef} tabIndex={-1}>
                  {formError}
                </div>
              </Callout>
            ) : null}

            <ProjectSummary
              connection={selectedConnection}
              repositoryName={selectedRepository?.fullName}
            />

            <form.Field
              name="name"
              validators={{
                onBlur: ({value}) =>
                  displayNameFieldError(value, 'Project name', createProjectBodySchema.shape.name),
                onSubmit: ({value}) =>
                  displayNameFieldError(value, 'Project name', createProjectBodySchema.shape.name),
              }}
            >
              {(field) => (
                <FormField label="Project name" id="project-name" error={fieldError(field)}>
                  <FormFieldInput
                    name="name"
                    type="text"
                    value={field.state.value}
                    onChange={(event) => {
                      const nextName = event.target.value;
                      setNameTouched(true);
                      field.handleChange(nextName);
                      if (!slugTouched) {
                        form.setFieldValue('slug', slugifyName(nextName, {fallback: 'project'}));
                      }
                    }}
                    onBlur={field.handleBlur}
                    placeholder="Platform"
                  />
                </FormField>
              )}
            </form.Field>

            <form.Field
              name="slug"
              validators={{
                onBlur: createProjectBodySchema.shape.slug,
                onSubmit: createProjectBodySchema.shape.slug,
              }}
            >
              {(field) => (
                <FormField
                  label="Project slug"
                  id="project-slug"
                  error={slugConflict ? 'This project slug is already in use.' : fieldError(field)}
                >
                  <FormFieldInput
                    name="slug"
                    type="text"
                    value={field.state.value}
                    onChange={(event) => {
                      setSlugTouched(true);
                      setSlugConflict(false);
                      field.handleChange(event.target.value);
                    }}
                    onBlur={field.handleBlur}
                    placeholder="platform"
                    className="font-code"
                  />
                  <Text size="sm" className="text-foreground-neutral-muted">
                    Used in project URLs.
                  </Text>
                </FormField>
              )}
            </form.Field>

            <Button
              type="submit"
              iconRight="chevronRight"
              isLoading={createProject.isPending}
              disabled={!selectedConnection || !selectedRepository}
              className="w-full"
            >
              Create project
            </Button>
          </div>
        </aside>
      </form>
    </div>
  );
}

function ProjectSummary({
  connection,
  repositoryName,
}: {
  connection: IntegrationConnection | undefined;
  repositoryName: string | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-10">
      {repositoryName ? (
        <IntegrationIcon
          source={connection?.provider}
          aria-hidden
          className="size-20 shrink-0 text-foreground-neutral-base"
        />
      ) : null}
      <Text
        size="sm"
        bold
        className={repositoryName ? 'min-w-0 truncate' : 'text-foreground-neutral-muted'}
      >
        {repositoryName ?? 'Pick a repository'}
      </Text>
    </div>
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
