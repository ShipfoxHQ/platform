import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {
  createApiKey,
  getApiKeyByHashedKey,
  listApiKeysByWorkspaceId,
  revokeApiKey,
} from './api-keys.js';
import {createWorkspace} from './workspaces.js';

describe('api key queries', () => {
  let workspaceId: string;

  beforeEach(async () => {
    const workspace = await createWorkspace({name: `Key Test ${crypto.randomUUID()}`});
    workspaceId = workspace.id;
  });

  describe('createApiKey', () => {
    test('inserts an API key and returns entity', async () => {
      const rawKey = generateOpaqueToken('apiKey');

      const apiKey = await createApiKey({
        workspaceId,
        hashedKey: hashOpaqueToken(rawKey),
        prefix: extractDisplayPrefix(rawKey),
        scopes: ['read', 'write'],
      });

      expect(apiKey.id).toBeDefined();
      expect(apiKey.workspaceId).toBe(workspaceId);
      expect(apiKey.hashedKey).toBe(hashOpaqueToken(rawKey));
      expect(apiKey.prefix).toBe(extractDisplayPrefix(rawKey));
      expect(apiKey.scopes).toEqual(['read', 'write']);
      expect(apiKey.expiresAt).toBeNull();
      expect(apiKey.revokedAt).toBeNull();
      expect(apiKey.createdAt).toBeInstanceOf(Date);
    });

    test('inserts an API key with expiration', async () => {
      const rawKey = generateOpaqueToken('apiKey');
      const expiresAt = new Date(Date.now() + 3600_000);

      const apiKey = await createApiKey({
        workspaceId,
        hashedKey: hashOpaqueToken(rawKey),
        prefix: extractDisplayPrefix(rawKey),
        scopes: ['*'],
        expiresAt,
      });

      expect(apiKey.expiresAt).toBeInstanceOf(Date);
      expect(apiKey.expiresAt?.getTime()).toBe(expiresAt.getTime());
    });
  });

  describe('getApiKeyByHashedKey', () => {
    test('returns the API key when found', async () => {
      const rawKey = generateOpaqueToken('apiKey');
      const hashed = hashOpaqueToken(rawKey);
      await createApiKey({
        workspaceId,
        hashedKey: hashed,
        prefix: extractDisplayPrefix(rawKey),
        scopes: ['*'],
      });

      const found = await getApiKeyByHashedKey(hashed);

      expect(found).toBeDefined();
      expect(found?.hashedKey).toBe(hashed);
    });

    test('returns undefined for unknown hash', async () => {
      const found = await getApiKeyByHashedKey('nonexistent_hash');

      expect(found).toBeUndefined();
    });
  });

  describe('revokeApiKey', () => {
    test('sets revokedAt and updatedAt', async () => {
      const rawKey = generateOpaqueToken('apiKey');
      const created = await createApiKey({
        workspaceId,
        hashedKey: hashOpaqueToken(rawKey),
        prefix: extractDisplayPrefix(rawKey),
        scopes: ['*'],
      });

      const revoked = await revokeApiKey(created.id);

      expect(revoked).toBeDefined();
      expect(revoked?.revokedAt).toBeInstanceOf(Date);
      expect(revoked?.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
    });

    test('returns undefined for non-existent key', async () => {
      const result = await revokeApiKey(crypto.randomUUID());

      expect(result).toBeUndefined();
    });

    test('is idempotent on already-revoked key', async () => {
      const rawKey = generateOpaqueToken('apiKey');
      const created = await createApiKey({
        workspaceId,
        hashedKey: hashOpaqueToken(rawKey),
        prefix: extractDisplayPrefix(rawKey),
        scopes: ['*'],
      });

      const first = await revokeApiKey(created.id);
      const second = await revokeApiKey(created.id);

      expect(first?.revokedAt).toBeInstanceOf(Date);
      expect(second?.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('listApiKeysByWorkspaceId', () => {
    test('returns keys for a workspace', async () => {
      const rawKey1 = generateOpaqueToken('apiKey');
      const rawKey2 = generateOpaqueToken('apiKey');
      await createApiKey({
        workspaceId,
        hashedKey: hashOpaqueToken(rawKey1),
        prefix: extractDisplayPrefix(rawKey1),
        scopes: ['*'],
      });
      await createApiKey({
        workspaceId,
        hashedKey: hashOpaqueToken(rawKey2),
        prefix: extractDisplayPrefix(rawKey2),
        scopes: ['read'],
      });

      const keys = await listApiKeysByWorkspaceId(workspaceId);

      expect(keys).toHaveLength(2);
    });

    test('returns empty array when workspace has no keys', async () => {
      const keys = await listApiKeysByWorkspaceId(workspaceId);

      expect(keys).toEqual([]);
    });
  });
});
