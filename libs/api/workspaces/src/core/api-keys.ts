import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {createApiKey, getApiKeyById, revokeApiKey} from '#db/api-keys.js';
import {getWorkspaceById} from '#db/workspaces.js';
import type {ApiKey} from './entities/api-key.js';
import {ApiKeyNotFoundError, WorkspaceNotFoundError} from './errors.js';

export interface CreateWorkspaceApiKeyResult {
  apiKey: ApiKey;
  rawKey: string;
}

export async function createWorkspaceApiKey(params: {
  workspaceId: string;
  scopes: string[];
  ttlSeconds?: number | undefined;
}): Promise<CreateWorkspaceApiKeyResult> {
  const workspace = await getWorkspaceById(params.workspaceId);
  if (!workspace) {
    throw new WorkspaceNotFoundError(params.workspaceId);
  }

  const rawKey = generateOpaqueToken('apiKey');
  const expiresAt = params.ttlSeconds ? new Date(Date.now() + params.ttlSeconds * 1000) : undefined;
  const apiKey = await createApiKey({
    workspaceId: params.workspaceId,
    hashedKey: hashOpaqueToken(rawKey),
    prefix: extractDisplayPrefix(rawKey),
    scopes: params.scopes,
    expiresAt,
  });

  return {apiKey, rawKey};
}

export async function revokeWorkspaceApiKey(params: {
  workspaceId: string;
  apiKeyId: string;
}): Promise<ApiKey> {
  const apiKey = await getApiKeyById(params.apiKeyId);
  if (!apiKey || apiKey.workspaceId !== params.workspaceId) {
    throw new ApiKeyNotFoundError(params.apiKeyId);
  }

  const revoked = await revokeApiKey(params.apiKeyId);
  if (!revoked) {
    throw new ApiKeyNotFoundError(params.apiKeyId);
  }

  return revoked;
}
