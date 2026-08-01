import {anchorPaths, validateRoutePathInvariants} from './anchor-paths.js';

describe('client route path invariants', () => {
  test('uses the registered prefix before each slug parameter', () => {
    expect(anchorPaths).toMatchObject({
      workspaceLayout: '/w/$workspaceSlug',
      projectLayout: '/w/$workspaceSlug/p/$projectSlug',
    });
    expect(() =>
      validateRoutePathInvariants('/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId'),
    ).not.toThrow();
  });

  test('rejects prefixes without a following dynamic segment', () => {
    expect(() => validateRoutePathInvariants('/w/reports')).toThrow(
      'uses prefix "w" without a dynamic parameter immediately after it',
    );
  });

  test('rejects slug parameters outside their registered prefix', () => {
    expect(() => validateRoutePathInvariants('/workspace/$workspaceSlug')).toThrow(
      'places slug parameter "workspaceSlug" outside prefix "w"',
    );
  });

  test('requires UUID parameters to follow a page segment', () => {
    expect(() => validateRoutePathInvariants('/w/$workspaceSlug/$projectId')).toThrow(
      'must place UUID parameter "projectId" after a page segment',
    );
  });

  test('rejects repeated slug parameters', () => {
    expect(() =>
      validateRoutePathInvariants('/w/$workspaceSlug/p/$projectSlug/w/$workspaceSlug'),
    ).toThrow('repeats slug parameter "workspaceSlug"');
  });

  test('requires workspace prefixes to precede project prefixes', () => {
    expect(() => validateRoutePathInvariants('/p/$projectSlug/w/$workspaceSlug/runs')).toThrow(
      'must place workspace prefix "w" before project prefix "p"',
    );
  });
});
