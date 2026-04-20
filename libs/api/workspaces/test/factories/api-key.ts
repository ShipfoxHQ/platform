import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {Factory} from 'fishery';
import type {ApiKey} from '#core/entities/api-key.js';
import {createApiKey} from '#db/api-keys.js';

export const apiKeyFactory = Factory.define<ApiKey & {rawKey: string}>(({onCreate, params}) => {
  const rawKey = params.rawKey ?? generateOpaqueToken('apiKey');
  const hashedKeyValue = hashOpaqueToken(rawKey);
  const prefix = extractDisplayPrefix(rawKey);

  onCreate(async (apiKey) => {
    const created = await createApiKey({
      workspaceId: apiKey.workspaceId,
      hashedKey: apiKey.hashedKey,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt ?? undefined,
    });
    return {...created, rawKey};
  });

  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    hashedKey: hashedKeyValue,
    prefix,
    rawKey,
    scopes: ['*'],
    expiresAt: null,
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
});
