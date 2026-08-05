import {Badge} from '@shipfox/react-ui/badge';
import {Button, IconButton} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {Collapsible, CollapsibleContent, CollapsibleTrigger} from '@shipfox/react-ui/collapsible';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {ModalBody, ModalFooter} from '@shipfox/react-ui/modal';
import {Switch} from '@shipfox/react-ui/switch';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import type {ReactNode, RefObject} from 'react';
import {useEffect, useRef, useState} from 'react';
import type {CustomProviderConfig, ProviderApi} from '#core/models.js';
import {
  useCreateCustomModelProviderMutation,
  useDiscoverCustomModelProviderModelsBySlugMutation,
  useDiscoverCustomModelProviderModelsMutation,
  useModelProviderCatalogQuery,
  useUpdateCustomModelProviderMutation,
} from '#hooks/api/model-providers.js';
import {MODEL_PROVIDER_API_OPTIONS} from './custom-model-provider-api-options.js';
import {
  buildCreateCustomModelProviderBody,
  buildDiscoverModelsBody,
  buildDiscoverModelsBySlugBody,
  buildUpdateCustomModelProviderBody,
  type CustomModelProviderFormValues,
  type CustomModelProviderHeaderFormValue,
  type CustomModelProviderModelFormValue,
  createCustomModelProviderFormValues,
  createFormRowId,
  editCustomModelProviderFormValues,
} from './custom-model-provider-payload.js';
import {
  customModelProviderSlugError,
  deriveCustomModelProviderSlug,
} from './custom-model-provider-slug.js';
import {FormFieldSelect} from './default-model-field.js';
import {modelProviderConfigErrorField} from './form-errors.js';

export const CUSTOM_MODEL_PROVIDER_FORM_ID = 'custom-model-provider-form';

export function CustomModelProviderForm({
  workspaceId,
  existingConfig,
  onSaved,
}: {
  workspaceId: string;
  existingConfig?: CustomProviderConfig | undefined;
  onSaved: () => void;
}) {
  const createMutation = useCreateCustomModelProviderMutation();
  const updateMutation = useUpdateCustomModelProviderMutation();
  const discoverMutation = useDiscoverCustomModelProviderModelsMutation();
  const catalogQuery = useModelProviderCatalogQuery();
  const reservedProviderIds = catalogQuery.data?.providers.map((provider) => provider.id) ?? [];
  const discoverBySlugMutation = useDiscoverCustomModelProviderModelsBySlugMutation();
  const [slugEdited, setSlugEdited] = useState(existingConfig !== undefined);
  const [formError, setFormError] = useState<string | undefined>();
  const [discoveryStatus, setDiscoveryStatus] = useState<string | undefined>();
  const [removedDefaultNotice, setRemovedDefaultNotice] = useState(false);
  const mountedRef = useRef(true);
  const form = useForm({
    defaultValues: existingConfig
      ? editCustomModelProviderFormValues(existingConfig)
      : createCustomModelProviderFormValues(),
    onSubmit: async ({value}) => {
      setFormError(undefined);

      try {
        if (existingConfig) {
          await updateMutation.mutateAsync({
            workspaceId,
            providerId: existingConfig.providerId,
            command: buildUpdateCustomModelProviderBody(existingConfig, value),
          });
        } else {
          await createMutation.mutateAsync({
            workspaceId,
            command: buildCreateCustomModelProviderBody(value),
          });
        }
        onSaved();
      } catch (error) {
        applyServerError(error);
      }
    },
  });

  const isPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    discoverMutation.isPending ||
    discoverBySlugMutation.isPending;

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function handleDiscoverModels(values: CustomModelProviderFormValues) {
    setDiscoveryStatus(undefined);
    try {
      const response = existingConfig
        ? await discoverBySlugMutation.mutateAsync({
            workspaceId,
            providerId: existingConfig.providerId,
            command: buildDiscoverModelsBySlugBody(existingConfig, values),
          })
        : await discoverMutation.mutateAsync({
            workspaceId,
            command: buildDiscoverModelsBody(values),
          });
      if (!mountedRef.current) return;
      const existingIds = new Set(values.models.map((model) => model.id.trim()).filter(Boolean));
      const discovered = response.filter((model) => !existingIds.has(model.id));
      form.setFieldValue('models', [
        ...values.models,
        ...discovered.map((model) => ({
          client_id: createFormRowId(),
          id: model.id,
          label: model.label,
          context_window: '',
          max_output_tokens: '',
          input_image: false,
          reasoning: false,
        })),
      ]);
      setDiscoveryStatus(
        discovered.length > 0
          ? `Discovered ${discovered.length} models.`
          : 'No models found - that is normal for some servers. Add models manually.',
      );
    } catch (error) {
      if (!mountedRef.current) return;
      applyServerError(error);
    }
  }

  function applyServerError(error: unknown) {
    const mapped = modelProviderConfigErrorField(error);
    if (mapped.kind === 'field') {
      form.setFieldMeta(mapped.field, (prev) => ({
        ...prev,
        errorMap: {...prev.errorMap, onServer: mapped.message},
      }));
      return;
    }
    setFormError(mapped.message);
  }

  return (
    <>
      <ModalBody className="min-h-0 flex-1 gap-group overflow-y-auto overflow-x-clip scrollbar">
        <form
          id={CUSTOM_MODEL_PROVIDER_FORM_ID}
          className="flex w-full flex-col gap-section"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void form.handleSubmit();
          }}
        >
          <form.Subscribe selector={(state) => state.values}>
            {(values) => (
              <>
                <FormGroup title="Provider">
                  <div className="grid grid-cols-2 gap-cluster max-[640px]:grid-cols-1">
                    <form.Field
                      name="display_name"
                      validators={{
                        onBlur: ({value}) =>
                          value.trim() ? undefined : 'Display name is required.',
                        onSubmit: ({value}) =>
                          value.trim() ? undefined : 'Display name is required.',
                      }}
                    >
                      {(field) => (
                        <FormField
                          label="Display name"
                          id="custom-provider-display-name"
                          error={fieldError(field)}
                        >
                          <FormFieldInput
                            value={field.state.value}
                            onChange={(event) => {
                              const displayName = event.target.value;
                              field.handleChange(displayName);
                              if (!slugEdited && !existingConfig) {
                                form.setFieldValue(
                                  'slug',
                                  deriveCustomModelProviderSlug(displayName),
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
                        onBlur: ({value}) =>
                          existingConfig
                            ? undefined
                            : customModelProviderSlugError(value, reservedProviderIds),
                        onSubmit: ({value}) =>
                          existingConfig
                            ? undefined
                            : customModelProviderSlugError(value, reservedProviderIds),
                      }}
                    >
                      {(field) => (
                        <FormField
                          label="Provider ID"
                          id="custom-provider-slug"
                          error={fieldError(field)}
                          description="Use this ID in workflow files."
                        >
                          <FormFieldInput
                            className="font-code"
                            value={field.state.value}
                            disabled={existingConfig !== undefined}
                            onChange={(event) => {
                              setSlugEdited(event.target.value.trim() !== '');
                              field.handleChange(event.target.value);
                            }}
                            onBlur={field.handleBlur}
                          />
                        </FormField>
                      )}
                    </form.Field>
                  </div>

                  <div className="grid grid-cols-2 gap-cluster max-[640px]:grid-cols-1">
                    <form.Field name="api">
                      {(field) => (
                        <FormField label="Protocol" id="custom-provider-api">
                          <FormFieldSelect
                            value={field.state.value}
                            onChange={(event) =>
                              field.handleChange(event.target.value as ProviderApi)
                            }
                            onBlur={field.handleBlur}
                          >
                            {MODEL_PROVIDER_API_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </FormFieldSelect>
                        </FormField>
                      )}
                    </form.Field>
                    <form.Field
                      name="base_url"
                      validators={{
                        onBlur: ({value}) =>
                          canParseUrl(value)
                            ? undefined
                            : 'Enter a full URL, like https://api.openai.com/v1',
                        onSubmit: ({value}) =>
                          canParseUrl(value)
                            ? undefined
                            : 'Enter a full URL, like https://api.openai.com/v1',
                      }}
                    >
                      {(field) => (
                        <FormField
                          label="Base URL"
                          id="custom-provider-base-url"
                          error={fieldError(field)}
                        >
                          <FormFieldInput
                            className="font-code"
                            placeholder="https://api.openai.com/v1"
                            value={field.state.value}
                            onChange={(event) => field.handleChange(event.target.value)}
                            onBlur={field.handleBlur}
                          />
                        </FormField>
                      )}
                    </form.Field>
                  </div>

                  <form.Field name="api_key">
                    {(field) => (
                      <FormField
                        label="API key"
                        id="custom-provider-api-key"
                        description={
                          existingConfig
                            ? 'Leave blank to keep the current key.'
                            : 'Leave blank when the endpoint does not require a key.'
                        }
                      >
                        <FormFieldInput
                          type="password"
                          autoComplete="off"
                          value={field.state.value}
                          onChange={(event) => field.handleChange(event.target.value)}
                          onBlur={field.handleBlur}
                        />
                      </FormField>
                    )}
                  </form.Field>
                </FormGroup>

                <FormGroup title="Headers">
                  <form.Field name="headers">
                    {(field) => (
                      <HeaderRows
                        rows={field.state.value}
                        onChange={(headers) => field.handleChange(headers)}
                      />
                    )}
                  </form.Field>
                </FormGroup>

                <FormGroup title="Models">
                  <div className="flex flex-wrap items-center justify-between gap-inline">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      iconLeft="downloadLine"
                      disabled={!canParseUrl(values.base_url)}
                      isLoading={discoverMutation.isPending || discoverBySlugMutation.isPending}
                      onClick={() => {
                        void handleDiscoverModels(values);
                      }}
                    >
                      Fetch models
                    </Button>
                    {discoveryStatus ? (
                      <Text size="sm" className="text-foreground-neutral-muted" role="status">
                        {discoveryStatus}
                      </Text>
                    ) : null}
                  </div>

                  <form.Field
                    name="models"
                    validators={{
                      onSubmit: ({value}) =>
                        value.some((model) => model.id.trim() && model.label.trim())
                          ? undefined
                          : 'Add at least one model.',
                    }}
                  >
                    {(field) => (
                      <>
                        <ModelRows
                          rows={field.state.value}
                          defaultModel={values.default_model}
                          onDefaultRemoved={() => setRemovedDefaultNotice(true)}
                          onChange={(models) => field.handleChange(models)}
                          onDefaultChange={(defaultModel) => {
                            setRemovedDefaultNotice(false);
                            form.setFieldValue('default_model', defaultModel);
                          }}
                        />
                        {fieldError(field) ? (
                          <Text size="sm" className="text-foreground-highlight-error">
                            {fieldError(field)}
                          </Text>
                        ) : null}
                      </>
                    )}
                  </form.Field>

                  {removedDefaultNotice ? (
                    <Callout role="alert" type="warning">
                      <Text size="sm">
                        Default model removed - choose a new default or keep none.
                      </Text>
                    </Callout>
                  ) : null}
                  <form.Field
                    name="default_model"
                    validators={{
                      onBlur: ({value}) => validateDefaultModel(value, values.models),
                      onSubmit: ({value}) => validateDefaultModel(value, values.models),
                    }}
                  >
                    {(field) => (
                      <FormField
                        label="Default model"
                        id="custom-provider-default-model"
                        error={fieldError(field)}
                      >
                        <FormFieldSelect
                          value={field.state.value}
                          onChange={(event) => {
                            setRemovedDefaultNotice(false);
                            field.handleChange(event.target.value);
                          }}
                          onBlur={field.handleBlur}
                        >
                          <option value="">No default</option>
                          {values.models
                            .filter((model) => model.id.trim())
                            .map((model) => (
                              <option key={model.client_id} value={model.id}>
                                {model.label.trim() || model.id}
                              </option>
                            ))}
                        </FormFieldSelect>
                      </FormField>
                    )}
                  </form.Field>
                </FormGroup>
              </>
            )}
          </form.Subscribe>
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
        <Text size="sm" className="mr-auto text-foreground-neutral-muted">
          Saving runs a live test against the endpoint.
        </Text>
        <Button type="submit" form={CUSTOM_MODEL_PROVIDER_FORM_ID} isLoading={isPending}>
          Test & save
        </Button>
      </ModalFooter>
    </>
  );
}

function FormGroup({title, children}: {title: string; children: ReactNode}) {
  return (
    <section className="flex flex-col gap-group border-t border-border-neutral-base pt-[16px] first:border-t-0 first:pt-0">
      <Text size="xs" className="font-medium uppercase text-foreground-neutral-muted">
        {title}
      </Text>
      {children}
    </section>
  );
}

function HeaderRows({
  rows,
  onChange,
}: {
  rows: CustomModelProviderHeaderFormValue[];
  onChange: (rows: CustomModelProviderHeaderFormValue[]) => void;
}) {
  const addButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-col gap-inline">
      {rows.map((row, index) => (
        <div
          key={row.client_id}
          className="grid grid-cols-[1fr_1fr_auto_auto] items-end gap-x-inline gap-y-tight max-[760px]:grid-cols-1"
        >
          <FormField label="Name" id={`custom-header-name-${row.client_id}`}>
            <FormFieldInput
              className="font-code"
              value={row.name}
              onChange={(event) =>
                updateRow(rows, index, {...row, name: event.target.value}, onChange)
              }
            />
          </FormField>
          <FormField label="Value" id={`custom-header-value-${row.client_id}`}>
            <FormFieldInput
              type={row.secret ? 'password' : 'text'}
              placeholder={row.hasStoredValue ? 'Unchanged' : undefined}
              value={row.value}
              onChange={(event) =>
                updateRow(rows, index, {...row, value: event.target.value}, onChange)
              }
            />
          </FormField>
          <div className="flex h-32 items-center gap-inline text-sm text-foreground-neutral-muted">
            <Switch
              size="sm"
              aria-label={`Mark header ${index + 1} as secret`}
              checked={row.secret}
              onCheckedChange={(checked) =>
                updateRow(rows, index, {...row, secret: checked}, onChange)
              }
            />
            Secret
          </div>
          <IconButton
            type="button"
            size="sm"
            variant="transparent"
            icon="deleteBinLine"
            aria-label="Remove header"
            onClick={() => {
              onChange(rows.filter((_, rowIndex) => rowIndex !== index));
              focusAfterRender(addButtonRef);
            }}
          />
        </div>
      ))}
      <Button
        ref={addButtonRef}
        type="button"
        size="sm"
        variant="secondary"
        iconLeft="addLine"
        onClick={() => {
          const clientId = createFormRowId();
          onChange([
            ...rows,
            {
              client_id: clientId,
              name: '',
              value: '',
              secret: false,
              hasStoredValue: false,
              storedName: '',
            },
          ]);
          focusAfterRender(`custom-header-name-${clientId}`);
        }}
      >
        Add header
      </Button>
    </div>
  );
}

function ModelRows({
  rows,
  defaultModel,
  onChange,
  onDefaultChange,
  onDefaultRemoved,
}: {
  rows: CustomModelProviderModelFormValue[];
  defaultModel: string;
  onChange: (rows: CustomModelProviderModelFormValue[]) => void;
  onDefaultChange: (value: string) => void;
  onDefaultRemoved: () => void;
}) {
  const addButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="flex flex-col gap-inline">
      {rows.map((row, index) => (
        <div
          key={row.client_id}
          className="flex flex-col gap-inline rounded-8 border border-border-neutral-base p-panel-compact"
        >
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-inline max-[760px]:grid-cols-1">
            <FormField label="Model id" id={`custom-model-id-${row.client_id}`}>
              <FormFieldInput
                className="font-code"
                value={row.id}
                onChange={(event) =>
                  updateRow(rows, index, {...row, id: event.target.value}, onChange)
                }
              />
            </FormField>
            <FormField label="Label" id={`custom-model-label-${row.client_id}`}>
              <FormFieldInput
                value={row.label}
                onChange={(event) =>
                  updateRow(rows, index, {...row, label: event.target.value}, onChange)
                }
              />
            </FormField>
            <div className="flex items-center gap-inline">
              {defaultModel && row.id === defaultModel ? (
                <Badge variant="neutral">Default</Badge>
              ) : null}
              <IconButton
                type="button"
                size="sm"
                variant="transparent"
                icon="deleteBinLine"
                aria-label="Remove model"
                onClick={() => {
                  const nextRows = rows.filter((_, rowIndex) => rowIndex !== index);
                  onChange(nextRows);
                  focusAfterRender(addButtonRef);
                  if (row.id === defaultModel) {
                    onDefaultChange('');
                    onDefaultRemoved();
                  }
                }}
              />
            </div>
          </div>
          <Collapsible className="flex flex-col">
            <CollapsibleTrigger asChild>
              <Button type="button" size="sm" variant="transparentMuted">
                Defaults: 128k context, 16k output, text-only
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid grid-cols-2 gap-inline pt-[8px] max-[640px]:grid-cols-1">
                <FormField label="Context window" id={`custom-model-context-${row.client_id}`}>
                  <FormFieldInput
                    type="number"
                    inputMode="numeric"
                    placeholder="128000"
                    value={row.context_window}
                    onChange={(event) =>
                      updateRow(rows, index, {...row, context_window: event.target.value}, onChange)
                    }
                  />
                </FormField>
                <FormField label="Max output tokens" id={`custom-model-output-${row.client_id}`}>
                  <FormFieldInput
                    type="number"
                    inputMode="numeric"
                    placeholder="16384"
                    value={row.max_output_tokens}
                    onChange={(event) =>
                      updateRow(
                        rows,
                        index,
                        {...row, max_output_tokens: event.target.value},
                        onChange,
                      )
                    }
                  />
                </FormField>
                <div className="flex h-32 items-center gap-inline text-sm text-foreground-neutral-muted">
                  <Switch
                    size="sm"
                    aria-label={`Enable image input for model ${index + 1}`}
                    checked={row.input_image}
                    onCheckedChange={(checked) =>
                      updateRow(rows, index, {...row, input_image: checked}, onChange)
                    }
                  />
                  Image input
                </div>
                <div className="flex h-32 items-center gap-inline text-sm text-foreground-neutral-muted">
                  <Switch
                    size="sm"
                    aria-label={`Enable reasoning for model ${index + 1}`}
                    checked={row.reasoning}
                    onCheckedChange={(checked) =>
                      updateRow(rows, index, {...row, reasoning: checked}, onChange)
                    }
                  />
                  Reasoning
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      ))}
      <Button
        ref={addButtonRef}
        type="button"
        size="sm"
        variant="secondary"
        iconLeft="addLine"
        onClick={() => {
          const clientId = createFormRowId();
          onChange([
            ...rows,
            {
              client_id: clientId,
              id: '',
              label: '',
              context_window: '',
              max_output_tokens: '',
              input_image: false,
              reasoning: false,
            },
          ]);
          focusAfterRender(`custom-model-id-${clientId}`);
        }}
      >
        Add model
      </Button>
    </div>
  );
}

function updateRow<T>(rows: T[], index: number, row: T, onChange: (rows: T[]) => void) {
  onChange(rows.map((candidate, rowIndex) => (rowIndex === index ? row : candidate)));
}

function focusAfterRender(target: string | RefObject<HTMLElement | null>): void {
  requestAnimationFrame(() => {
    const element = typeof target === 'string' ? document.getElementById(target) : target.current;
    element?.focus();
  });
}

function validateDefaultModel(
  value: string,
  models: CustomModelProviderModelFormValue[],
): string | undefined {
  return value.trim() && !models.some((model) => model.id.trim() === value.trim())
    ? 'Choose a model from the models list.'
    : undefined;
}

function canParseUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}
