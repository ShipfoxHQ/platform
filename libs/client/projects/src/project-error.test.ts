import {ApiError} from '@shipfox/client-api';
import {projectErrorCopy} from './project-error.js';

function apiError(code: string, details?: unknown) {
  return new ApiError({
    code,
    status: 400,
    message: code,
    details: details === undefined ? {code} : {code, details},
  });
}

describe('projectErrorCopy', () => {
  test.each([
    ['repository-not-found', 'Repository not found'],
    ['access-denied', 'Repository access denied'],
    ['timeout', 'Provider timed out'],
    ['provider-unavailable', 'Provider unavailable'],
    ['malformed-provider-response', 'Provider response changed'],
    ['test-provider-disabled', 'Test provider disabled'],
  ])('maps %s', (code, title) => {
    const result = projectErrorCopy(apiError(code));

    expect(result.title).toBe(title);
    expect(result.message).not.toBe('');
  });

  test('includes retry-after copy for rate limits', () => {
    const result = projectErrorCopy(apiError('rate-limited', {retry_after_seconds: 60}));

    expect(result.title).toBe('Provider rate limited');
    expect(result.message).toContain('60 seconds');
  });

  test('surfaces duplicate project recovery id', () => {
    const result = projectErrorCopy(
      apiError('project-already-exists', {existing_project_id: 'project-1'}),
    );

    expect(result.title).toBe('Project already exists');
    expect(result.existingProjectId).toBe('project-1');
  });

  test('ignores malformed details payloads', () => {
    const result = projectErrorCopy(apiError('project-already-exists', 'bad-details'));

    expect(result.title).toBe('Project already exists');
    expect(result.existingProjectId).toBeUndefined();
  });

  test('maps network and unknown errors', () => {
    const network = projectErrorCopy(apiError('network-error'));
    const unknown = projectErrorCopy(new Error('boom'));

    expect(network.title).toBe('Network problem');
    expect(unknown.title).toBe('Something went wrong');
  });
});
