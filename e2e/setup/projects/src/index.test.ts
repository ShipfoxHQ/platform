import {E2eApiError} from '@shipfox/e2e-core';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const sourceConnectionId = '33333333-3333-4333-8333-333333333333';

describe('createProject', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test('posts to the projects E2E setup route', async () => {
    const requestJson = vi.fn().mockResolvedValue({
      id: projectId,
      workspace_id: workspaceId,
      name: 'E2E Project',
      source: {
        connection_id: sourceConnectionId,
        external_repository_id: 'e2e:project',
      },
      created_at: '2026-01-15T12:00:00.000Z',
      updated_at: '2026-01-15T12:00:00.000Z',
    });
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createProject: createProjectWithMock} = await import('./index.js');

    const result = await createProjectWithMock({workspaceId});

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/projects', {
      json: {
        workspace_id: workspaceId,
        name: 'E2E Project',
        slug: 'e2e-project-2',
        source_connection_id: undefined,
        source_external_repository_id: undefined,
      },
    });
    expect(result.id).toBe(projectId);
  });

  test('maps camelCase params to a snake_case body', async () => {
    const requestJson = vi.fn().mockResolvedValue({});
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createProject: createProjectWithMock} = await import('./index.js');

    await createProjectWithMock({
      workspaceId,
      name: 'Platform',
      sourceConnectionId,
      sourceExternalRepositoryId: 'e2e:platform',
    });

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/projects', {
      json: {
        workspace_id: workspaceId,
        name: 'Platform',
        slug: 'platform-2',
        source_connection_id: sourceConnectionId,
        source_external_repository_id: 'e2e:platform',
      },
    });
  });

  test('applies defaults', async () => {
    const requestJson = vi.fn().mockResolvedValue({});
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createProject: createProjectWithMock} = await import('./index.js');

    await createProjectWithMock({workspaceId});

    expect(requestJson).toHaveBeenCalledWith('post', '/__e2e/projects', {
      json: expect.objectContaining({
        name: 'E2E Project',
      }),
    });
  });

  test('bubbles request errors', async () => {
    const error = new E2eApiError({
      message: 'E2E API request failed',
      status: 409,
      details: {code: 'project-already-exists'},
    });
    const requestJson = vi.fn().mockRejectedValue(error);
    vi.doMock('@shipfox/e2e-core', () => ({requestJson}));
    const {createProject: createProjectWithMock} = await import('./index.js');

    const result = createProjectWithMock({workspaceId});

    await expect(result).rejects.toBe(error);
  });
});
