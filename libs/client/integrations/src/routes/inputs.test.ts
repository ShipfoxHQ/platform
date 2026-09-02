import {connectionDetailsRouteParams} from './inputs.js';

describe('connectionDetailsRouteParams', () => {
  test('returns the validated workspace and connection slugs', () => {
    expect(
      connectionDetailsRouteParams({workspaceSlug: 'acme', connectionSlug: 'github_acme'}),
    ).toEqual({workspaceSlug: 'acme', connectionSlug: 'github_acme'});
  });

  test('rejects a route with a missing slug', () => {
    expect(() => connectionDetailsRouteParams({workspaceSlug: 'acme'})).toThrow(
      'Connection details route is missing required path parameters.',
    );
  });
});
