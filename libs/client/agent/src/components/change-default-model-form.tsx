import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {fieldError} from '@shipfox/react-ui/form-field';
import {ModalBody, ModalFooter} from '@shipfox/react-ui/modal';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import type {BuiltinProviderConfig, SupportedProvider} from '#core/models.js';
import {useUpdateModelProviderDefaultModelMutation} from '#hooks/api/model-providers.js';
import {
  DefaultModelField,
  defaultModelFormValue,
  selectedModelForModelPayload,
} from './default-model-field.js';
import {modelProviderConfigErrorToFormError} from './form-errors.js';

const CHANGE_DEFAULT_MODEL_FORM_ID = 'model-provider-change-default-model-form';

export function ChangeDefaultModelForm({
  workspaceId,
  entry,
  config,
  onSaved,
}: {
  workspaceId: string;
  entry: SupportedProvider;
  config: BuiltinProviderConfig;
  onSaved: () => void;
}) {
  const updateDefaultModel = useUpdateModelProviderDefaultModelMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const form = useForm({
    defaultValues: {default_model: defaultModelFormValue(config.defaultModel)},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await updateDefaultModel.mutateAsync({
          workspaceId,
          providerId: entry.id,
          defaultModel: selectedModelForModelPayload(value.default_model),
        });
        onSaved();
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
          id={CHANGE_DEFAULT_MODEL_FORM_ID}
          className="flex w-full flex-col gap-cluster"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
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
        </form>
        {formError ? (
          <Callout role="alert" type="error">
            <div className="flex flex-col gap-inline">
              <Text size="sm" bold>
                Could not save default model
              </Text>
              <Text size="sm">{formError}</Text>
            </div>
          </Callout>
        ) : null}
      </ModalBody>
      <ModalFooter>
        <Button
          type="submit"
          form={CHANGE_DEFAULT_MODEL_FORM_ID}
          isLoading={updateDefaultModel.isPending}
        >
          Save model
        </Button>
      </ModalFooter>
    </>
  );
}
