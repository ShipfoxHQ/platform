import {FormField, useFormField} from '@shipfox/react-ui/form-field';
import {cn} from '@shipfox/react-ui/utils';
import type {ComponentProps, ReactNode} from 'react';
import type {SupportedProvider} from '#core/models.js';

export const LATEST_MODEL_VALUE = '__latest__';

export function DefaultModelField({
  entry,
  value,
  error,
  children,
  onChange,
  onBlur,
}: {
  entry: SupportedProvider;
  value: string;
  error: string | undefined;
  children?: ReactNode;
  onChange: ComponentProps<'select'>['onChange'];
  onBlur: ComponentProps<'select'>['onBlur'];
}) {
  return (
    <FormField
      label="Default model"
      id={`model-provider-${entry.id}-default-model`}
      error={error}
      description={defaultModelDescription(entry, value)}
    >
      <FormFieldSelect value={value} onChange={onChange} onBlur={onBlur}>
        <option value={LATEST_MODEL_VALUE}>Latest</option>
        {entry.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.label}
          </option>
        ))}
      </FormFieldSelect>
      {children}
    </FormField>
  );
}

export function defaultModelFormValue(defaultModel: string | null | undefined): string {
  return defaultModel ?? LATEST_MODEL_VALUE;
}

export function selectedModelForCredentialsPayload(selectedModel: string): string | null {
  return selectedModel === LATEST_MODEL_VALUE ? null : selectedModel.trim();
}

export function selectedModelForModelPayload(selectedModel: string): string | null {
  return selectedModel === LATEST_MODEL_VALUE ? null : selectedModel.trim();
}

function defaultModelLabel(entry: SupportedProvider): string {
  const defaultModel = entry.defaultModel ?? entry.models[0]?.id ?? '';
  return entry.models.find((model) => model.id === defaultModel)?.label ?? defaultModel;
}

function defaultModelDescription(
  entry: SupportedProvider,
  selectedModel: string | undefined,
): string | undefined {
  if (selectedModel === LATEST_MODEL_VALUE) {
    return `Latest follows the provider catalog default. Currently resolves to ${defaultModelLabel(entry)}.`;
  }
  if (!selectedModel) return undefined;
  return selectedModel;
}

export function FormFieldSelect({className, ...props}: ComponentProps<'select'>) {
  const wiring = useFormField();
  return (
    <select
      className={cn(
        'w-full min-w-0 rounded-6 bg-background-field-base px-tight py-[6px] text-sm leading-20 text-foreground-neutral-base shadow-button-neutral outline-none transition-[color,box-shadow]',
        'hover:bg-background-field-hover focus-visible:shadow-border-interactive-with-active disabled:cursor-not-allowed disabled:bg-background-neutral-disabled disabled:text-foreground-neutral-disabled',
        'aria-invalid:shadow-border-error',
        className,
      )}
      {...props}
      {...wiring}
    />
  );
}
