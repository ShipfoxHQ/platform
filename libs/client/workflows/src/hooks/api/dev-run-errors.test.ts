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
    [
      'network-error',
      0,
      'Network problem',
      'We could not reach the API. Check your connection and try again.',
    ],
    [
      'ref-invalid',
      400,
      'Ref is not a branch or tag',
      'Enter a branch or tag name in this repository.',
    ],
    ['ref-not-found', 404, 'Ref not found', 'This branch or tag does not exist in the repository.'],
    [
      'ref-moved',
      409,
      'Ref moved',
      'The ref no longer points at the commit you selected. Confirm the new commit and try again.',
    ],
    [
      'file-not-found',
      404,
      'Workflow file not found',
      'This workflow file no longer exists at the ref.',
    ],
    [
      'project-not-found',
      404,
      'Project not found',
      'This project does not exist, or you no longer have access to it.',
    ],
    ['forbidden', 403, 'Access changed', 'You no longer have access to this workspace or project.'],
    [
      'rate-limited',
      429,
      'Provider rate limited',
      'The provider is asking us to slow down. Try again shortly.',
    ],
    [
      'invalid-workflow-definition',
      422,
      'Invalid workflow definition',
      'The workflow file at this ref did not validate. Fix the errors on the branch and try again.',
    ],
    [
      'content-too-large',
      422,
      'Workflow file too large',
      'The workflow file at this ref is too large to run.',
    ],
    [
      'trigger-not-found',
      422,
      'Trigger not found',
      'This workflow file does not declare the selected trigger.',
    ],
    [
      'replay-event-not-found',
      404,
      'Event not found',
      'This event is no longer available for replay.',
    ],
    [
      'replay-event-required',
      422,
      'Replay event required',
      'Pick a journaled event to replay for this trigger.',
    ],
    [
      'replay-event-mismatch',
      409,
      'Event does not match the trigger',
      'This event does not match the trigger source and event.',
    ],
    [
      'replay-event-unavailable',
      410,
      'Event no longer available',
      "This event's payload was pruned and cannot be replayed.",
    ],
    ['inputs-not-allowed', 422, 'Inputs not allowed', 'This trigger does not accept inputs.'],
    [
      'workflow-interpolation-unresolvable',
      422,
      'Workflow inputs unresolved',
      'The workflow references inputs that could not be resolved. Check the trigger inputs and try again.',
    ],
    [
      'workspace-suspended',
      409,
      'Workspace suspended',
      'Your workspace is suspended. Runs cannot start until it is active again.',
    ],
    [
      'source-unavailable',
      502,
      'Source repository unavailable',
      'Shipfox could not read the repository right now. Try again in a moment.',
    ],
  ] as const)('translates %s into the expected user-facing copy', (code, status, title, message) => {
    const copy = devRunErrorCopy(apiError(code, status));

    expect(copy).toEqual({title, message});
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
