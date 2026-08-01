'use client';

import {
  type ComponentProps,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
  useId,
  useMemo,
} from 'react';
import {Input} from '#components/input/index.js';
import {Label} from '#components/label/index.js';
import {Textarea} from '#components/textarea/index.js';
import {Text} from '#components/typography/index.js';
import {cn} from '#utils/cn.js';

interface FormFieldContextValue {
  id: string;
  errorId: string;
  descriptionId: string;
  invalid: boolean;
  describedBy: string | undefined;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

export function useFormField(): {
  id: string;
  'aria-invalid': true | undefined;
  'aria-describedby': string | undefined;
} {
  const ctx = useContext(FormFieldContext);
  if (!ctx) {
    throw new Error('useFormField() must be used inside a <FormField>.');
  }
  return {
    id: ctx.id,
    'aria-invalid': ctx.invalid ? true : undefined,
    'aria-describedby': ctx.describedBy,
  };
}

export interface FormFieldProps {
  label: ReactNode;
  /** Optional id; auto-generated via useId() when omitted. */
  id?: string | undefined;
  /** Field-level error message: when truthy, sets aria-invalid on the input. */
  error?: string | undefined;
  /** Helper text shown when there is no error. */
  description?: ReactNode;
  className?: string | undefined;
  children: ReactNode;
}

export function FormField({label, id, error, description, className, children}: FormFieldProps) {
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const errorId = `${fieldId}-error`;
  const descriptionId = `${fieldId}-description`;
  const invalid = Boolean(error);
  const describedBy = error ? errorId : description ? descriptionId : undefined;

  const value = useMemo<FormFieldContextValue>(
    () => ({id: fieldId, errorId, descriptionId, invalid, describedBy}),
    [fieldId, errorId, descriptionId, invalid, describedBy],
  );

  return (
    <FormFieldContext.Provider value={value}>
      <div className={cn('flex flex-col gap-8', className)}>
        <Label htmlFor={fieldId}>{label}</Label>
        {children}
        {error ? (
          <Text as="p" size="xs" className="text-tag-error-text" id={errorId}>
            {error}
          </Text>
        ) : description ? (
          <Text as="p" size="xs" className="text-foreground-neutral-muted" id={descriptionId}>
            {description}
          </Text>
        ) : null}
      </div>
    </FormFieldContext.Provider>
  );
}

/**
 * Input wired to the surrounding <FormField> via useFormField(). Use this in
 * call sites instead of `<Input {...useFormField()} />` because the hook must
 * run inside the FormField's subtree, not in the parent JSX.
 */
export const FormFieldInput = forwardRef<HTMLInputElement, ComponentProps<typeof Input>>(
  (props, ref) => {
    const wiring = useFormField();
    return <Input ref={ref} {...props} {...wiring} />;
  },
);

FormFieldInput.displayName = 'FormFieldInput';

export const FormFieldTextarea = forwardRef<HTMLTextAreaElement, ComponentProps<typeof Textarea>>(
  (props, ref) => {
    const wiring = useFormField();
    return <Textarea ref={ref} {...props} {...wiring} />;
  },
);

FormFieldTextarea.displayName = 'FormFieldTextarea';

interface FieldLike {
  state: {meta: {errors: Array<unknown>; isBlurred: boolean}};
}

/**
 * Extracts the first error message from a TanStack Form field's validation
 * state. Returns `undefined` when there are no errors to display. Pass the
 * result directly to `<FormField error={fieldError(field)}>`.
 */
export function fieldError(field: FieldLike): string | undefined {
  if (!field.state.meta.isBlurred && field.state.meta.errors.length === 0) return undefined;
  const first = field.state.meta.errors[0];
  if (!first) return undefined;
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'message' in first) {
    return String((first as {message: unknown}).message);
  }
  return undefined;
}
