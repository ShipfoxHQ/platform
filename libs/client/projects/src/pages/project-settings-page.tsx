import {slugSchema} from '@shipfox/api-common-dto';
import {createProjectBodySchema} from '@shipfox/api-projects-dto';
import {ApiError} from '@shipfox/client-api';
import {useActiveWorkspace} from '@shipfox/client-auth';
import {
  displayNameFieldError,
  QueryLoadError,
  SlugChangeWarning,
  SlugField,
} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {EmptyState} from '@shipfox/react-ui/empty-state';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {FullPageLoader} from '@shipfox/react-ui/loader';
import {Panel, PanelBody} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Header} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {useMaybeActiveProjectQuery} from '#chrome.js';
import type {Project} from '#core/project.js';
import {useProjectSlugAvailability, useUpdateProjectMutation} from '#hooks/api/projects.js';
import {projectSettingsErrorToFormError} from './project-settings-form-errors.js';

interface ProjectSettingsValues {
  name: string;
  slug: string;
}

function isSlugValid(value: string): boolean {
  return slugSchema.safeParse(value).success;
}

export function ProjectSettingsPage() {
  const projectQuery = useMaybeActiveProjectQuery();
  if (projectQuery.isPending) return <FullPageLoader />;
  if (projectQuery.isError && projectQuery.data === undefined) {
    if (projectQuery.error instanceof ApiError && projectQuery.error.status === 404) {
      return (
        <EmptyState
          icon="errorWarningLine"
          tone="error"
          title="Project not found"
          description="This project doesn't exist, or you don't have access to it."
        />
      );
    }
    return <QueryLoadError query={projectQuery} subject="project" />;
  }
  const project = projectQuery.data;
  if (!project) {
    return (
      <EmptyState
        icon="errorWarningLine"
        tone="error"
        title="Project not found"
        description="This project doesn't exist, or you don't have access to it."
      />
    );
  }
  return (
    <ProjectSettingsForm key={`${project.id}:${project.name}:${project.slug}`} project={project} />
  );
}

function ProjectSettingsForm({project}: {project: Project}) {
  const workspace = useActiveWorkspace();
  const navigate = useNavigate();
  const updateProject = useUpdateProjectMutation();
  const [warningOpen, setWarningOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<ProjectSettingsValues>();
  const [formError, setFormError] = useState<string>();

  const checkProjectSlugAvailability = useProjectSlugAvailability(workspace.id, project.id);

  const form = useForm({
    defaultValues: {name: project.name, slug: project.slug},
    onSubmit: async ({value}) => {
      if (value.slug !== project.slug) {
        setPendingValues(value);
        setWarningOpen(true);
        return;
      }
      await save(value);
    },
  });

  async function save(values: ProjectSettingsValues) {
    setFormError(undefined);
    const nameChanged = values.name !== project.name;
    const slugChanged = values.slug !== project.slug;
    if (!nameChanged && !slugChanged) return;
    const command = {
      projectId: project.id,
      ...(nameChanged ? {name: values.name} : {}),
      ...(slugChanged ? {slug: values.slug} : {}),
    };

    try {
      const updated = await updateProject.mutateAsync(command);
      setPendingValues(undefined);
      setWarningOpen(false);
      toast.success('Project settings saved.');
      await navigate({
        to: '/w/$workspaceSlug/p/$projectSlug/settings/general',
        params: {workspaceSlug: workspace.slug, projectSlug: updated.slug},
      });
    } catch (error) {
      setPendingValues(undefined);
      setWarningOpen(false);
      const mapped = projectSettingsErrorToFormError(error);
      if (mapped.kind === 'field') {
        form.setFieldMeta(mapped.field, (previous) => ({
          ...previous,
          errorMap: {...previous.errorMap, onServer: mapped.message},
        }));
      } else {
        setFormError(mapped.message);
      }
    }
  }

  return (
    <>
      <div className="flex min-w-0 flex-col gap-section">
        <Header variant="h1">General</Header>

        <Panel>
          <PanelBody className="gap-group p-panel">
            {formError ? (
              <Callout role="alert" type="error">
                {formError}
              </Callout>
            ) : null}

            <form
              className="flex w-full flex-col gap-group"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void form.handleSubmit();
              }}
            >
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
                  <FormField
                    label="Project name"
                    id="project-settings-name"
                    error={fieldError(field)}
                  >
                    <FormFieldInput
                      name="name"
                      type="text"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.target.value)}
                      onBlur={field.handleBlur}
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
                    id="project-settings-slug"
                    label="Project slug"
                    name="slug"
                    value={field.state.value}
                    onChange={(value) => field.handleChange(value)}
                    onBlur={field.handleBlur}
                    error={fieldError(field)}
                    description={
                      <span className="break-all font-code">
                        /w/{workspace.slug}/p/{field.state.value}
                      </span>
                    }
                    placeholder="platform"
                    className="font-code"
                    currentSlug={project.slug}
                    checkEnabled
                    debounceMs={0}
                    isValid={isSlugValid}
                    checkAvailability={checkProjectSlugAvailability}
                  />
                )}
              </form.Field>

              <Button type="submit" isLoading={updateProject.isPending} className="self-start">
                Save changes
              </Button>
            </form>
          </PanelBody>
        </Panel>
      </div>

      <SlugChangeWarning
        open={warningOpen}
        onOpenChange={setWarningOpen}
        entityLabel="project"
        isLoading={updateProject.isPending}
        onConfirm={() => {
          if (pendingValues) void save(pendingValues);
        }}
      />
    </>
  );
}
