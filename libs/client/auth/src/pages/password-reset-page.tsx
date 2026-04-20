import {
  passwordResetConfirmBodySchema,
  passwordResetRequestBodySchema,
} from '@shipfox/api-auth-dto';
import {Alert, Button, ButtonLink, Input, Label, Text, toast} from '@shipfox/react-ui';
import {Link, useNavigate, useSearch} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {type FormEvent, useState} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {
  useConfirmPasswordResetAuth,
  useRequestPasswordResetAuth,
} from '#hooks/api/password-reset-auth.js';
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {authErrorMessage, type FieldErrors, fieldErrorsFromZod} from './form-utils.js';

type RequestField = 'email';
type ConfirmField = 'new_password';

export function PasswordResetPage() {
  const search = useSearch({strict: false});
  const token = typeof search.token === 'string' ? search.token : undefined;

  if (token) {
    return <PasswordResetConfirm token={token} />;
  }

  return <PasswordResetRequest />;
}

function PasswordResetRequest() {
  const requestPasswordReset = useRequestPasswordResetAuth();
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<RequestField>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const {email} = authFormDraft;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = passwordResetRequestBodySchema.safeParse({email});
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod<RequestField>(parsed.error));
      return;
    }

    setFieldErrors({});
    try {
      await requestPasswordReset.mutateAsync(parsed.data);
      setSubmittedEmail(parsed.data.email);
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  if (submittedEmail) {
    return (
      <AuthShell
        title="Check your email"
        description={`We sent reset instructions to ${submittedEmail}.`}
      >
        <Alert variant="success">
          If a Shipfox account exists for that email, the reset link will arrive shortly.
        </Alert>
        <Button
          className="w-full"
          variant="secondary"
          type="button"
          onClick={() => setSubmittedEmail(undefined)}
        >
          Use another email
        </Button>
        <Text size="sm" className="text-center text-foreground-neutral-subtle">
          Remembered it? <Link to="/auth/login">Log in</Link>
        </Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" description="Enter your email to get a reset link.">
      <form className="flex flex-col gap-18" onSubmit={onSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="flex flex-col gap-8">
          <Label htmlFor="email">Email</Label>
          <Input
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
            aria-invalid={fieldErrors.email ? true : undefined}
            autoComplete="email"
            id="email"
            name="email"
            onChange={(event) =>
              setAuthFormDraft((current) => ({...current, email: event.target.value}))
            }
            type="email"
            value={email}
          />
          {fieldErrors.email ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="email-error">
              {fieldErrors.email}
            </Text>
          ) : null}
        </div>
        <Button className="w-full" isLoading={requestPasswordReset.isPending} type="submit">
          {requestPasswordReset.isPending ? 'Sending link...' : 'Send reset link'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        Remembered it? <Link to="/auth/login">Log in</Link>
      </Text>
    </AuthShell>
  );
}

function PasswordResetConfirm({token}: {token: string}) {
  const confirmPasswordReset = useConfirmPasswordResetAuth();
  const refreshAuth = useRefreshAuth();
  const navigate = useNavigate();
  const [, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [newPassword, setNewPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<ConfirmField>>({});
  const [formError, setFormError] = useState<string | undefined>();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = passwordResetConfirmBodySchema.safeParse({token, new_password: newPassword});
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod<ConfirmField>(parsed.error));
      return;
    }

    setFieldErrors({});
    try {
      await confirmPasswordReset.mutateAsync(parsed.data);
      await refreshAuth();
      setAuthFormDraft(initialAuthFormDraft);
      toast.success('Your password has been changed. You are now logged in.');
      await navigate({to: '/', replace: true});
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  return (
    <AuthShell title="Set a new password" description="Choose a password for your Shipfox account.">
      <form className="flex flex-col gap-18" onSubmit={onSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="flex flex-col gap-8">
          <Label htmlFor="new-password">New password</Label>
          <Input
            aria-describedby={fieldErrors.new_password ? 'new-password-error' : undefined}
            aria-invalid={fieldErrors.new_password ? true : undefined}
            autoComplete="new-password"
            id="new-password"
            name="new_password"
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            value={newPassword}
          />
          {fieldErrors.new_password ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="new-password-error">
              {fieldErrors.new_password}
            </Text>
          ) : null}
        </div>
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
