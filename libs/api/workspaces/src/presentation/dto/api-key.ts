import type {ApiKeyDto} from '@shipfox/api-workspaces-dto';
import type {ApiKey} from '#core/entities/api-key.js';

export function toApiKeyDto(apiKey: ApiKey): ApiKeyDto {
  return {
    id: apiKey.id,
    workspace_id: apiKey.workspaceId,
    prefix: apiKey.prefix,
    scopes: apiKey.scopes,
    expires_at: apiKey.expiresAt?.toISOString() ?? null,
    revoked_at: apiKey.revokedAt?.toISOString() ?? null,
    created_at: apiKey.createdAt.toISOString(),
    updated_at: apiKey.updatedAt.toISOString(),
  };
}
