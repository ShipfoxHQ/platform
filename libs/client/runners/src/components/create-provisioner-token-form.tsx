import {Button} from '@shipfox/react-ui/button';
import {Callout, CalloutContent, CalloutDescription, CalloutTitle} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {useCopyToClipboard} from '@shipfox/react-ui/hooks';
import {ModalBody, ModalFooter} from '@shipfox/react-ui/modal';
import {Code, Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import type {CreatedProvisionerToken} from '#core/token.js';
import {createTokenCommand} from '#core/token.js';
import {useCreateProvisionerTokenMutation} from '#hooks/api/provisioner-tokens.js';
import {provisionerTokenCreateErrorToFormError} from './provisioner-token-form-errors.js';
import {
  ExpirationSelect,
  expirationCommand,
  expirationHint,
  type TokenExpirationOption,
} from './token-expiration-select.js';

export const CREATE_PROVISIONER_TOKEN_FORM_ID = 'create-provisioner-token-form';

export function CreateProvisionerTokenForm({
  workspaceId,
  onCreated,
}: {
  workspaceId: string;
  onCreated: (token: CreatedProvisionerToken) => void;
}) {
  const createToken = useCreateProvisionerTokenMutation(workspaceId);
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {name: '', expiration: '86400' as TokenExpirationOption},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const command = createTokenCommand(value.name, expirationCommand(value.expiration));

      try {
        const token = await createToken.mutateAsync(command);
        onCreated(token);
      } catch (error) {
        const mapped = provisionerTokenCreateErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <>
      <ModalBody className="gap-group">
        <form
          id={CREATE_PROVISIONER_TOKEN_FORM_ID}
          className="flex w-full flex-col gap-inline"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <div className="flex w-full items-end gap-group max-[640px]:flex-col max-[640px]:items-stretch">
            <form.Field
              name="name"
              validators={{
                onBlur: ({value}) =>
                  value.length <= 80 ? undefined : 'Token name must be 80 characters or fewer.',
              }}
            >
              {(field) => (
                <FormField
                  className="flex-1"
                  label="Token name"
                  id="provisioner-token-name"
                  error={fieldError(field)}
                >
                  <FormFieldInput
                    placeholder="Docker provisioner"
                    maxLength={80}
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
            <form.Field name="expiration">
              {(field) => (
                <FormField
                  className="flex-1"
                  label="Expires"
                  id="provisioner-token-expiration"
                  error={fieldError(field)}
                >
                  <ExpirationSelect
                    value={field.state.value}
                    onValueChange={(next) => field.handleChange(next)}
                  />
                </FormField>
              )}
            </form.Field>
          </div>
          <form.Subscribe selector={(state) => state.values.expiration}>
            {(expiration) => (
              <Text size="sm" className="text-foreground-neutral-muted">
                {expirationHint(expiration)}
              </Text>
            )}
          </form.Subscribe>
        </form>
        {formError ? (
          <Callout role="alert" type="error">
            <div className="flex flex-col gap-inline">
              <Text size="sm" bold>
                Could not create token
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Callout>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form={CREATE_PROVISIONER_TOKEN_FORM_ID}
          isLoading={createToken.isPending}
        >
          Create token
        </Button>
      </ModalFooter>
    </>
  );
}

export function CreatedProvisionerTokenPanel({token}: {token: CreatedProvisionerToken}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const {copy} = useCopyToClipboard({
    text: token.token,
    onCopy: () => {
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1500);
    },
  });

  async function handleCopy() {
    try {
      await copy();
    } catch {
      setCopyState('failed');
      window.setTimeout(() => setCopyState('idle'), 2500);
    }
  }

  return (
    <Callout type="success" variant="secondary" icon={null}>
      <CalloutContent className="flex flex-col gap-cluster">
        <div className="flex flex-col gap-tight">
          <CalloutTitle className="mb-0">Token created</CalloutTitle>
          <CalloutDescription>
            Copy this provisioner token now. It will not be shown again.
          </CalloutDescription>
        </div>
        <div className="flex items-center gap-inline max-[640px]:flex-col max-[640px]:items-stretch">
          <Code variant="paragraph" className="min-w-0 flex-1 break-all">
            {token.token}
          </Code>
          <Button
            size="sm"
            variant="secondary"
            iconLeft="fileCopyLine"
            onClick={() => void handleCopy()}
          >
            {copyState === 'copied' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        {copyState === 'failed' ? (
          <Text size="sm" className="text-foreground-neutral-muted">
            Copy failed: select and copy manually.
          </Text>
        ) : null}
      </CalloutContent>
    </Callout>
  );
}
