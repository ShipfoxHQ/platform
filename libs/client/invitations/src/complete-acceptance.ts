import {rememberLastWorkspaceId} from '@shipfox/client-shell/runtime';
import {toast} from '@shipfox/react-ui/toast';
import type {NavigateOptions} from '@tanstack/react-router';

/**
 * Final step of every successful invitation accept path (existing-user match,
 * signup-with-invitation success, login-then-accept). Refreshes the auth
 * session so the JWT carries the new membership before navigating, then
 * routes the user into the workspace home.
 *
 * `refreshAuth` is passed in so this helper stays a plain function (no hook).
 * Call sites construct it via `useRefreshAuth()` from `@shipfox/client-shell/runtime`.
 */
export async function completeInvitationAcceptance(params: {
  userId: string;
  workspaceId: string;
  workspaceName: string;
  refreshAuth: () => Promise<unknown>;
  navigate: (opts: NavigateOptions) => Promise<void> | void;
}): Promise<void> {
  // Access tokens embed memberships at issue time, so refresh before AuthGuard
  // reads the accepted workspace.
  try {
    await params.refreshAuth();
  } catch {
    // Even if refresh fails the membership is real in the DB; surface the
    // success toast and let the user re-auth if their session has fully
    // expired. The next API call will redirect to login as usual.
  }
  rememberLastWorkspaceId(params.userId, params.workspaceId);
  toast.success(`You joined ${params.workspaceName}.`);
  await params.navigate({to: '/'});
}
