import {projectsInterModuleContract} from './inter-module.js';

describe('projectsInterModuleContract', () => {
  test('accepts a project lookup through the producer contract', () => {
    const projectId = '00000000-0000-4000-8000-000000000001';
    const result = projectsInterModuleContract.methods.getProjectById.output.parse({
      project: {
        id: projectId,
        workspaceId: '00000000-0000-4000-8000-000000000002',
        sourceConnectionId: '00000000-0000-4000-8000-000000000003',
        sourceExternalRepositoryId: 'shipfox/project',
        sourceRepositoryOwner: 'shipfox',
        sourceRepositoryName: 'project',
        sourceDefaultBranch: 'main',
        name: 'Project',
      },
    });

    expect(result.project?.id).toBe(projectId);
    expect(result.project?.sourceRepositoryOwner).toBe('shipfox');
    expect(result.project?.sourceRepositoryName).toBe('project');
    expect(result.project?.sourceDefaultBranch).toBe('main');
  });

  test('accepts source repository name lookup inputs', () => {
    const input = {
      workspaceId: '00000000-0000-4000-8000-000000000001',
      sourceConnectionId: '00000000-0000-4000-8000-000000000002',
      sourceRepositoryOwner: 'shipfox',
      sourceRepositoryName: 'project',
    };

    expect(
      projectsInterModuleContract.methods.findProjectBySourceRepositoryName.input.parse(input),
    ).toEqual(input);
  });

  test('accepts checkout targets addressed by project', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const projectId = '00000000-0000-4000-8000-000000000003';

    expect(
      projectsInterModuleContract.methods.resolveCheckoutTarget.input.parse({
        workspaceId,
        target: {project: projectId},
      }).target,
    ).toEqual({project: projectId});
  });

  test('accepts paginated workspace project source listings', () => {
    const workspaceId = '00000000-0000-4000-8000-000000000001';
    const cursor = {
      createdAt: '2026-08-05T12:00:00.000Z',
      id: '00000000-0000-4000-8000-000000000002',
    };

    expect(
      projectsInterModuleContract.methods.listProjectsByWorkspace.input.parse({
        workspaceId,
        limit: 100,
        cursor,
      }),
    ).toEqual({workspaceId, limit: 100, cursor});
  });

  test('accepts the catalog fields on workspace project listings', () => {
    const project = {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      sourceConnectionId: '00000000-0000-4000-8000-000000000003',
      sourceExternalRepositoryId: 'shipfox/project',
      sourceRepositoryOwner: 'shipfox',
      sourceRepositoryName: 'project',
      sourceDefaultBranch: 'main',
      name: 'Project',
      slug: 'project',
      createdAt: '2026-08-05T12:00:00.000Z',
      updatedAt: '2026-08-05T12:01:00.000Z',
    };

    expect(
      projectsInterModuleContract.methods.listProjectCatalogByWorkspace.output.parse({
        projects: [project],
        nextCursor: null,
      }),
    ).toEqual({projects: [project], nextCursor: null});
  });

  test('keeps the base workspace project listing shape compatible', () => {
    const project = {
      id: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      sourceConnectionId: '00000000-0000-4000-8000-000000000003',
      sourceExternalRepositoryId: 'shipfox/project',
      sourceRepositoryOwner: 'shipfox',
      sourceRepositoryName: 'project',
      sourceDefaultBranch: 'main',
      name: 'Project',
    };

    expect(
      projectsInterModuleContract.methods.listProjectsByWorkspace.output.parse({
        projects: [project],
        nextCursor: null,
      }),
    ).toEqual({projects: [project], nextCursor: null});
  });

  test('defines the checkout authorization failure', () => {
    const details = {};

    expect(
      projectsInterModuleContract.methods.resolveCheckoutTarget.errors[
        'checkout-repository-not-authorized'
      ].parse(details),
    ).toEqual(details);
  });

  test.each([
    ['project-not-found', {projectId: '00000000-0000-4000-8000-000000000001'}],
    [
      'project-workspace-mismatch',
      {
        projectId: '00000000-0000-4000-8000-000000000001',
        workspaceId: '00000000-0000-4000-8000-000000000002',
      },
    ],
  ] as const)('defines the %s failure', (code, details) => {
    const schema =
      projectsInterModuleContract.methods.requireProjectForWorkspace.errors[
        code as keyof typeof projectsInterModuleContract.methods.requireProjectForWorkspace.errors
      ];

    expect(schema.parse(details)).toEqual(details);
  });
});
