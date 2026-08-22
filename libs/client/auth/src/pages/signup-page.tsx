import {signupBodySchema} from '@shipfox/api-auth-dto';
import {
  AuthShell,
  rememberLastWorkspaceId,
  useRouteSearch,
  userWorkspacesQueryKey,
} from '@shipfox/client-shell/runtime';
import {displayNameFieldError} from '@shipfox/client-ui';
import {Button, ButtonLink} from '@shipfox/react-ui/button';
import {Callout, CalloutContent} from '@shipfox/react-ui/callout';
import {FormField, FormFieldInput, fieldError} from '@shipfox/react-ui/form-field';
import {Icon} from '@shipfox/react-ui/icon';
import {Markdown} from '@shipfox/react-ui/markdown';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {useForm} from '@tanstack/react-form';
import {useQueryClient} from '@tanstack/react-query';
import {Link, useNavigate} from '@tanstack/react-router';
import {useAtom} from 'jotai';
import {useEffect, useRef, useState} from 'react';
import {EmailCodeVerification} from '#/components/email-code-verification.js';
import {useRefreshAuth} from '#hooks/api/refresh-auth.js';
import {useSignupAuth} from '#hooks/api/signup-auth.js';
import {useResendEmailVerificationAuth, useVerifyEmailAuth} from '#hooks/api/verify-email-auth.js';
import {authFormDraftAtom, initialAuthFormDraft} from '#state/auth.js';
import {validateRedirectSearch} from '../routes/inputs.js';
import {signupErrorToFormError} from './form-errors.js';
import {authErrorMessage} from './form-utils.js';
import {
  extractInvitationToken,
  pendingInvitation,
  useInvitationContext,
} from './invitation-context.js';

export function SignupPage() {
  const signup = useSignupAuth();
  const verifyEmail = useVerifyEmailAuth();
  const resendEmailVerification = useResendEmailVerificationAuth();
  const refreshAuth = useRefreshAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const search = useRouteSearch(validateRedirectSearch);
  const invitationToken = extractInvitationToken(search.redirect);
  const invitationPreview = useInvitationContext(invitationToken);
  const invitationPending = pendingInvitation(invitationPreview.data);
  const [authFormDraft, setAuthFormDraft] = useAtom(authFormDraftAtom);
  const [emailChallenge, setEmailChallenge] = useState<{email: string; id: string} | undefined>();
  const [nextResendAvailableAt, setNextResendAvailableAt] = useState<string | undefined>();
  const [formError, setFormError] = useState<{message: string; format?: 'markdown'} | undefined>();
  const [resendError, setResendError] = useState<string | undefined>();
  const [invitationRefreshFailure, setInvitationRefreshFailure] = useState<{
    workspaceId: string;
    workspaceName: string;
    userId?: string | undefined;
  }>();
  const [isRetryingInvitationRefresh, setIsRetryingInvitationRefresh] = useState(false);
  const draftRef = useRef(authFormDraft);
  draftRef.current = authFormDraft;
  // Set just before clearing the draft on success so the unmount cleanup
  // below does not repersist the just-submitted credentials.
  const skipDraftPersistRef = useRef(false);

  async function refreshInvitationWorkspace(workspaceId: string) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await refreshAuth();
        const workspaces = queryClient.getQueryData<{
          memberships: Array<{id: string}>;
        }>(userWorkspacesQueryKey);
        const memberships = workspaces?.memberships ?? [];
        if (memberships.some(({id}) => id === workspaceId)) return true;
      } catch {
        // A mount-time refresh can race the post-signup refresh. Retry once so
        // an in-flight request that predates membership creation does not turn
        // a successful invitation into a manual recovery flow.
      }
    }
    return false;
  }

  const form = useForm({
    defaultValues: {email: authFormDraft.email, password: authFormDraft.password, name: ''},
    onSubmit: async ({value}) => {
      setFormError(undefined);
      try {
        const parsed = signupBodySchema.parse({
          email: value.email,
          password: value.password,
          name: value.name,
          ...(invitationToken ? {invitation_token: invitationToken} : {}),
        });
        const result = await signup.mutateAsync({
          email: parsed.email,
          password: parsed.password,
          name: parsed.name,
          ...(parsed.invitation_token ? {invitationToken: parsed.invitation_token} : {}),
        });
        skipDraftPersistRef.current = true;
        setAuthFormDraft(initialAuthFormDraft);

        if (invitationToken && result.membership && invitationPending) {
          const joinedWorkspace = await refreshInvitationWorkspace(result.membership.workspaceId);
          if (!joinedWorkspace) {
            setInvitationRefreshFailure({
              workspaceId: result.membership.workspaceId,
              workspaceName: invitationPending.workspaceName,
              userId: result.user?.id,
            });
            return;
          }
          toast.success(`You joined ${invitationPending.workspaceName}.`);
          if (result.user?.id) {
            rememberLastWorkspaceId(result.user.id, result.membership.workspaceId);
          }
          await navigate({to: '/'});
          return;
        }

        if (invitationToken && result.acceptError) {
          toast.error(result.acceptError.message);
          await navigate({
            to: '/invitations/accept',
            search: {token: invitationToken},
          });
          return;
        }

        if (!result.emailChallenge) {
          throw new Error('Signup did not return an email verification challenge');
        }
        setEmailChallenge({email: result.user.email, id: result.emailChallenge.id});
        setResendError(undefined);
        setNextResendAvailableAt(result.emailChallenge.nextResendAvailableAt);
      } catch (error) {
        const mapped = signupErrorToFormError(error);
        if (mapped.kind === 'field') {
          form.setFieldMeta(mapped.field, (prev) => ({
            ...prev,
            errorMap: {...prev.errorMap, onServer: mapped.message},
          }));
        } else {
          setFormError(mapped);
        }
      }
    },
  });

  async function retryInvitationAuthRefresh() {
    if (!invitationRefreshFailure || isRetryingInvitationRefresh) return;
    setIsRetryingInvitationRefresh(true);
    const joinedWorkspace = await refreshInvitationWorkspace(invitationRefreshFailure.workspaceId);
    setIsRetryingInvitationRefresh(false);
    if (!joinedWorkspace) return;
    if (invitationRefreshFailure.userId) {
      rememberLastWorkspaceId(
        invitationRefreshFailure.userId,
        invitationRefreshFailure.workspaceId,
      );
    }
    toast.success(`You joined ${invitationRefreshFailure.workspaceName}.`);
    setInvitationRefreshFailure(undefined);
    await navigate({to: '/'});
  }

  // When arriving from an invitation link, prefill the email and lock it.
  useEffect(() => {
    if (invitationPending && form.state.values.email !== invitationPending.email) {
      form.setFieldValue('email', invitationPending.email);
      setAuthFormDraft((current) => ({...current, email: invitationPending.email}));
    }
  }, [invitationPending, form, setAuthFormDraft]);

  // Sync form values back to the Jotai draft on unmount. The draft stores only
  // email and password; name is intentionally not persisted across navigation.
  // Skipped after a
  // successful signup because we just intentionally cleared the draft.
  useEffect(() => {
    return () => {
      if (skipDraftPersistRef.current) return;
      const {email, password} = form.state.values;
      if (email !== draftRef.current.email || password !== draftRef.current.password) {
        setAuthFormDraft({email, password});
      }
    };
  }, [form, setAuthFormDraft]);

  async function onResendVerificationEmail() {
    if (!emailChallenge || resendEmailVerification.isPending) return;

    setResendError(undefined);
    try {
      const result = await resendEmailVerification.mutateAsync({
        email: emailChallenge.email,
        challengeId: emailChallenge.id,
      });
      setNextResendAvailableAt(result.nextResendAvailableAt);
      toast.success('If another verification email can be sent, it will arrive shortly.');
    } catch (error) {
      setResendError(authErrorMessage(error));
    }
  }

  if (invitationRefreshFailure) {
    return (
      <AuthShell
        title={`Join ${invitationRefreshFailure.workspaceName}`}
        description="Your account was created, but we could not finish signing you in."
      >
        <Callout role="alert" type="error">
          <div className="flex flex-col gap-inline">
            <Text size="sm">
              Try again to finish joining your workspace. You can safely retry this step.
            </Text>
            <Button
              type="button"
              variant="secondary"
              className="w-fit"
              isLoading={isRetryingInvitationRefresh}
              onClick={() => {
                void retryInvitationAuthRefresh();
              }}
            >
              Retry sign-in
            </Button>
          </div>
        </Callout>
      </AuthShell>
    );
  }

  if (emailChallenge) {
    return (
      <EmailCodeVerification
        destination={emailChallenge.email}
        nextResendAvailableAt={nextResendAvailableAt}
        isResending={resendEmailVerification.isPending}
        isVerifying={verifyEmail.isPending}
        error={resendError}
        onVerify={async (code) => {
          setResendError(undefined);
          try {
            await verifyEmail.mutateAsync({
              email: emailChallenge.email,
              challengeId: emailChallenge.id,
              code,
            });
            await refreshAuth();
            toast.success('Your email is verified. You are now logged in.');
            await navigate({to: '/', replace: true});
          } catch (error) {
            setResendError(authErrorMessage(error));
          }
        }}
        onResend={onResendVerificationEmail}
        onUseAnotherEmail={() => {
          setEmailChallenge(undefined);
          setResendError(undefined);
        }}
      >
        <Text size="sm" className="text-center text-foreground-neutral-subtle">
          Already verified?{' '}
          <ButtonLink asChild variant="interactive" underline>
            <Link to="/auth/login">Log in</Link>
          </ButtonLink>
        </Text>
      </EmailCodeVerification>
    );
  }

  const headerTitle = invitationPending
    ? `Join ${invitationPending.workspaceName}`
    : 'Create your Shipfox account';
  const headerDescription = invitationPending
    ? `Create an account to accept your invitation.`
    : 'Start with your email and a password.';
  const isInvitationEmailLocked = Boolean(invitationPending);
  const invitationRedirect = invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(invitationToken)}`
    : undefined;

  function persistDraft() {
    const {email, password} = form.state.values;
    setAuthFormDraft({email, password});
  }

  return (
    <AuthShell title={headerTitle} description={headerDescription}>
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
            <CalloutContent>
              {formError.format === 'markdown' ? (
                <Markdown className="[&>*:last-child]:mb-0">{formError.message}</Markdown>
              ) : (
                formError.message
              )}
            </CalloutContent>
          </Callout>
        ) : null}
        <form.Field
          name="name"
          validators={{
            onBlur: ({value}) => displayNameFieldError(value, 'Name', signupBodySchema.shape.name),
            onSubmit: ({value}) =>
              displayNameFieldError(value, 'Name', signupBodySchema.shape.name),
          }}
        >
          {(field) => (
            <FormField label="Name" id="name" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="name"
                name="name"
                type="text"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        </form.Field>
        <form.Field
          name="email"
          validators={{
            onBlur: signupBodySchema.shape.email,
            onSubmit: signupBodySchema.shape.email,
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
                  persistDraft();
                }}
                readOnly={isInvitationEmailLocked}
                iconRight={
                  isInvitationEmailLocked ? (
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
            onBlur: signupBodySchema.shape.password,
            onSubmit: signupBodySchema.shape.password,
          }}
        >
          {(field) => (
            <FormField label="Password" id="password" error={fieldError(field)}>
              <FormFieldInput
                autoComplete="new-password"
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
        <Button className="w-full" isLoading={signup.isPending} type="submit">
          {signup.isPending ? 'Creating account...' : 'Create account'}
        </Button>
      </form>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        Already have an account?{' '}
        <ButtonLink asChild variant="interactive" underline>
          <Link
            to="/auth/login"
            search={invitationRedirect ? {redirect: invitationRedirect} : undefined}
          >
            Log in
          </Link>
        </ButtonLink>
      </Text>
    </AuthShell>
  );
}
