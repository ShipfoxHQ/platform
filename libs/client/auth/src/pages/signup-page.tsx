import {signupBodySchema} from '@shipfox/api-auth-dto';
import {Alert, Button, Input, Label, Text} from '@shipfox/react-ui';
import {Link} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {type FormEvent, useState} from 'react';
import {AuthShell} from '#/components/auth-shell.js';
import {useSignupAuth} from '#hooks/api/signup-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {authErrorMessage, type FieldErrors, fieldErrorsFromZod} from './form-utils.js';

type SignupField = 'email' | 'password' | 'name';

export function SignupPage() {
  const signup = useSignupAuth();
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [name, setName] = useState('');
  const [submittedEmail, setSubmittedEmail] = useState<string | undefined>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors<SignupField>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const {email, password} = authFormDraft;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(undefined);
    const parsed = signupBodySchema.safeParse({
      email,
      password,
      name: name.trim() ? name.trim() : undefined,
    });
    if (!parsed.success) {
      setFieldErrors(fieldErrorsFromZod<SignupField>(parsed.error));
      return;
    }

    setFieldErrors({});
    try {
      const result = await signup.mutateAsync(parsed.data);
      setAuthFormDraft(initialAuthFormDraft);
      setSubmittedEmail(result.user.email);
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  if (submittedEmail) {
    return (
      <AuthShell
        title="Check your email"
        description={`We sent a verification link to ${submittedEmail}.`}
      >
        <Alert variant="success">
          Click the verification link to activate your account, then come back to log in.
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
          Already verified? <Link to="/auth/login">Log in</Link>
        </Text>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your Shipfox account"
      description="Start with your email and a password."
    >
      <form className="flex flex-col gap-18" onSubmit={onSubmit} noValidate>
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div className="flex flex-col gap-8">
          <Label htmlFor="name">Name</Label>
          <Input
            aria-describedby={fieldErrors.name ? 'name-error' : undefined}
            aria-invalid={fieldErrors.name ? true : undefined}
            autoComplete="name"
            id="name"
            name="name"
            onChange={(event) => setName(event.target.value)}
            type="text"
            value={name}
          />
          {fieldErrors.name ? (
            <Text as="p" size="xs" className="text-tag-error-text" id="name-error">
              {fieldErrors.name}
            </Text>
          ) : null}
        </div>
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
            autoComplete="new-password"
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
        <Button className="w-full" isLoading={signup.isPending} type="submit">
          {signup.isPending ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        Already have an account? <Link to="/auth/login">Log in</Link>
      </Text>
    </AuthShell>
  );
}
