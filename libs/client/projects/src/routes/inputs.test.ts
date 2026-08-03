import {projectRouteParams} from './inputs.js';

describe('project route inputs', () => {
  it('requires both workspace and project slugs', () => {
    expect(projectRouteParams({workspaceSlug: 'workspace-1', projectSlug: 'project-1'})).toEqual({
      workspaceSlug: 'workspace-1',
      projectSlug: 'project-1',
    });
    expect(() => projectRouteParams({workspaceSlug: 'workspace-1'})).toThrow(
      'Project route is missing required path parameters.',
    );
    expect(() =>
      projectRouteParams({workspaceSlug: ['workspace-1'], projectSlug: 'project-1'}),
    ).toThrow();
  });
});
