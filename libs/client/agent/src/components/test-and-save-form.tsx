import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {ModalBody, ModalFooter} from '@shipfox/react-ui/modal';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import type {BuiltinProviderConfig, SupportedProvider} from '#core/models.js';
import {useUpsertModelProviderConfigMutation} from '#hooks/api/model-providers.js';
import {
  DefaultModelField,
  defaultModelFormValue,
  LATEST_MODEL_VALUE,
  selectedModelForCredentialsPayload,
} from './default-model-field.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';

export const MODEL_PROVIDER_TEST_AND_SAVE_FORM_ID = 'model-provider-test-and-save-form';

export function ModelProviderTestAndSaveForm({
  workspaceId,
  entry,
  existingConfig,
  onSaved,
  setAsDefaultOnSave = false,
}: {
  workspaceId: string;
  entry: SupportedProvider;
  existingConfig?: BuiltinProviderConfig | undefined;
  onSaved: (savedDefaultModel: string | null) => void;
  setAsDefaultOnSave?: boolean | undefined;
}) {
  const upsertConfig = useUpsertModelProviderConfigMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: defaultFormValues(entry, existingConfig),
    onSubmit: async ({value}) => {
      setFormError(undefined);
      const credentials = Object.fromEntries(
        entry.credentialFields.map((credentialField) => [
          credentialField.key,
          value[credentialField.key]?.trim() ?? '',
        ]),
      );
      const selectedModel = value.default_model ?? LATEST_MODEL_VALUE;
      const defaultModel =
        existingConfig === undefined
          ? selectedModelForCredentialsPayload(selectedModel)
          : undefined;

      try {
        await upsertConfig.mutateAsync({
          workspaceId,
          providerId: entry.id,
          command: {
            ...(defaultModel !== undefined ? {defaultModel} : {}),
            credentials,
            ...(setAsDefaultOnSave ? {setAsDefault: true} : {}),
          },
        });
        onSaved(selectedModelForCredentialsPayload(selectedModel));
      } catch (error) {
        const mapped = modelProviderConfigErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <>
      <ModalBody className="gap-group">
        <form
          id={MODEL_PROVIDER_TEST_AND_SAVE_FORM_ID}
          className="flex w-full flex-col gap-cluster"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          {existingConfig === undefined ? (
            <form.Field
              name="default_model"
              validators={{
                onBlur: ({value}) => (value.trim() ? undefined : 'Default model is required.'),
                onSubmit: ({value}) => (value.trim() ? undefined : 'Default model is required.'),
              }}
            >
              {(field) => (
                <DefaultModelField
                  entry={entry}
                  value={field.state.value}
                  error={fieldError(field)}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            </form.Field>
          ) : null}
          {entry.credentialFields.map((credentialField) => (
            <form.Field
              key={credentialField.key}
              name={credentialField.key}
              validators={{
                onBlur: ({value}) =>
                  value.trim() ? undefined : `${credentialField.label} is required.`,
                onSubmit: ({value}) =>
                  value.trim() ? undefined : `${credentialField.label} is required.`,
              }}
            >
              {(field) => (
                <FormField
                  label={credentialField.label}
                  id={`model-provider-${entry.id}-${credentialField.key}`}
                  error={fieldError(field)}
                >
                  <FormFieldInput
                    type={credentialField.secret ? 'password' : 'text'}
                    autoComplete="off"
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                </FormField>
              )}
            </form.Field>
          ))}
        </form>
        {formError ? (
          <Callout role="alert" type="error">
            <div className="flex flex-col gap-inline">
              <Text size="sm" bold>
                Could not save provider
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Callout>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form={MODEL_PROVIDER_TEST_AND_SAVE_FORM_ID}
          isLoading={upsertConfig.isPending}
        >
          Test & save
        </Button>
      </ModalFooter>
    </>
  );
}

function defaultFormValues(
  entry: SupportedProvider,
  existingConfig: BuiltinProviderConfig | undefined,
): Record<string, string> {
  return {
    default_model: defaultModelFormValue(existingConfig?.defaultModel),
    ...Object.fromEntries(entry.credentialFields.map((field) => [field.key, ''])),
  };
}
