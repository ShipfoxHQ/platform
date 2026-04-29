import {AUTH_USER} from '@shipfox/api-auth-context';
import {
  type IntegrationCapabilityDto,
  type IntegrationConnectionLifecycleStatusDto,
  type IntegrationProviderKindDto,
  integrationConnectionDtoSchema,
} from '@shipfox/api-integration-core-dto';
import {createDebugConnectionBodySchema} from '@shipfox/api-integration-debug-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {defineRoute, type RouteGroup} from '@shipfox/node-fastify';

interface DebugConnectionRecord {
  id: string;
  workspaceId: string;
  provider: IntegrationProviderKindDto;
  externalAccountId: string;
  displayName: string;
  lifecycleStatus: IntegrationConnectionLifecycleStatusDto;
  capabilities: IntegrationCapabilityDto[];
  createdAt: Date;
  updatedAt: Date;
}

interface UpsertDebugConnectionInput {
  workspaceId: string;
  provider: 'debug';
  externalAccountId: 'debug';
  displayName: 'Debug Source Control';
  lifecycleStatus: 'active';
  capabilities: ['source_control'];
}

export interface CreateDebugIntegrationRoutesOptions {
  upsertIntegrationConnection: (
    input: UpsertDebugConnectionInput,
  ) => Promise<DebugConnectionRecord>;
}

function toIntegrationConnectionDto(connection: DebugConnectionRecord) {
  return {
    id: connection.id,
    workspace_id: connection.workspaceId,
    provider: connection.provider,
    external_account_id: connection.externalAccountId,
    display_name: connection.displayName,
    lifecycle_status: connection.lifecycleStatus,
    capabilities: connection.capabilities,
    created_at: connection.createdAt.toISOString(),
    updated_at: connection.updatedAt.toISOString(),
  };
}

export function createDebugIntegrationRoutes({
  upsertIntegrationConnection,
}: CreateDebugIntegrationRoutesOptions): RouteGroup {
  const createDebugConnectionRoute = defineRoute({
    method: 'POST',
    path: '/connections',
    auth: AUTH_USER,
    description: 'Create a workspace Debug source-control integration connection.',
    schema: {
      body: createDebugConnectionBodySchema,
      response: {
        201: integrationConnectionDtoSchema,
      },
    },
    handler: async (request, reply) => {
      const {workspace_id: workspaceId} = request.body;

      await requireMembership({request, workspaceId});
      const connection = await upsertIntegrationConnection({
        workspaceId,
        provider: 'debug',
        externalAccountId: 'debug',
        displayName: 'Debug Source Control',
        lifecycleStatus: 'active',
        capabilities: ['source_control'],
      });

      reply.status(201);
      return toIntegrationConnectionDto(connection);
    },
  });

  return {
    prefix: '/integrations/debug',
    routes: [createDebugConnectionRoute],
  };
}
