import {ApiError} from '@shipfox/client-api';
import {devRunErrorCopy} from './dev-runs.js';

function apiError(code: string, status: number, details: unknown = {}) {
  return new ApiError({
    message: `Server message for ${code}`,
    code,
    status,
    details: {message: `Server message for ${code}`, code, details},
  });
}

describe('devRunErrorCopy', () => {
  test.each([
    ['ref-invalid', 400],
    ['ref-not-found', 404],
    ['ref-moved', 409],
    ['file-not-found', 404],
    ['project-not-found', 404],
    ['invalid-workflow-definition', 422],
    ['content-too-large', 422],
    ['trigger-not-found', 422],
    ['replay-event-not-found', 404],
    ['replay-event-required', 422],
    ['replay-event-mismatch', 409],
    ['replay-event-unavailable', 410],
    ['inputs-not-allowed', 422],
    ['workflow-interpolation-unresolvable', 422],
    ['workspace-suspended', 409],
    ['source-unavailable', 502],
  ] as const)('translates %s into user-facing copy', (code, status) => {
    const copy = devRunErrorCopy(apiError(code, status));

    expect(copy.title.length).toBeGreaterThan(0);
    expect(copy.message.length).toBeGreaterThan(0);
    expect(copy.message).not.toContain('Server message');
  });

  test('includes the filter reason for trigger-filtered', () => {
    const copy = devRunErrorCopy(
      apiError('trigger-filtered', 409, {reason: 'condition path missing'}),
    );

    expect(copy.title).toBe('Trigger filter refused the event');
    expect(copy.message).toContain('condition path missing');
  });

  test('falls back to a generic reason message for trigger-filtered without details', () => {
    const copy = devRunErrorCopy(apiError('trigger-filtered', 409));

    expect(copy.message).toBe('The trigger filter did not match this event.');
  });

  test('translates network errors', () => {
    const copy = devRunErrorCopy(apiError('network-error', 0));

    expect(copy.title).toBe('Network problem');
  });

  test('never renders non-API errors directly and keeps a stable fallback title', () => {
    const copy = devRunErrorCopy(new Error('leaky internal detail'));
    const serverCopy = devRunErrorCopy(apiError('unexpected-code', 500));

    expect(copy.message).not.toContain('leaky internal detail');
    expect(copy.message).toBe('Try again in a moment.');
    // A structured server response keeps its message, under the stable title.
    expect(serverCopy.title).toBe('Could not start the run');
    expect(serverCopy.message).toBe('Server message for unexpected-code');
  });
});
