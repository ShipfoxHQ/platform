import {ApiError} from '@shipfox/client-api';

export function agentAccessErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  switch (error.code) {
    case 'network-error':
      return "We couldn't reach the server. Check your connection and try again.";
    case 'workspace-suspended':
      return 'This workspace is suspended. Restore it before managing MCP connections.';
    case 'workspace-inactive':
      return 'This workspace is not active, so its MCP connections cannot be changed.';
    case 'forbidden':
      return "You don't have permission to manage MCP connections for this workspace.";
    case 'auth-dependency-unavailable':
      return 'MCP connections are temporarily unavailable. Try again in a moment.';
    case 'not-found':
      return 'This connection no longer exists. Refresh the page to see the latest list.';
    default:
      return error.message;
  }
}

export function oauthConsentErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';

  switch (error.code) {
    case 'network-error':
      return "We couldn't reach the server. Check your connection and try again.";
    case 'workspace-suspended':
      return 'This workspace is suspended. Restore it before approving this access request.';
    case 'workspace-inactive':
      return 'This workspace is not active, so this access request cannot be approved.';
    case 'forbidden':
      return "You don't have permission to approve access to this workspace.";
    case 'auth-dependency-unavailable':
      return 'This access request is temporarily unavailable. Try again in a moment.';
    case 'not-found':
      return 'This access request expired or is no longer available. Return to the agent and start again.';
    case 'invalid-request':
      return 'This access request is invalid. Return to the agent and start again.';
    default:
      return error.message;
  }
}
