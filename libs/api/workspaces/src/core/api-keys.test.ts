import {workspaceFactory} from '#test/index.js';
import {createWorkspaceApiKey, revokeWorkspaceApiKey} from './api-keys.js';
import {ApiKeyNotFoundError, WorkspaceNotFoundError} from './errors.js';

describe('api keys core', () => {
  test('createWorkspaceApiKey creates a raw key for an existing workspace', async () => {
    const workspace = await workspaceFactory.create();

    const result = await createWorkspaceApiKey({workspaceId: workspace.id, scopes: ['read']});

    expect(result.rawKey.startsWith('sf_k_')).toBe(true);
    expect(result.apiKey.workspaceId).toBe(workspace.id);
    expect(result.apiKey.scopes).toEqual(['read']);
    expect(result.apiKey.prefix).toBe(result.rawKey.slice(0, 12));
  });

  test('createWorkspaceApiKey rejects missing workspaces', async () => {
    const promise = createWorkspaceApiKey({workspaceId: crypto.randomUUID(), scopes: ['read']});

    await expect(promise).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  test('revokeWorkspaceApiKey revokes keys only within their workspace', async () => {
    const workspace = await workspaceFactory.create();
    const otherWorkspace = await workspaceFactory.create();
    const {apiKey} = await createWorkspaceApiKey({workspaceId: workspace.id, scopes: ['read']});

    const wrongWorkspace = revokeWorkspaceApiKey({
      workspaceId: otherWorkspace.id,
      apiKeyId: apiKey.id,
    });
    await expect(wrongWorkspace).rejects.toBeInstanceOf(ApiKeyNotFoundError);

    const revoked = await revokeWorkspaceApiKey({workspaceId: workspace.id, apiKeyId: apiKey.id});

    expect(revoked.revokedAt).toBeInstanceOf(Date);
  });
});
