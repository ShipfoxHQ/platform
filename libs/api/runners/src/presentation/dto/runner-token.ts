import type {RunnerToken} from '#core/entities/runner-token.js';

export function toRunnerTokenDto(token: RunnerToken): {
  id: string;
  workspace_id: string;
  prefix: string;
  name: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: token.id,
    workspace_id: token.workspaceId,
    prefix: token.prefix,
    name: token.name,
    expires_at: token.expiresAt?.toISOString() ?? null,
    revoked_at: token.revokedAt?.toISOString() ?? null,
    created_at: token.createdAt.toISOString(),
    updated_at: token.updatedAt.toISOString(),
  };
}
