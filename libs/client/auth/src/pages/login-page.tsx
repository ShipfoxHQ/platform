import {AuthShell, useRouteSearch} from '@shipfox/client-shell/runtime';
import {ButtonLink} from '@shipfox/react-ui/button';
import {Text} from '@shipfox/react-ui/typography';
import {Link} from '@tanstack/react-router';
import {PasswordLoginForm} from '#components/password-login-form.js';
import {validateRedirectSearch} from '../routes/inputs.js';
import {
  extractInvitationToken,
  pendingInvitation,
  useInvitationContext,
} from './invitation-context.js';

export function LoginPage() {
  const search = useRouteSearch(validateRedirectSearch);
  const invitationToken = extractInvitationToken(search.redirect);
  const invitationPreview = useInvitationContext(invitationToken);
  const invitationPending = pendingInvitation(invitationPreview.data);
  const invitationRedirect = invitationToken
    ? `/invitations/accept?token=${encodeURIComponent(invitationToken)}`
    : undefined;
  const headerTitle = invitationPending
    ? `Join ${invitationPending.workspaceName}`
    : 'Connect to Shipfox';
  const headerDescription = invitationPending
    ? 'Log in to accept your invitation.'
    : 'Log in to access Shipfox.';

  return (
    <AuthShell title={headerTitle} description={headerDescription}>
      <PasswordLoginForm invitationEmail={invitationPending?.email}>
        <ButtonLink asChild variant="subtle" className="-mt-inline self-end">
          <Link to="/auth/reset">Forgot password?</Link>
        </ButtonLink>
      </PasswordLoginForm>
      <Text size="sm" className="text-center text-foreground-neutral-subtle">
        New to Shipfox?{' '}
        <ButtonLink asChild variant="interactive" underline>
          <Link
            to="/auth/signup"
            search={invitationRedirect ? {redirect: invitationRedirect} : undefined}
          >
            Create an account
          </Link>
        </ButtonLink>
      </Text>
    </AuthShell>
  );
}
