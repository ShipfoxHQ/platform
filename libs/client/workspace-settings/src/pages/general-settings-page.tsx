import {createWorkspaceBodySchema} from '@shipfox/api-workspaces-dto';
import {
  checkWorkspaceSlugAvailability,
  type useActiveWorkspace,
  useUpdateWorkspaceMutation,
} from '@shipfox/client-auth';
import {displayNameFieldError, SlugChangeWarning, SlugField} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {workspaceGeneralErrorToFormError} from '#components/general/form-errors.js';
import {WorkspaceSettingsShell} from '#components/workspace-settings-shell.js';

interface WorkspaceGeneralValues {
  name: string;
  slug: string;
}

function isSlugValid(value: string): boolean {
  return createWorkspaceBodySchema.shape.slug.safeParse(value).success;
}

export function GeneralSettingsPage() {
  return (
    <WorkspaceSettingsShell>
      {(workspace) => (
        <WorkspaceGeneralForm
          key={`${workspace.id}:${workspace.name}:${workspace.slug}`}
          workspace={workspace}
        />
      )}
    </WorkspaceSettingsShell>
  );
}

function WorkspaceGeneralForm({workspace}: {workspace: ReturnType<typeof useActiveWorkspace>}) {
  const updateWorkspace = useUpdateWorkspaceMutation();
  const navigate = useNavigate();
  const [warningOpen, setWarningOpen] = useState(false);
  const [pendingValues, setPendingValues] = useState<WorkspaceGeneralValues>();
  const [formError, setFormError] = useState<string>();

  const form = useForm({
    defaultValues: {name: workspace.name, slug: workspace.slug},
    onSubmit: async ({value}) => {
      if (value.slug !== workspace.slug) {
        setPendingValues(value);
        setWarningOpen(true);
        return;
      }
      await save(value);
    },
  });

  async function save(values: WorkspaceGeneralValues) {
    setFormError(undefined);
    const nameChanged = values.name !== workspace.name;
    const slugChanged = values.slug !== workspace.slug;
    if (!nameChanged && !slugChanged) return;
    const command = {
      workspaceId: workspace.id,
      ...(nameChanged ? {name: values.name} : {}),
      ...(slugChanged ? {slug: values.slug} : {}),
    };

    try {
      const updated = await updateWorkspace.mutateAsync(command);
      setPendingValues(undefined);
      setWarningOpen(false);
      toast.success('Workspace settings saved.');
      await navigate({
        to: '/w/$workspaceSlug/settings/general',
        params: {workspaceSlug: updated.slug},
      });
    } catch (error) {
      setPendingValues(undefined);
      setWarningOpen(false);
      const mapped = workspaceGeneralErrorToFormError(error);
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
      <div className="flex min-w-0 flex-col gap-24">
        <header className="flex flex-col gap-6">
          <Header variant="h1">General</Header>
          <Text size="sm" className="text-foreground-neutral-muted">
            Update the workspace name and the slug used in its URLs.
          </Text>
        </header>

        {formError ? (
          <Callout role="alert" type="error">
            {formError}
          </Callout>
        ) : null}

        <form
          className="flex max-w-[560px] flex-col gap-16"
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
                  'Workspace name',
                  createWorkspaceBodySchema.shape.name,
                ),
              onSubmit: ({value}) =>
                displayNameFieldError(
                  value,
                  'Workspace name',
                  createWorkspaceBodySchema.shape.name,
                ),
            }}
          >
            {(field) => (
              <FormField
                label="Workspace name"
                id="workspace-settings-name"
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
              onBlur: createWorkspaceBodySchema.shape.slug,
              onSubmit: createWorkspaceBodySchema.shape.slug,
            }}
          >
            {(field) => (
              <SlugField
                id="workspace-settings-slug"
                label="Workspace slug"
                name="slug"
                value={field.state.value}
                onChange={(value) => field.handleChange(value)}
                onBlur={field.handleBlur}
                error={fieldError(field)}
                description={<span className="break-all font-code">/w/{field.state.value}</span>}
                placeholder="acme"
                className="font-code"
                currentSlug={workspace.slug}
                checkEnabled
                isValid={isSlugValid}
                checkAvailability={checkWorkspaceSlugAvailability}
              />
            )}
          </form.Field>

          <Button type="submit" isLoading={updateWorkspace.isPending} className="self-start">
            Save changes
          </Button>
        </form>
      </div>

      <SlugChangeWarning
        open={warningOpen}
        onOpenChange={setWarningOpen}
        entityLabel="workspace"
        isLoading={updateWorkspace.isPending}
        onConfirm={() => {
          if (pendingValues) void save(pendingValues);
        }}
      />
    </>
  );
}
