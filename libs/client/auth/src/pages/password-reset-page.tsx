import {
  passwordResetConfirmBodySchema,
  passwordResetRequestBodySchema,
} from '@shipfox/api-auth-dto';
import {AuthShell, useRouteSearch} from '@shipfox/client-shell/runtime';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {Link, useNavigate} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {useEffect, useRef, useState} from 'react';
import {
  useConfirmPasswordResetAuth,
  useRequestPasswordResetAuth,
} from '#hooks/api/password-reset-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {validatePasswordResetSearch} from '../routes/inputs.js';
import {
  passwordResetConfirmErrorToFormError,
  passwordResetRequestErrorToFormError,
} from './form-errors.js';

export function PasswordResetPage() {
  const {token} = useRouteSearch(validatePasswordResetSearch);

  if (token) {
    return <PasswordResetConfirm token={token} />;
  }

  return <PasswordResetRequest />;
}

function PasswordResetRequest() {
  const requestPasswordReset = useRequestPasswordResetAuth();
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | undefined>();
  const draftRef = useRef(authFormDraft);
  draftRef.current = authFormDraft;

  const form = useForm({
    defaultValues: {email: authFormDraft.email},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const parsed = passwordResetRequestBodySchema.parse(value);
        await requestPasswordReset.mutateAsync(parsed);
        setSubmittedEmail(parsed.email);
      } catch (error) {
        const mapped = passwordResetRequestErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  useEffect(() => {
    return () => {
      const {email} = form.state.values;
      if (email !== draftRef.current.email) {
        setAuthFormDraft((current) => ({...current, email}));
      }
    };
  }, [form, setAuthFormDraft]);

  if (submittedEmail) {
    return (
      <AuthShell
        title="Check your email"
        description={`We sent reset instructions to ${submittedEmail}.`}
      >
        <Callout role="alert" type="success">
          If a Shipfox account exists for that email, the reset link will arrive shortly.
        </Callout>
        <Button
          className="w-full"
          variant="secondary"
          type="button"
          onClick={() => setSubmittedEmail(undefined)}
        >
          Use another email
        </Button>
        <Text size="sm" className="text-center text-foreground-neutral-subtle">
          Remembered it?{' '}
          <ButtonLink asChild variant="interactive" underline>
            <Link to="/auth/login">Log in</Link>
          </ButtonLink>
        </Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" description="Enter your email to get a reset link.">
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
          validators={{
            onBlur: passwordResetRequestBodySchema.shape.email,
            onSubmit: passwordResetRequestBodySchema.shape.email,
          }}
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
                  setAuthFormDraft((current) => ({...current, email: field.state.value}));
                }}
              />
            </FormField>
          )}
        </form.Field>
        <Button className="w-full" isLoading={requestPasswordReset.isPending} type="submit">
          {requestPasswordReset.isPending ? 'Sending link...' : 'Send reset link'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        Remembered it?{' '}
        <ButtonLink asChild variant="interactive" underline>
          <Link to="/auth/login">Log in</Link>
        </ButtonLink>
      </Text>
    </AuthShell>
  );
}

function PasswordResetConfirm({token}: {token: string}) {
  const confirmPasswordReset = useConfirmPasswordResetAuth();
  const navigate = useNavigate();
  const [, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [formError, setFormError] = useState<string | undefined>();

  const form = useForm({
    defaultValues: {new_password: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const body = passwordResetConfirmBodySchema.parse({
          token,
          new_password: value.new_password,
        });
        await confirmPasswordReset.mutateAsync({token: body.token, newPassword: body.new_password});
        setAuthFormDraft(initialAuthFormDraft);
        toast.success('Your password has been changed. You are now logged in.');
        await navigate({to: '/', replace: true});
      } catch (error) {
        const mapped = passwordResetConfirmErrorToFormError(error);
        setFormError(mapped.message);
      }
    },
  });

  return (
    <AuthShell title="Set a new password" description="Choose a password for your Shipfox account.">
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
          name="new_password"
          validators={{
            onBlur: passwordResetConfirmBodySchema.shape.new_password,
            onSubmit: passwordResetConfirmBodySchema.shape.new_password,
          }}
        >
          {(field) => (
            <FormField label="New password" id="new-password" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="new-password"
                name="new_password"
                type="password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <Button className="w-full" isLoading={confirmPasswordReset.isPending} type="submit">
          {confirmPasswordReset.isPending ? 'Updating password...' : 'Update password'}
        </Button>
      </form>
      <ButtonLink asChild variant="subtle" className="self-center">
        <Link to="/auth/login">Back to login</Link>
      </ButtonLink>
    </AuthShell>
  );
}
