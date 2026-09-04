import {ApiError} from '@shipfox/client-api';
import {agentAccessErrorMessage, oauthConsentErrorMessage} from './errors.js';

describe('MCP connection error copy', () => {
  test.each([
    [
      'workspace-suspended',
      'This workspace is suspended. Restore it before managing MCP connections.',
    ],
    [
      'auth-dependency-unavailable',
      'MCP connections are temporarily unavailable. Try again in a moment.',
    ],
  ])('owns copy for %s', (code, expected) => {
    expect(agentAccessErrorMessage(new ApiError({code, message: 'Server copy', status: 409}))).toBe(
      expected,
    );
  });

  test('does not expose network request details', () => {
    const error = new ApiError({
      code: 'network-error',
      message: 'Failed to fetch https://api.example.test/agent-access/grants',
      status: 0,
    });

    expect(agentAccessErrorMessage(error)).toBe(
      "We couldn't reach the server. Check your connection and try again.",
    );
  });

  test.each([
    [
      'workspace-suspended',
      'This workspace is suspended. Restore it before approving this access request.',
    ],
    [
      'workspace-inactive',
      'This workspace is not active, so this access request cannot be approved.',
    ],
    ['forbidden', "You don't have permission to approve access to this workspace."],
    [
      'auth-dependency-unavailable',
      'This access request is temporarily unavailable. Try again in a moment.',
    ],
    [
      'not-found',
      'This access request expired or is no longer available. Return to the agent and start again.',
    ],
    ['invalid-request', 'This access request is invalid. Return to the agent and start again.'],
  ])('keeps consent copy contextual for %s', (code, expected) => {
    expect(
      oauthConsentErrorMessage(new ApiError({code, message: 'Server copy', status: 409})),
    ).toBe(expected);
  });
});
