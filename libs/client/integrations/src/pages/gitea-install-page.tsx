import {useActiveWorkspace} from '@shipfox/client-auth';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {toast} from '@shipfox/react-ui/toast';
import {Header, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {Link, useNavigate} from '@tanstack/react-router';
import {useState} from 'react';
import {useCreateGiteaConnectionMutation} from '#hooks/api/integrations.js';
import {giteaConnectErrorToFormError} from './gitea-form-errors.js';

export function GiteaInstallPage() {
  const workspace = useActiveWorkspace();
  const connect = useCreateGiteaConnectionMutation();
  const navigate = useNavigate();
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {org: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const workspaceId = workspace.id;
      try {
        await connect.mutateAsync({workspace_id: workspaceId, org: value.org.trim()});
        toast.success('Gitea organization installed.');
        await navigate({to: '/w/$workspaceSlug', params: {workspaceSlug: workspace.slug}});
      } catch (error) {
        const mapped = giteaConnectErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (prev) => ({
            ...prev,
            errorMap: {...prev.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped.message);
        }
      }
    },
  });

  return (
    <div className="mx-auto flex w-full max-w-[480px] flex-col gap-20">
      <header className="flex flex-col gap-8">
        <Header variant="h1">Install Gitea</Header>
        <Text size="md" className="text-foreground-neutral-muted">
          Enter the Gitea organization to install in this workspace.
        </Text>
      </header>

      <form
        className="flex flex-col gap-18"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {formError ? (
          <Callout role="alert" type="error">
            {formError}
          </Callout>
        ) : null}
        <form.Field
          name="org"
          validators={{
            onBlur: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter your Gitea organization.',
            onSubmit: ({value}) =>
              value.trim().length > 0 ? undefined : 'Enter your Gitea organization.',
          }}
        >
          {(field) => (
            <FormField label="Organization" id="gitea-org" error={fieldError(field)}>
              <FormFieldInput
                placeholder="my-org"
                autoComplete="off"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <div className="flex items-center gap-12">
          <Button type="submit" isLoading={connect.isPending}>
            Install
          </Button>
          <ButtonLink asChild variant="muted">
            <Link to="/w/$workspaceSlug/integrations" params={{workspaceSlug: workspace.slug}}>
              Cancel
            </Link>
          </ButtonLink>
        </div>
      </form>
    </div>
  );
}
