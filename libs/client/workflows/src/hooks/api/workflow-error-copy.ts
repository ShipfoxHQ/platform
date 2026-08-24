import type {ApiError} from '@shipfox/client-api';

export interface WorkflowErrorCopy {
  title: string;
  message: string;
}

/**
 * Copy shared by the workflow definition listing and dev-run adapters.
 * Route-specific adapters keep their own codes and fallback titles.
 */
export function sharedWorkflowErrorCopy(error: ApiError): WorkflowErrorCopy | undefined {
  switch (error.code) {
    case 'network-error':
      return {
        title: 'Network problem',
        message: 'We could not reach the API. Check your connection and try again.',
      };
    case 'ref-invalid':
      return {
        title: 'Ref is not a branch or tag',
        message: 'Enter a branch or tag name in this repository.',
      };
    case 'ref-not-found':
      return {
        title: 'Ref not found',
        message: 'This branch or tag does not exist in the repository.',
      };
    case 'project-not-found':
      return {
        title: 'Project not found',
        message: 'This project does not exist, or you no longer have access to it.',
      };
    case 'forbidden':
      return {
        title: 'Access changed',
        message: 'You no longer have access to this workspace or project.',
      };
    case 'rate-limited':
      return {
        title: 'Provider rate limited',
        message: 'The provider is asking us to slow down. Try again shortly.',
      };
    case 'source-unavailable':
      return {
        title: 'Source repository unavailable',
        message: 'Shipfox could not read the repository right now. Try again in a moment.',
      };
    default:
      return undefined;
  }
}
