import {slugifyName, slugSchema} from '@shipfox/api-common-dto';
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
import {displayNameFieldError, SlugField} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Input} from '@shipfox/react-ui/input';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Panel, PanelActions, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {type InfiniteData, useQueryClient} from '@tanstack/react-query';
import {Link, Navigate, useNavigate} from '@tanstack/react-router';
import {useEffect, useRef, useState} from 'react';
import {
  type CreateProjectCommand,
  type ProjectList,
  projectNameFromRepository,
} from '#core/project.js';
import {
  getProject,
  projectsInfiniteQueryOptions,
  readWorkspaceHasNoProject,
  useCreateProjectMutation,
  useProjectSlugAvailability,
} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';

function isSlugValid(value: string): boolean {
  return slugSchema.safeParse(value).success;
}

export function CreateProjectPage() {
  const workspace = useMaybeActiveWorkspace();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createProject = useCreateProjectMutation();
  const errorRef = useRef<HTMLDivElement>(null);
  // The submit flow awaits an existence snapshot before the create mutation, so
  // the pending state must cover the whole handler, not just the mutation.
  const submittingRef = useRef(false);
  const [submitting, setSubmitting] = useState(false);

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
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [slugCheckEnabled, setSlugCheckEnabled] = useState(false);
  const [slugConflict, setSlugConflict] = useState(false);
  const workspaceId = workspace?.id;
  const checkProjectSlugAvailability = useProjectSlugAvailability(workspaceId);

  const form = useForm({
    defaultValues: {name: defaultProjectName, slug: defaultProjectSlug},
    onSubmit: async ({value}) => {
      const projectSlug = slugManuallyEdited
        ? value.slug
        : slugifyName(value.name, {fallback: 'project'});
      await createProjectFromForm(nameTouched ? value.name : defaultProjectName, projectSlug);
    },
  });

  useEffect(() => {
    if (!nameTouched && form.state.values.name !== defaultProjectName) {
      form.setFieldValue('name', defaultProjectName);
      if (!slugManuallyEdited) {
        setSlugConflict(false);
        form.setFieldValue('slug', slugifyName(defaultProjectName, {fallback: 'project'}));
      }
    }
  }, [defaultProjectName, form, nameTouched, slugManuallyEdited]);

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
    return (
      <Navigate
        to="/w/$workspaceSlug/integrations"
        params={{workspaceSlug: workspace.slug}}
        replace
      />
    );
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
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);

    try {
      // Snapshot project existence before the mutation: after a successful
      // create the workspace has one project and "first" is already false.
      const wasFirstProject = await readWorkspaceHasNoProject({
        queryClient,
        workspaceId: workspace.id,
      });
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
      if (wasFirstProject) {
        // The setup checklist panel is the first thing on the home, so the
        // first project lands where the Get-started guide lives. Seed the
        // workspace list so the home does not re-render the pre-create empty
        // state, then refetch the authoritative list so a project created
        // concurrently (another tab, import, or API) is not hidden by the seed
        // for the stale window. The seed stays as the fallback when the
        // refetch fails, so the home never shows a stale empty state.
        const listQueryKey = projectsInfiniteQueryOptions(workspace.id).queryKey;
        queryClient.setQueryData<InfiniteData<ProjectList, string | undefined>>(listQueryKey, {
          pages: [{projects: [project], nextCursor: null}],
          pageParams: [undefined],
        });
        await queryClient.refetchQueries({queryKey: listQueryKey, type: 'all'});
        await navigate({
          to: '/w/$workspaceSlug',
          params: {workspaceSlug: workspace.slug},
        });
        return;
      }
      await navigate({
        to: '/w/$workspaceSlug/p/$projectSlug',
        params: {workspaceSlug: workspace.slug, projectSlug: project.slug},
      });
    } catch (error) {
      const copy = projectErrorCopy(error);
      if (copy.existingProjectId) {
        toast.info('Project already exists.');
        try {
          const project = await getProject(copy.existingProjectId);
          await navigate({
            to: '/w/$workspaceSlug/p/$projectSlug',
            params: {workspaceSlug: workspace.slug, projectSlug: project.slug},
          });
        } catch (recoveryError) {
          const recoveryCopy = projectErrorCopy(recoveryError);
          setFormError(`${recoveryCopy.title}: ${recoveryCopy.message}`);
          requestAnimationFrame(() => errorRef.current?.focus());
        }
        return;
      }
      if (copy.slugConflict) {
        setSlugConflict(true);
        requestAnimationFrame(() => document.getElementById('project-slug')?.focus());
        return;
      }
      setFormError(`${copy.title}: ${copy.message}`);
      requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const showRepoPicker = Boolean(selectedConnection);
  const filteredEmptyMessage = trimmedFilter
    ? `No repositories matching "${repoFilter.trim()}".`
    : 'No repositories visible to this connection.';

  return (
    <div className="flex w-full flex-col gap-section">
      <Header id="create-project-title" variant="h1">
        Create project
      </Header>

      {connectionsQuery.isError ? (
        <Callout role="alert" type="error">
          <div className="flex w-full flex-wrap items-center justify-between gap-cluster">
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
        className="grid items-start gap-region lg:grid-cols-[minmax(0,1fr)_340px]"
      >
        <div className="flex min-w-0 flex-col gap-region">
          {connections.length > 0 ? (
            <section aria-label="Source integration">
              <Panel>
                <PanelHeader>
                  <PanelTitle>Source integration</PanelTitle>
                  {connections.length === 1 ? (
                    <PanelActions>
                      <Button asChild variant="transparent" size="sm" className="shrink-0">
                        <Link
                          to="/w/$workspaceSlug/integrations"
                          params={{workspaceSlug: workspace.slug}}
                        >
                          Add another integration
                        </Link>
                      </Button>
                    </PanelActions>
                  ) : null}
                </PanelHeader>

                <PanelBody>
                  <ConnectionPicker
                    connections={connections}
                    selectedConnectionId={effectiveSelectedConnectionId}
                    onSelect={selectConnection}
                  />
                </PanelBody>
              </Panel>
            </section>
          ) : null}

          {showRepoPicker ? (
            <section aria-label="Repository">
              <Panel>
                <PanelHeader className="flex-wrap">
                  <PanelTitle>Repository</PanelTitle>
                  <PanelActions className="min-w-0 max-[640px]:ml-0 max-[640px]:basis-full">
                    <Input
                      type="search"
                      placeholder="Search repositories…"
                      aria-label="Search repositories"
                      value={repoFilter}
                      onChange={(event) => setRepoFilter(event.target.value)}
                      className="w-full max-w-[320px]"
                    />
                  </PanelActions>
                </PanelHeader>
                <PanelBody>
                  <RepositoryPicker
                    repositories={repositories}
                    selectedRepositoryId={selectedRepositoryId}
                    onSelect={setSelectedRepositoryId}
                    isLoading={repositoriesQuery.isPending}
                    isFetchingNextPage={repositoriesQuery.isFetchingNextPage}
                    hasNextPage={repositoriesQuery.hasNextPage}
                    onLoadMore={() => repositoriesQuery.fetchNextPage()}
                    emptyMessage={filteredEmptyMessage}
                  />
                </PanelBody>
              </Panel>
            </section>
          ) : null}
        </div>

        <aside className="lg:sticky lg:top-32">
          <Panel>
            <PanelHeader>
              <PanelTitle>Project details</PanelTitle>
            </PanelHeader>
            <PanelBody className="gap-group p-panel">
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
                    displayNameFieldError(
                      value,
                      'Project name',
                      createProjectBodySchema.shape.name,
                    ),
                  onSubmit: ({value}) =>
                    displayNameFieldError(
                      value,
                      'Project name',
                      createProjectBodySchema.shape.name,
                    ),
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
                        if (!slugManuallyEdited) {
                          setSlugCheckEnabled(true);
                          setSlugConflict(false);
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
                  <SlugField
                    id="project-slug"
                    label="Project slug"
                    name="slug"
                    value={field.state.value}
                    onChange={(value) => {
                      setSlugManuallyEdited(true);
                      setSlugCheckEnabled(true);
                      setSlugConflict(false);
                      field.handleChange(value);
                    }}
                    onBlur={field.handleBlur}
                    error={
                      slugConflict ? 'This project slug is already in use.' : fieldError(field)
                    }
                    description={
                      <span className="font-code">
                        {`/w/${workspace.slug}/p/${field.state.value}`}
                      </span>
                    }
                    placeholder="platform"
                    className="font-code"
                    checkEnabled={slugCheckEnabled}
                    debounceMs={0}
                    isValid={isSlugValid}
                    checkAvailability={checkProjectSlugAvailability}
                  />
                )}
              </form.Field>

              <Button
                type="submit"
                iconRight="chevronRight"
                isLoading={submitting}
                disabled={!selectedConnection || !selectedRepository}
                className="w-full"
              >
                Create project
              </Button>
            </PanelBody>
          </Panel>
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
    <div className="flex min-w-0 items-center gap-inline">
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
