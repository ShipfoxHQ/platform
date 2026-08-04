import {ApiError} from '@shipfox/client-api';
import {classifyJiraCallbackError} from './jira-form-errors.js';

function apiError(code: string, status: number) {
  return new ApiError({code, status, message: `${code} server message`});
}

describe('classifyJiraCallbackError', () => {
  it.each([
    ['invalid-jira-install-state', 'Jira install link expired', true, false],
    ['jira-install-state-actor-mismatch', 'Different Shipfox account', true, true],
    ['unauthorized', 'Different Shipfox account', true, true],
    ['not-found', 'Workspace access changed', false, false],
    ['forbidden', 'Workspace access changed', false, false],
    ['workspace-inactive', 'Workspace access changed', false, false],
    ['jira-installation-already-linked', 'Jira already linked', false, false],
    ['jira-connection-already-linked', 'Jira already linked', false, false],
    ['jira-authorization-scope-mismatch', 'Jira permissions needed', true, false],
    ['jira-offline-access-not-granted', 'Jira permissions needed', true, false],
    ['jira-oauth-callback-error', 'Jira permissions needed', true, false],
    ['access-denied', 'Jira permissions needed', true, false],
    ['jira-site-selection-mismatch', 'Jira site selection expired', true, false],
    ['jira-pending-selection-not-found', 'Jira site selection expired', true, false],
    ['network-error', 'Could not reach Shipfox', true, false],
    ['rate-limited', 'Jira is temporarily unavailable', true, false],
    ['timeout', 'Jira is temporarily unavailable', true, false],
    ['provider-unavailable', 'Jira is temporarily unavailable', true, false],
    ['malformed-provider-response', 'Jira is temporarily unavailable', true, false],
    ['slug-conflict', 'Jira install could not be completed', true, false],
  ] as const)('maps %s without surfacing the server message', (code, title, startOver, signIn) => {
    const failure = classifyJiraCallbackError(apiError(code, 400));
    expect(failure).toMatchObject({
      title,
      startOver,
      signIn,
    });
    expect(failure.message).not.toContain('server message');
  });

  it('uses the generic recovery for unknown ApiError codes', () => {
    expect(classifyJiraCallbackError(apiError('unknown-error', 400))).toEqual({
      title: 'Jira install could not be completed',
      message: 'Could not complete the Jira install. Start again from workspace settings.',
      startOver: true,
      signIn: false,
    });
  });

  it('uses the generic recovery for unexpected errors', () => {
    expect(classifyJiraCallbackError(new Error('network down'))).toEqual({
      title: 'Jira install could not be completed',
      message: 'Could not complete the Jira install. Start again from workspace settings.',
      startOver: true,
      signIn: false,
    });
  });
});
