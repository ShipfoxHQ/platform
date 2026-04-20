import {createProjectBodySchema, createVcsConnectionBodySchema} from '@shipfox/api-projects-dto';
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
  Input,
  Label,
  Text,
  toast,
} from '@shipfox/react-ui';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {type FormEvent, useEffect, useRef, useState} from 'react';
import {z} from 'zod';
import {ProjectPreviewRail, type ProjectPreviewState} from '#components/project-preview-rail.js';
import {
  projectsQueryKeys,
  useCreateProjectMutation,
  useCreateVcsConnectionMutation,
} from '#hooks/api/projects.js';
import {projectErrorCopy} from '#project-error.js';
import {isTestProviderUiEnabled} from './projects-hub-page.js';

type CreateProjectField = 'external_repository_id' | 'name';
type FieldErrors = Partial<Record<CreateProjectField, string | undefined>>;

const REPOSITORY_NAME_SPLIT_RE = /[/-]/;

const localProjectFormSchema = z.object({
  external_repository_id: z.string().trim().min(1, 'Repository id is required').max(255),
  name: z.string().trim().min(1, 'Project name is required').max(255),
});

export function CreateProjectPage() {
  const auth = useAuthState();
  const workspace = auth.workspaces[0];
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const createConnection = useCreateVcsConnectionMutation();
  const createProject = useCreateProjectMutation();
  const repositoryInputRef = useRef<HTMLInputElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const [externalRepositoryId, setExternalRepositoryId] = useState('');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [previewState, setPreviewState] = useState<ProjectPreviewState>('waiting');

  useEffect(() => {
    if (nameTouched) return;
    setName(projectNameFromRepository(externalRepositoryId));
  }, [externalRepositoryId, nameTouched]);

  if (!isTestProviderUiEnabled()) {
    return <CreateProjectUnavailablePage />;
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    setPreviewState('ready');
    const parsed = localProjectFormSchema.safeParse({
      external_repository_id: externalRepositoryId,
      name,
    });
    if (!parsed.success) {
      const errors = fieldErrorsFromZod(parsed.error);
      setFieldErrors(errors);
      focusFirstError(errors, repositoryInputRef.current, nameInputRef.current);
      return;
    }
    if (!workspace) {
      setFormError('Workspace is still loading. Try again in a moment.');
      errorRef.current?.focus();
      return;
    }

    setFieldErrors({});
    setPreviewState('creating');
    try {
      const connectionBody = createVcsConnectionBodySchema.parse({
        workspace_id: workspace.id,
        provider: 'test',
        provider_host: 'test.local',
        external_connection_id: `test-${workspace.id}`,
        display_name: 'Test provider',
      });
      const connection = await createConnection.mutateAsync(connectionBody);
      const projectBody = createProjectBodySchema.parse({
        workspace_id: workspace.id,
        name: parsed.data.name,
        vcs_connection_id: connection.id,
        external_repository_id: parsed.data.external_repository_id,
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
              Connect a local test repository to Shipfox.
            </Text>
          </div>
        </header>

        <section className="grid gap-24 lg:grid-cols-[minmax(0,520px)_minmax(320px,1fr)]">
          <form onSubmit={onSubmit} noValidate aria-labelledby="create-project-title">
            <Card className="gap-20 p-24">
              <CardHeader>
                <CardTitle id="create-project-title" variant="h2">
                  Repository setup
                </CardTitle>
                <CardDescription>
                  The local test provider follows the same shape as future VCS providers.
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
                <div className="flex flex-col gap-8">
                  <Label>Source</Label>
                  <div className="rounded-8 border border-border-neutral-base bg-background-subtle-base p-14">
                    <Text size="sm" bold>
                      Test provider
                    </Text>
                    <Text size="xs" className="text-foreground-neutral-muted">
                      Local only · test.local
                    </Text>
                  </div>
                </div>

                <div className="flex flex-col gap-8">
                  <Label htmlFor="project-repository-id">Repository id</Label>
                  <Input
                    id="project-repository-id"
                    ref={repositoryInputRef}
                    aria-describedby={
                      fieldErrors.external_repository_id ? 'project-repository-id-error' : undefined
                    }
                    aria-invalid={fieldErrors.external_repository_id ? true : undefined}
                    value={externalRepositoryId}
                    onChange={(event) => {
                      setExternalRepositoryId(event.target.value);
                      setFieldErrors((errors) => ({
                        ...errors,
                        external_repository_id: undefined,
                      }));
                    }}
                    placeholder="platform"
                  />
                  {fieldErrors.external_repository_id ? (
                    <Text
                      as="p"
                      size="xs"
                      className="text-tag-error-text"
                      id="project-repository-id-error"
                    >
                      {fieldErrors.external_repository_id}
                    </Text>
                  ) : null}
                </div>

                <div className="flex flex-col gap-8">
                  <Label htmlFor="project-name">Project name</Label>
                  <Input
                    id="project-name"
                    ref={nameInputRef}
                    aria-describedby={fieldErrors.name ? 'project-name-error' : undefined}
                    aria-invalid={fieldErrors.name ? true : undefined}
                    value={name}
                    onChange={(event) => {
                      setNameTouched(true);
                      setName(event.target.value);
                      setFieldErrors((errors) => ({...errors, name: undefined}));
                    }}
                    placeholder="Platform"
                  />
                  {fieldErrors.name ? (
                    <Text as="p" size="xs" className="text-tag-error-text" id="project-name-error">
                      {fieldErrors.name}
                    </Text>
                  ) : null}
                </div>
              </CardContent>

              <Button
                type="submit"
                iconRight="chevronRight"
                isLoading={createConnection.isPending || createProject.isPending}
              >
                Create project
              </Button>
            </Card>
          </form>

          <div>
            <details className="min-[521px]:hidden">
              <summary className="mb-12 cursor-pointer text-sm font-medium">
                Project preview
              </summary>
              <ProjectPreviewRail
                repositoryId={externalRepositoryId}
                projectName={name}
                state={previewState}
                createdProject={createProject.data}
              />
            </details>
            <div className="hidden min-[521px]:block">
              <ProjectPreviewRail
                repositoryId={externalRepositoryId}
                projectName={name}
                state={previewState}
                createdProject={createProject.data}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function CreateProjectUnavailablePage() {
  return (
    <main className="min-h-screen bg-background-subtle-base px-24 py-32 max-[520px]:px-16">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-20">
        <Button asChild variant="transparent" className="w-fit px-0">
          <Link to="/">Back to Projects</Link>
        </Button>
        <Card className="p-28">
          <CardHeader>
            <CardTitle variant="h1">Project creation is unavailable</CardTitle>
            <CardDescription>
              The local test VCS provider is disabled in this environment.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    </main>
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

function fieldErrorsFromZod(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if ((key === 'external_repository_id' || key === 'name') && !errors[key]) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

function focusFirstError(
  errors: FieldErrors,
  repositoryInput: HTMLInputElement | null,
  nameInput: HTMLInputElement | null,
) {
  if (errors.external_repository_id) {
    repositoryInput?.focus();
    return;
  }
  if (errors.name) {
    nameInput?.focus();
  }
}
