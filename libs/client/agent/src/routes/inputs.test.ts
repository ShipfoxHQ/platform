import {modelProviderRouteParams} from './inputs.js';

describe('model provider route inputs', () => {
  it('requires a non-empty workspace slug', () => {
    expect(modelProviderRouteParams({workspaceSlug: 'workspace-1'})).toEqual({
      workspaceSlug: 'workspace-1',
    });
    expect(() => modelProviderRouteParams({workspaceSlug: ''})).toThrow(
      'Model provider route is missing the workspace path parameter.',
    );
    expect(() => modelProviderRouteParams({workspaceSlug: 42})).toThrow();
  });
});
