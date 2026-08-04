import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {
  FormField,
  FormFieldInput,
  FormFieldTextarea,
  fieldError,
} from '@shipfox/react-ui/form-field';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useState} from 'react';
import {
  normalizeStoreKey,
  STORE_KEY_HELP,
  shouldWarnShortSecretValue,
  validateNewStoreKey,
  workspaceStoreScope,
} from '#core/store.js';
import {usePutSecretMutation} from '#hooks/api/secrets.js';
import {secretsErrorToFormError} from './form-errors.js';
import {FormBody, FormFooter} from './form-shell.js';

export const SECRET_FORM_ID = 'secret-form';

// Client-side mirror of the server default SECRETS_SHORT_VALUE_WARN_LENGTH. The
// advisory is best-effort UX, so drift from a self-hosted override is cosmetic.
const SHORT_VALUE_THRESHOLD = 12;

export function SecretForm({
  workspaceId,
  mode,
  existingKey,
  reservedKeys = [],
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  mode: 'create' | 'edit';
  existingKey?: string | undefined;
  reservedKeys?: readonly string[] | undefined;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const putSecret = usePutSecretMutation();
  const [formError, setFormError] = useState<string | undefined>();
  const [showValue, setShowValue] = useState(false);

  const form = useForm({
    defaultValues: {key: existingKey ?? '', value: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await putSecret.mutateAsync({
          workspaceId,
          key: normalizeStoreKey(value.key),
          value: value.value,
          scope: workspaceStoreScope,
        });
        onSaved();
      } catch (error) {
        const mapped = secretsErrorToFormError(error);
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
    <>
      <FormBody>
        <form
          id={SECRET_FORM_ID}
          className="flex w-full flex-col gap-group"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Field
            name="key"
            validators={{
              onBlur: ({value}) => validateNewStoreKey(value, {mode, reservedKeys, kind: 'secret'}),
              onSubmit: ({value}) =>
                validateNewStoreKey(value, {mode, reservedKeys, kind: 'secret'}),
            }}
          >
            {(field) => (
              <FormField
                label="Name"
                id="secret-key"
                description={STORE_KEY_HELP}
                error={fieldError(field)}
              >
                <FormFieldInput
                  className="font-code"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={mode === 'edit'}
                  placeholder="MY_TOKEN"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(normalizeStoreKey(event.target.value))}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>

          <form.Field
            name="value"
            validators={{
              onBlur: ({value}) => (value.length > 0 ? undefined : 'A value is required.'),
              onSubmit: ({value}) => (value.length > 0 ? undefined : 'A value is required.'),
            }}
          >
            {(field) => (
              <FormField label="Value" id="secret-value" error={fieldError(field)}>
                <div className="relative">
                  <FormFieldTextarea
                    className={
                      showValue
                        ? 'pr-[32px] font-code'
                        : 'pr-[32px] font-code [-webkit-text-security:disc]'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    rows={3}
                    placeholder={
                      mode === 'edit'
                        ? 'Enter a new value to replace the current one'
                        : 'Paste the secret value'
                    }
                    value={field.state.value}
                    onChange={(event) => field.handleChange(event.target.value)}
                    onBlur={field.handleBlur}
                  />
                  <IconButton
                    type="button"
                    variant="transparent"
                    size="xs"
                    className="absolute top-6 right-6"
                    icon={showValue ? 'eyeOffLine' : 'eyeLine'}
                    aria-label={showValue ? 'Hide value' : 'Show value'}
                    onClick={() => setShowValue((prev) => !prev)}
                  />
                </div>
                {shouldWarnShortSecretValue(field.state.value, SHORT_VALUE_THRESHOLD) ? (
                  <Callout role="alert" type="warning">
                    <Text size="sm">
                      Very short secrets can match ordinary log text and redact unrelated output. If
                      this value is not sensitive, store it as a Variable instead.
                    </Text>
                  </Callout>
                ) : null}
              </FormField>
            )}
          </form.Field>
        </form>
        {formError ? (
          <Callout role="alert" type="error">
            <Text size="sm">{formError}</Text>
          </Callout>
        ) : null}
      </FormBody>
      <FormFooter>
        <Button variant="secondary" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" form={SECRET_FORM_ID} isLoading={putSecret.isPending}>
          {mode === 'edit' ? 'Update secret' : 'Create secret'}
        </Button>
      </FormFooter>
    </>
  );
}
