import {rememberLastWorkspaceId} from '@shipfox/client-shell/runtime';
import {toast} from '@shipfox/react-ui/toast';
import type {NavigateOptions} from '@tanstack/react-router';

/**
 * Final step of every successful invitation accept path (existing-user match,
 * signup-with-invitation success, login-then-accept). Refreshes the auth
 * session so the JWT carries the new membership before navigating, then
 * routes the user into the workspace home when the refreshed session is ready.
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
}): Promise<boolean> {
  // Access tokens embed memberships at issue time, so refresh before AuthGuard
  // reads the accepted workspace.
  let refreshed = true;
  try {
    await params.refreshAuth();
  } catch {
    // The membership is real in the DB, but the root route cannot resolve the
    // joined workspace until the auth workspace list has been refreshed.
    refreshed = false;
  }
  rememberLastWorkspaceId(params.userId, params.workspaceId);
  toast.success(`You joined ${params.workspaceName}.`);
  if (refreshed) await params.navigate({to: '/'});
  return refreshed;
}
