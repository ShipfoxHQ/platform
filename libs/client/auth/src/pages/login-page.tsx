import {loginBodySchema} from '@shipfox/api-auth-dto';
import {Alert, Button, ButtonLink, Input, Label, Text} from '@shipfox/react-ui';
import {Link, useNavigate} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {type FormEvent, useState} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {useLoginAuth} from '#hooks/api/login-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {authErrorMessage, type FieldErrors, fieldErrorsFromZod} from './form-utils.js';

type LoginField = 'email' | 'password';

export function LoginPage() {
  const login = useLoginAuth();
  const navigate = useNavigate();
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<LoginField>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const {email, password} = authFormDraft;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = loginBodySchema.safeParse({email, password});
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod<LoginField>(parsed.error));
      return;
    }

    setFieldErrors({});
    try {
      await login.mutateAsync(parsed.data);
      setAuthFormDraft(initialAuthFormDraft);
      await navigate({to: '/', replace: true});
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  return (
    <AuthShell title="Connect to Shipfox" description="Log in to access Shipfox.">
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
        <div className="flex flex-col gap-8">
          <Label htmlFor="password">Password</Label>
          <Input
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
            aria-invalid={fieldErrors.password ? true : undefined}
            autoComplete="current-password"
            id="password"
            name="password"
            onChange={(event) =>
              setAuthFormDraft((current) => ({...current, password: event.target.value}))
            }
            type="password"
            value={password}
          />
          {fieldErrors.password ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="password-error">
              {fieldErrors.password}
            </Text>
          ) : null}
        </div>
        <ButtonLink asChild variant="subtle" className="-mt-8 self-end">
          <Link to="/auth/reset">Forgot password?</Link>
        </ButtonLink>
        <Button className="w-full" isLoading={login.isPending} type="submit">
          {login.isPending ? 'Logging in...' : 'Log in'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        New to Shipfox? <Link to="/auth/signup">Create an account</Link>
      </Text>
    </AuthShell>
  );
}
