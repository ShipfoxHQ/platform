import {ApiError} from '@shipfox/client-api';

export interface JiraCallbackFailure {
  title: string;
  message: string;
  startOver: boolean;
  signIn: boolean;
}

export function classifyJiraCallbackError(error: unknown): JiraCallbackFailure {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'invalid-jira-install-state':
        return failure(
          'Jira install link expired',
          'Jira install link expired. Start again from workspace settings.',
          true,
        );
      case 'jira-install-state-actor-mismatch':
      case 'unauthorized':
        return {
          ...failure(
            'Different Shipfox account',
            'Different Shipfox account. Sign in with the account that started this install.',
            true,
          ),
          signIn: true,
        };
      case 'not-found':
      case 'forbidden':
      case 'workspace-inactive':
        return failure(
          'Workspace access changed',
          'You no longer have access to this workspace. Return to Shipfox to continue.',
          false,
        );
      case 'jira-installation-already-linked':
      case 'jira-connection-already-linked':
        return failure(
          'Jira already linked',
          'This Jira site is already linked to another workspace.',
          false,
        );
      case 'jira-authorization-scope-mismatch':
      case 'jira-offline-access-not-granted':
      case 'jira-oauth-callback-error':
      case 'access-denied':
        return failure(
          'Jira permissions needed',
          'Jira did not authorize the permissions Shipfox needs. Review the consent and start again.',
          true,
        );
      case 'jira-site-selection-mismatch':
      case 'jira-pending-selection-not-found':
        return failure(
          'Jira site selection expired',
          'This Jira site selection is no longer valid. Start the install again from workspace settings.',
          true,
        );
      case 'network-error':
        return failure('Could not reach Shipfox', 'Check your connection and start again.', true);
      case 'rate-limited':
      case 'timeout':
      case 'provider-unavailable':
      case 'malformed-provider-response':
        return failure(
          'Jira is temporarily unavailable',
          'Start a new install when Jira is available.',
          true,
        );
      case 'slug-conflict':
        return failure(
          'Jira install could not be completed',
          'Could not complete the Jira install. Start again from workspace settings.',
          true,
        );
      default:
        return fallback();
    }
  }
  return fallback();
}

function failure(title: string, message: string, startOver: boolean): JiraCallbackFailure {
  return {title, message, startOver, signIn: false};
}

function fallback(): JiraCallbackFailure {
  return failure(
    'Jira install could not be completed',
    'Could not complete the Jira install. Start again from workspace settings.',
    true,
  );
}
