import {ApiError} from '@shipfox/client-api';
import {agentAccessErrorMessage, oauthConsentErrorMessage} from './errors.js';

describe('agent access error copy', () => {
  test.each([
    [
      'workspace-suspended',
      'This workspace is suspended. Restore it before changing agent access.',
    ],
    [
      'impersonation-not-permitted',
      'Personal access tokens cannot be created while impersonating another user.',
    ],
    [
      'auth-dependency-unavailable',
      'Agent access is temporarily unavailable. Try again in a moment.',
    ],
  ])('owns copy for %s', (code, expected) => {
    expect(agentAccessErrorMessage(new ApiError({code, message: 'Server copy', status: 409}))).toBe(
      expected,
    );
  });

  test('does not expose network request details', () => {
    const error = new ApiError({
      code: 'network-error',
      message: 'Failed to fetch https://api.example.test/agent-access/pats',
      status: 0,
    });

    expect(agentAccessErrorMessage(error)).toBe(
      "We couldn't reach the server. Check your connection and try again.",
    );
  });

  test('gives expired consent requests a recovery path', () => {
    const error = new ApiError({code: 'not-found', message: 'Not found', status: 404});
    expect(oauthConsentErrorMessage(error)).toContain('Return to the agent and start again.');
  });
});
