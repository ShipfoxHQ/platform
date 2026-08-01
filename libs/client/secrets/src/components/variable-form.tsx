import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {
  FormField,
  FormFieldInput,
  FormFieldTextarea,
  fieldError,
} from '@shipfox/react-ui/form-field';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useEffect, useRef, useState} from 'react';
import {
  normalizeStoreKey,
  STORE_KEY_HELP,
  shouldWarnSensitiveVariableName,
  validateNewStoreKey,
  workspaceStoreScope,
} from '#core/store.js';
import {usePutVariableMutation, useVariableQuery} from '#hooks/api/variables.js';
import {secretsErrorToFormError} from './form-errors.js';
import {FormBody, FormFooter} from './form-shell.js';

export const VARIABLE_FORM_ID = 'variable-form';

export function VariableForm({
  workspaceId,
  mode,
  existingKey,
  existingValue,
  existingValueTruncated = false,
  reservedKeys = [],
  onSaved,
  onCancel,
}: {
  workspaceId: string;
  mode: 'create' | 'edit';
  existingKey?: string | undefined;
  existingValue?: string | undefined;
  existingValueTruncated?: boolean | undefined;
  reservedKeys?: readonly string[] | undefined;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const putVariable = usePutVariableMutation();
  const [formError, setFormError] = useState<string | undefined>();

  // The list value is only a preview, so a truncated variable must load its full
  // value before editing to avoid saving the truncated preview back.
  const needsFullValue = mode === 'edit' && existingValueTruncated;
  const fullValueQuery = useVariableQuery(workspaceId, needsFullValue ? existingKey : undefined);

  const form = useForm({
    defaultValues: {key: existingKey ?? '', value: existingValue ?? ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await putVariable.mutateAsync({
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

  const populatedRef = useRef(false);
  useEffect(() => {
    if (needsFullValue && fullValueQuery.data && !populatedRef.current) {
      populatedRef.current = true;
      form.setFieldValue('value', fullValueQuery.data.value);
    }
  }, [needsFullValue, fullValueQuery.data, form]);

  // The full value must be loaded before a save is allowed, otherwise submitting would
  // overwrite the stored value with the truncated preview. Block until it arrives.
  // whether the fetch is still pending or has failed.
  const awaitingFullValue = needsFullValue && fullValueQuery.data === undefined;
  const loadingFullValue = needsFullValue && fullValueQuery.isPending;

  return (
    <>
      <FormBody>
        <form
          id={VARIABLE_FORM_ID}
          className="flex w-full flex-col gap-16"
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
              onBlur: ({value}) =>
                validateNewStoreKey(value, {mode, reservedKeys, kind: 'variable'}),
              onSubmit: ({value}) =>
                validateNewStoreKey(value, {mode, reservedKeys, kind: 'variable'}),
            }}
          >
            {(field) => (
              <FormField
                label="Name"
                id="variable-key"
                description={STORE_KEY_HELP}
                error={fieldError(field)}
              >
                <FormFieldInput
                  className="font-code"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={mode === 'edit'}
                  placeholder="LOG_LEVEL"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(normalizeStoreKey(event.target.value))}
                  onBlur={field.handleBlur}
                />
                {shouldWarnSensitiveVariableName(field.state.value) ? (
                  <Callout role="alert" type="warning">
                    <Text size="sm" aria-live="polite">
                      This looks like it may be sensitive. Variables are stored in plaintext and are
                      not redacted from logs. Use a Secret if this value contains private data.
                    </Text>
                  </Callout>
                ) : null}
              </FormField>
            )}
          </form.Field>

          <form.Field name="value">
            {(field) => (
              <FormField
                label="Value"
                id="variable-value"
                error={fieldError(field)}
                description={loadingFullValue ? 'Loading the current value…' : undefined}
              >
                <FormFieldTextarea
                  className="font-code"
                  autoComplete="off"
                  spellCheck={false}
                  rows={3}
                  disabled={awaitingFullValue}
                  placeholder="debug"
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          </form.Field>
        </form>
        {awaitingFullValue && fullValueQuery.isError ? (
          <Callout role="alert" type="error">
            <Text size="sm">Could not load the current value. Close and try again.</Text>
          </Callout>
        ) : null}
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
        <Button
          type="submit"
          form={VARIABLE_FORM_ID}
          isLoading={putVariable.isPending}
          disabled={awaitingFullValue}
        >
          {mode === 'edit' ? 'Update variable' : 'Create variable'}
        </Button>
      </FormFooter>
    </>
  );
}
