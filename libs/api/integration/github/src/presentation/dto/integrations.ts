import type {IntegrationConnection} from '#core/contracts.js';

export function toIntegrationConnectionDto(connection: IntegrationConnection) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities: ['source_control'],
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}
