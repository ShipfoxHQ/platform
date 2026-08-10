import {slugifyName, slugSchema} from '@shipfox/api-common-dto';
import {createWorkspaceBodySchema} from '@shipfox/api-workspaces-dto';
import {displayNameFieldError, SlugField} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {Panel, PanelBody, PanelHeader, PanelTitle} from '@shipfox/react-ui/panel';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useNavigate} from '@tanstack/react-router';
import {useSetAtom} from 'jotai';
import {useState} from 'react';
import {checkWorkspaceSlugAvailability, useCreateWorkspaceAuth} from '#hooks/api/workspace-auth.js';
import {useAuthState} from '#hooks/use-auth-state.js';
import {lastWorkspaceIdAtom, rememberLastWorkspaceId} from '#state/last-workspace.js';
import {workspaceOnboardingErrorToFormError} from './form-errors.js';

const previewMetrics = [
  {label: 'Runs', value: '--'},
  {label: 'Passed', value: '--'},
  {label: 'Failed', value: '--'},
  {label: 'Duration', value: '--'},
];
const previewBars = [
  {id: 'runs-start', height: 32},
  {id: 'runs-mid-low', height: 48},
  {id: 'runs-dip', height: 28},
  {id: 'runs-mid-high', height: 66},
  {id: 'runs-mid', height: 54},
  {id: 'runs-peak', height: 82},
  {id: 'runs-late-low', height: 44},
  {id: 'runs-late-high', height: 74},
];

function isSlugValid(value: string): boolean {
  return slugSchema.safeParse(value).success;
}

export function WorkspaceOnboardingPage() {
  const createWorkspace = useCreateWorkspaceAuth();
  const {user} = useAuthState();
  const navigate = useNavigate();
  const setLastWorkspaceId = useSetAtom(lastWorkspaceIdAtom);
  const [formError, setFormError] = useState<string | undefined>();
  const [slugTouched, setSlugTouched] = useState(false);

  const form = useForm({
    defaultValues: {name: '', slug: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const command = createWorkspaceBodySchema.parse({name: value.name, slug: value.slug});
        const created = await createWorkspace.mutateAsync(command);
        toast.success('Workspace created.');
        // Pin the new workspace as the last-active one so a page refresh and
        // future visits to `/` land on it.
        try {
          setLastWorkspaceId(created.id);
          if (user?.id) rememberLastWorkspaceId(user.id, created.id);
        } catch {
          // localStorage may throw in private browsing or quota-exceeded.
        }
        await navigate({to: '/w/$workspaceSlug', params: {workspaceSlug: created.slug}});
      } catch (error) {
        const mapped = workspaceOnboardingErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (previous) => ({
            ...previous,
            errorMap: {...previous.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  return (
    <main className="min-h-screen bg-background-subtle-base px-frame py-frame max-[520px]:px-row">
      <div className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-[1120px] flex-col gap-section">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-inline">
            <div className="flex size-36 items-center justify-center rounded-8 border border-border-neutral-base bg-background-neutral-base shadow-button-neutral">
              <Icon name="shipfox" className="size-24 text-background-highlight-interactive" />
            </div>
            <Text size="md" bold>
              Shipfox
            </Text>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-region lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
          <form
            className="relative z-10 w-full"
            noValidate
            aria-labelledby="workspace-onboarding-title"
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <Panel>
              <PanelHeader variant="plain" className="flex-col items-start gap-inline">
                <PanelTitle id="workspace-onboarding-title" variant="h1">
                  Create your workspace
                </PanelTitle>
                <Text size="sm" className="text-foreground-neutral-muted">
                  Give your team a place to collaborate.
                </Text>
              </PanelHeader>

              <PanelBody className="flex flex-col gap-section p-panel">
                {formError ? (
                  <Callout role="alert" type="error">
                    {formError}
                  </Callout>
                ) : null}

                <div className="flex flex-col gap-inline">
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
                        id="workspace-name"
                        error={fieldError(field)}
                      >
                        <FormFieldInput
                          autoComplete="organization"
                          name="name"
                          placeholder="Acme"
                          type="text"
                          value={field.state.value}
                          onChange={(event) => {
                            const name = event.target.value;
                            field.handleChange(name);
                            if (!slugTouched) {
                              form.setFieldValue(
                                'slug',
                                name ? slugifyName(name, {fallback: 'workspace'}) : '',
                              );
                            }
                          }}
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
                        id="workspace-slug"
                        label="Workspace slug"
                        name="slug"
                        value={field.state.value}
                        onChange={(value) => {
                          setSlugTouched(true);
                          field.handleChange(value);
                        }}
                        onBlur={field.handleBlur}
                        error={fieldError(field)}
                        description={
                          <span className="break-all font-code">
                            {`${window.location.origin}/w/${field.state.value || 'acme'}`}
                          </span>
                        }
                        placeholder="acme"
                        checkEnabled={slugTouched}
                        isValid={isSlugValid}
                        checkAvailability={checkWorkspaceSlugAvailability}
                      />
                    )}
                  </form.Field>
                </div>

                <Button
                  className="w-full"
                  iconRight="chevronRight"
                  isLoading={createWorkspace.isPending}
                  type="submit"
                >
                  {createWorkspace.isPending ? 'Creating workspace...' : 'Create workspace'}
                </Button>
              </PanelBody>
            </Panel>
          </form>

          <div className="hidden flex-col gap-group lg:flex" aria-hidden="true">
            <div className="grid grid-cols-4 gap-cluster">
              {previewMetrics.map((metric) => (
                <div
                  className="rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact shadow-button-neutral"
                  key={metric.label}
                >
                  <Text size="xs" className="text-foreground-neutral-muted">
                    {metric.label}
                  </Text>
                  <Text size="xl" bold>
                    {metric.value}
                  </Text>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-group">
              <PreviewPanel title="Performance over time" />
              <PreviewPanel title="Duration distribution" bars />
            </div>
            <div className="flex flex-col gap-cluster rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact shadow-button-neutral">
              <Text size="sm" bold>
                Jobs breakdown
              </Text>
              <div className="flex flex-col gap-inline">
                {[0, 1, 2, 3].map((row) => (
                  <div
                    className="grid grid-cols-[1fr_80px_80px] gap-cluster border-t border-border-neutral-base pt-[10px]"
                    key={row}
                  >
                    <div className="h-12 rounded-full bg-background-neutral-disabled" />
                    <div className="h-12 rounded-full bg-background-neutral-disabled" />
                    <div className="h-12 rounded-full bg-background-neutral-disabled" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function PreviewPanel({title, bars = false}: {title: string; bars?: boolean}) {
  return (
    <div className="flex flex-col gap-group rounded-8 border border-border-neutral-base bg-background-neutral-base p-panel-compact shadow-button-neutral">
      <Text size="sm" bold>
        {title}
      </Text>
      <div className="flex h-[220px] items-end gap-inline border-b border-l border-border-neutral-base px-row pb-[10px]">
        {previewBars.map((bar) => (
          <div
            className={
              bars
                ? 'w-full rounded-t-4 bg-background-neutral-disabled'
                : 'w-full rounded-full bg-background-neutral-disabled'
            }
            key={`${title}-${bar.id}`}
            style={{height: `${bar.height}%`}}
          />
        ))}
      </div>
    </div>
  );
}
