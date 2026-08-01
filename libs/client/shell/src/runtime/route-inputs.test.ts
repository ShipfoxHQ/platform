import {parseWorkspaceParams, parseWorkspaceProjectParams} from './route-inputs.js';

describe('route input parsers', () => {
  it('drops missing and malformed workspace parameters', () => {
    expect(parseWorkspaceParams({workspaceSlug: 'workspace-1'})).toEqual({
      workspaceSlug: 'workspace-1',
    });
    expect(parseWorkspaceParams({workspaceSlug: ''})).toEqual({});
    expect(parseWorkspaceParams({workspaceSlug: ['workspace-1']})).toEqual({});
  });

  it('keeps valid workspace and project parameters independently', () => {
    expect(
      parseWorkspaceProjectParams({workspaceSlug: 'workspace-1', projectSlug: 'project-1'}),
    ).toEqual({
      workspaceSlug: 'workspace-1',
      projectSlug: 'project-1',
    });
    expect(parseWorkspaceProjectParams({workspaceSlug: 'workspace-1', projectSlug: null})).toEqual({
      workspaceSlug: 'workspace-1',
    });
  });
});
