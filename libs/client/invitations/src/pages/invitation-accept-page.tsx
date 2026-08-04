import {
  AuthShell,
  useAuthState,
  useRefreshAuth,
  useRouteSearch,
} from '@shipfox/client-shell/runtime';
import {createSingleFlight} from '@shipfox/client-ui';
import {Button} from '@shipfox/react-ui/button';
import {Callout} from '@shipfox/react-ui/callout';
import {ShipfoxLoader} from '@shipfox/react-ui/loader';
import {toast} from '@shipfox/react-ui/toast';
import {Text} from '@shipfox/react-ui/typography';
import {formatDate} from '@shipfox/react-ui/utils';
import {Link, useNavigate} from '@tanstack/react-router';
import {useCallback, useEffect, useRef, useState} from 'react';
import {completeInvitationAcceptance} from '#complete-acceptance.js';
import {useAcceptInvitation} from '#hooks/api/accept-invitation.js';
import {usePreviewInvitation} from '#hooks/api/preview-invitation.js';
import {validateInvitationAcceptSearch} from '../routes/inputs.js';

const invitationAccepts = createSingleFlight<string, void>();
const toastedTerminals = new Set<string>();
const TOASTED_TERMINALS_MAX = 32;

export function InvitationAcceptPage() {
  const {token} = useRouteSearch(validateInvitationAcceptSearch);
  const navigate = useNavigate();
  const auth = useAuthState();
  const refreshAuth = useRefreshAuth();
  const preview = usePreviewInvitation(token);
  const accept = useAcceptInvitation();
  const hasKickedAccept = useRef(false);
  const hasRetriedWorkspaceHydration = useRef(false);
  const [authRefreshFailed, setAuthRefreshFailed] = useState(false);
  const [pendingWorkspaceId, setPendingWorkspaceId] = useState<string>();

  useEffect(() => {
    if (!pendingWorkspaceId || auth.isLoading || !auth.isAuthenticated) return;
    if (!auth.workspaces.some(({id}) => id === pendingWorkspaceId)) {
      if (hasRetriedWorkspaceHydration.current) {
        setPendingWorkspaceId(undefined);
        setAuthRefreshFailed(true);
        return;
      }
      hasRetriedWorkspaceHydration.current = true;
      void refreshAuth().catch(() => {
        setPendingWorkspaceId(undefined);
        setAuthRefreshFailed(true);
      });
      return;
    }

    setPendingWorkspaceId(undefined);
    void navigate({to: '/', replace: true});
  }, [
    auth.isAuthenticated,
    auth.isLoading,
    auth.workspaces,
    navigate,
    pendingWorkspaceId,
    refreshAuth,
  ]);

  useEffect(() => {
    hasKickedAccept.current = false;
    hasRetriedWorkspaceHydration.current = false;
    setAuthRefreshFailed(false);
    setPendingWorkspaceId(undefined);
    if (!token) {
      toast.error('This invitation link is missing a token.');
      const timeout = window.setTimeout(() => {
        navigate({to: '/', replace: true});
      }, 2000);
      return () => window.clearTimeout(timeout);
    }
    return undefined;
  }, [navigate, token]);

  const completeAccept = useCallback(
    async (workspaceId: string, workspaceName: string) => {
      const userId = auth.user?.id;
      if (!userId) throw new Error('Cannot complete invitation without an authenticated user.');
      const refreshed = await completeInvitationAcceptance({
        userId,
        workspaceId,
        workspaceName,
        refreshAuth,
        // Wait for the refreshed workspace list to reach the router context
        // before resolving the root route.
        navigate: () => setPendingWorkspaceId(workspaceId),
      });
      if (!refreshed) setAuthRefreshFailed(true);
    },
    [auth.user?.id, refreshAuth],
  );

  const runAccept = useCallback(
    async (params: {token: string; workspaceName: string}) => {
      const result = await accept.mutateAsync({token: params.token});
      await completeAccept(result.membership.workspaceId, params.workspaceName);
    },
    [accept, completeAccept],
  );

  // Auto-accept when authenticated and emails match (also handles already_used
  // for the canonical authenticated path: backend returns already_member=true).
  useEffect(() => {
    if (!token) return;
    if (auth.isLoading) return;
    if (hasKickedAccept.current) return;
    const data = preview.data;
    if (!data) return;
    if (data.status !== 'pending') return;
    if (!auth.isAuthenticated) return;

    const authedEmail = auth.user?.email?.toLowerCase();
    if (authedEmail !== data.email.toLowerCase()) return;

    hasKickedAccept.current = true;
    invitationAccepts
      .run(token, async () => await runAccept({token, workspaceName: data.workspaceName}))
      .catch(() => {
        // The mutation surfaces its error via accept.error; the UI re-renders
        // into the auth-match-error state below.
      });
  }, [auth.isAuthenticated, auth.isLoading, auth.user?.email, preview.data, runAccept, token]);

  if (!token) {
    return (
      <AuthShell title="Invalid link" description="This invitation link is incomplete.">
        <Callout role="alert" type="error">
          This invitation link is missing a token. Ask your administrator to resend it.
        </Callout>
        <Text size="sm" className="text-center text-foreground-neutral-muted" aria-live="polite">
          Redirecting to the dashboard…
        </Text>
      </AuthShell>
    );
  }

  if (preview.isLoading) {
    return (
      <AuthShell title="Loading invitation" description="One moment please.">
        <CenteredLoader />
      </AuthShell>
    );
  }

  if (preview.isError) {
    return (
      <AuthShell title="Couldn't load invitation" description="Try again in a moment.">
        <Callout role="alert" type="error">
          We couldn't reach the server. Check your connection and retry.
        </Callout>
        <Button className="w-full" onClick={() => preview.refetch()}>
          Try again
        </Button>
      </AuthShell>
    );
  }

  const data = preview.data;
  if (!data) {
    return null;
  }

  if (data.status === 'invalid') {
    notifyOnce(`invalid:${token}`, () => toast.error('This invitation link is no longer valid.'));
    return (
      <AuthShell title="Invalid invitation" description="The link you used didn't work.">
        <Callout role="alert" type="error">
          This invitation link is not valid. Ask your administrator to send a new one.
        </Callout>
        <GoHomeButton navigate={navigate} />
      </AuthShell>
    );
  }

  if (data.status === 'expired') {
    notifyOnce(`expired:${token}`, () => toast.error('This invitation has expired.'));
    return (
      <AuthShell title="Invitation expired" description="The link is no longer accepting joins.">
        <Callout role="alert" type="error">
          This invitation expired on {formatDate(data.expiresAt)}. Ask your administrator to send a
          new one.
        </Callout>
        <GoHomeButton navigate={navigate} />
      </AuthShell>
    );
  }

  if (data.status === 'already_used') {
    notifyOnce(`already-used:${token}`, () =>
      toast.info(`This invitation has already been accepted.`),
    );
    return (
      <AuthShell title="Invitation already used" description={data.workspaceName}>
        <Callout role="alert" type="info">
          This invitation has already been accepted.{' '}
          {auth.isAuthenticated
            ? `Open your dashboard to access ${data.workspaceName} if your account is a member.`
            : `Log in to access ${data.workspaceName}.`}
        </Callout>
        {auth.isAuthenticated ? null : (
          <Button asChild className="w-full">
            <Link to="/auth/login">Log in</Link>
          </Button>
        )}
        <GoHomeButton navigate={navigate} secondary />
      </AuthShell>
    );
  }

  const inviterLine =
    data.invitedByDisplay != null
      ? `Invited by ${data.invitedByDisplay} to join as ${data.email}.`
      : `Invited to join as ${data.email}.`;

  if (!auth.isAuthenticated) {
    const redirect = `/invitations/accept?token=${encodeURIComponent(token)}`;
    const signupHref = `/auth/signup?redirect=${encodeURIComponent(redirect)}`;
    const loginHref = `/auth/login?redirect=${encodeURIComponent(redirect)}`;
    return (
      <AuthShell title={data.workspaceName} description={inviterLine}>
        <div className="flex flex-col gap-group">
          <Button asChild className="w-full">
            <Link to={signupHref}>Create account</Link>
          </Button>
          <Button asChild className="w-full" variant="secondary">
            <Link to={loginHref}>I already have an account</Link>
          </Button>
        </div>
        <Text size="xs" className="text-center text-foreground-neutral-muted">
          Not {data.email}? Contact your administrator.
        </Text>
      </AuthShell>
    );
  }

  const viewerEmail = auth.user?.email?.toLowerCase();
  const inviteeEmail = data.email.toLowerCase();
  if (viewerEmail !== inviteeEmail) {
    const redirect = `/invitations/accept?token=${encodeURIComponent(token)}`;
    const logoutHref = `/auth/logout?redirect=${encodeURIComponent(redirect)}`;
    return (
      <AuthShell title={data.workspaceName} description={inviterLine}>
        <Callout role="alert" type="warning">
          You're signed in as {auth.user?.email}, but this invitation is for {data.email}.
        </Callout>
        <div className="flex flex-col gap-group">
          <Button asChild className="w-full">
            <Link to={logoutHref}>Log out and continue</Link>
          </Button>
          <Button
            className="w-full"
            variant="secondary"
            onClick={() => navigate({to: '/', replace: true})}
          >
            Cancel
          </Button>
        </div>
      </AuthShell>
    );
  }

  if (authRefreshFailed) {
    return (
      <AuthShell title={data.workspaceName} description={inviterLine}>
        <Callout role="alert" type="error">
          You joined {data.workspaceName}, but we couldn't refresh your session. Retry to continue
          to the workspace.
        </Callout>
        <Button
          className="w-full"
          onClick={async () => {
            try {
              await refreshAuth();
              setAuthRefreshFailed(false);
              hasRetriedWorkspaceHydration.current = false;
              setPendingWorkspaceId(data.workspaceId);
            } catch {
              setAuthRefreshFailed(true);
            }
          }}
        >
          Retry
        </Button>
      </AuthShell>
    );
  }

  // Authenticated + matches — auto-accept is in flight or about to render its
  // result. Show either the pending state or the error state.
  if (accept.isError) {
    return (
      <AuthShell title={data.workspaceName} description={inviterLine}>
        <Callout role="alert" type="error">
          We couldn't add you to {data.workspaceName}. Try again in a moment.
        </Callout>
        <Button
          className="w-full"
          isLoading={accept.isPending}
          onClick={() => {
            runAccept({token, workspaceName: data.workspaceName}).catch(() => {
              // The mutation state drives the rendered error; avoid an
              // unhandled rejection from the click handler.
            });
          }}
        >
          Try again
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={data.workspaceName} description={inviterLine}>
      <div className="flex flex-col items-center gap-cluster" aria-live="polite">
        <ShipfoxLoader />
        <Text size="sm" className="text-foreground-neutral-subtle">
          Adding you to {data.workspaceName}…
        </Text>
      </div>
    </AuthShell>
  );
}

function CenteredLoader() {
  return (
    <div className="flex justify-center py-row" aria-busy="true">
      <ShipfoxLoader />
    </div>
  );
}

function GoHomeButton({
  navigate,
  secondary,
}: {
  navigate: ReturnType<typeof useNavigate>;
  secondary?: boolean;
}) {
  return (
    <Button
      className="w-full"
      variant={secondary ? 'secondary' : 'primary'}
      onClick={() => navigate({to: '/', replace: true})}
    >
      Go to dashboard
    </Button>
  );
}

function notifyOnce(key: string, fn: () => void): void {
  if (toastedTerminals.has(key)) return;
  if (toastedTerminals.size >= TOASTED_TERMINALS_MAX) {
    const oldest = toastedTerminals.values().next().value;
    if (oldest !== undefined) toastedTerminals.delete(oldest);
  }
  toastedTerminals.add(key);
  fn();
}
