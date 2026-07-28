import type {ProvisionerToken} from '#core/entities/provisioner-token.js';
import {installationProvisionerTokenStatus} from '#core/index.js';

export function toAdministratorProvisionerTokenDto(token: ProvisionerToken) {
  if (token.scope !== 'installation') {
    throw new Error('Workspace provisioner tokens cannot be returned from administrator routes');
  }

  return {
    id: token.id,
    scope: 'installation' as const,
    prefix: token.prefix,
    name: token.name,
    status: installationProvisionerTokenStatus(token),
    created_by_user_id: token.createdByUserId,
    revoked_by_user_id: token.revokedByUserId,
    expires_at: token.expiresAt?.toISOString() ?? null,
    revoked_at: token.revokedAt?.toISOString() ?? null,
    last_seen_at: token.lastSeenAt?.toISOString() ?? null,
    created_at: token.createdAt.toISOString(),
    updated_at: token.updatedAt.toISOString(),
  };
}
