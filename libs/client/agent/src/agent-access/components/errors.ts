import {ApiError} from '@shipfox/client-api';

export function agentAccessErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  switch (error.code) {
    case 'network-error':
      return "We couldn't reach the server. Check your connection and try again.";
    case 'workspace-suspended':
      return 'This workspace is suspended. Restore it before changing agent access.';
    case 'workspace-inactive':
      return 'This workspace is not active, so its agent access cannot be changed.';
    case 'forbidden':
      return "You don't have permission to change agent access for this workspace.";
    case 'auth-dependency-unavailable':
      return 'Agent access is temporarily unavailable. Try again in a moment.';
    case 'impersonation-not-permitted':
      return 'Personal access tokens cannot be created while impersonating another user.';
    case 'not-found':
      return 'This credential no longer exists. Refresh the page to see the latest list.';
    default:
      return error.message;
  }
}

export function oauthConsentErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'not-found') {
    return 'This access request expired or is no longer available. Return to the agent and start again.';
  }
  if (error instanceof ApiError && error.code === 'invalid-request') {
    return 'This access request is invalid. Return to the agent and start again.';
  }
  return agentAccessErrorMessage(error);
}
