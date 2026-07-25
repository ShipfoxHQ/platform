import {isAuthPath, resolveRedirectPath} from './components/redirect-target.js';

const INVITATION_ACCEPT_PATH = '/invitations/accept';

export interface RedirectContext {
  invitationToken?: string;
  returnTo?: string;
}

/**
 * Separates a safe post-authentication destination from an invitation token.
 * The token never remains in `returnTo`, so callers can keep it in their
 * short-lived invitation flow instead of forwarding it through generic redirects.
 */
export function parseRedirectContext(value: unknown): RedirectContext {
  const resolved = resolveRedirectPath(value);
  if (!resolved || isAuthPath(resolved.pathname)) return {};

  if (resolved.pathname !== INVITATION_ACCEPT_PATH) return {returnTo: resolved.redirect};

  const invitationToken = resolved.target.searchParams.get('token');
  return invitationToken ? {invitationToken} : {};
}
