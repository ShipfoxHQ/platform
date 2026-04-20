import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {createApiKey} from './api-keys.js';
import {resolveApiKeyWithWorkspace} from './resolve-api-key.js';
import {createWorkspace, updateWorkspace} from './workspaces.js';

describe('resolveApiKeyWithWorkspace', () => {
  let workspaceId: string;

  beforeEach(async () => {
    const workspace = await createWorkspace({name: `Resolve Test ${crypto.randomUUID()}`});
    workspaceId = workspace.id;
  });

  test('returns both API key and workspace in a single query', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    const hashed = hashOpaqueToken(rawKey);
    await createApiKey({
      workspaceId,
      hashedKey: hashed,
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
    });

    const result = await resolveApiKeyWithWorkspace(hashed);

    expect(result).toBeDefined();
    expect(result?.apiKey.hashedKey).toBe(hashed);
    expect(result?.apiKey.workspaceId).toBe(workspaceId);
    expect(result?.workspace.id).toBe(workspaceId);
    expect(result?.workspace.name).toContain('Resolve Test');
  });

  test('returns undefined for unknown hash', async () => {
    const result = await resolveApiKeyWithWorkspace('nonexistent');

    expect(result).toBeUndefined();
  });

  test('returns result even when workspace is suspended', async () => {
    const rawKey = generateOpaqueToken('apiKey');
    const hashed = hashOpaqueToken(rawKey);
    await createApiKey({
      workspaceId,
      hashedKey: hashed,
      prefix: extractDisplayPrefix(rawKey),
      scopes: ['*'],
    });
    await updateWorkspace({id: workspaceId, status: 'suspended'});

    const result = await resolveApiKeyWithWorkspace(hashed);

    expect(result).toBeDefined();
    expect(result?.workspace.status).toBe('suspended');
  });
});
