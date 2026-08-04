import {loginBodySchema} from '@shipfox/api-auth-dto';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {useForm} from '@tanstack/react-form';
import {useAtom} from 'jotai';
import {type ReactNode, useEffect, useRef, useState} from 'react';
import {useLoginAuth} from '#hooks/api/login-auth.js';
import {loginErrorToFormError} from '#pages/form-errors.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';

export interface PasswordLoginFormProps {
  children?: ReactNode;
  invitationEmail?: string | undefined;
}

export function PasswordLoginForm({children, invitationEmail}: PasswordLoginFormProps = {}) {
  const login = useLoginAuth();
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [formError, setFormError] = useState<string | undefined>();
  const draftRef = useRef(authFormDraft);
  draftRef.current = authFormDraft;
  // Set just before clearing the draft on success so the unmount cleanup
  // below does not repersist the just-submitted credentials.
  const skipDraftPersistRef = useRef(false);

  const form = useForm({
    defaultValues: {email: authFormDraft.email, password: authFormDraft.password},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        await login.mutateAsync(value);
        skipDraftPersistRef.current = true;
        setAuthFormDraft(initialAuthFormDraft);
      } catch (error) {
        const mapped = loginErrorToFormError(error);
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

  useEffect(() => {
    if (invitationEmail && form.state.values.email !== invitationEmail) {
      form.setFieldValue('email', invitationEmail);
      setAuthFormDraft((current) => ({...current, email: invitationEmail}));
    }
  }, [form, invitationEmail, setAuthFormDraft]);

  // Sync TanStack Form values back into the Jotai draft on unmount so a
  // navigation to /signup or /reset preserves what the user typed. Skipped
  // after a successful login because we just intentionally cleared the draft.
  useEffect(() => {
    return () => {
      if (skipDraftPersistRef.current) return;
      const {email, password} = form.state.values;
      if (email !== draftRef.current.email || password !== draftRef.current.password) {
        setAuthFormDraft({email, password});
      }
    };
  }, [form, setAuthFormDraft]);

  function persistDraft() {
    const {email, password} = form.state.values;
    setAuthFormDraft({email, password});
  }

  return (
    <form
      className="flex flex-col gap-group"
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
        name="email"
        validators={{onBlur: loginBodySchema.shape.email, onSubmit: loginBodySchema.shape.email}}
      >
        {(field) => (
          <FormField label="Email" id="email" error={fieldError(field)}>
            <FormFieldInput
              autoComplete="email"
              name="email"
              type="email"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={() => {
                field.handleBlur();
                persistDraft();
              }}
              readOnly={Boolean(invitationEmail)}
              iconRight={
                invitationEmail ? (
                  <Icon
                    aria-hidden="true"
                    className="size-16 text-foreground-neutral-disabled"
                    name="lockLine"
                  />
                ) : undefined
              }
            />
          </FormField>
        )}
      </form.Field>
      <form.Field
        name="password"
        validators={{
          onBlur: loginBodySchema.shape.password,
          onSubmit: loginBodySchema.shape.password,
        }}
      >
        {(field) => (
          <FormField label="Password" id="password" error={fieldError(field)}>
            <FormFieldInput
              autoComplete="current-password"
              name="password"
              type="password"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              onBlur={() => {
                field.handleBlur();
                persistDraft();
              }}
            />
          </FormField>
        )}
      </form.Field>
      {children}
      <Button className="w-full" isLoading={login.isPending} type="submit">
        {login.isPending ? 'Logging in...' : 'Log in'}
      </Button>
    </form>
  );
}
