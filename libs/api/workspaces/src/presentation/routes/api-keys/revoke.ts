import {revokeApiKeyResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {ApiKeyNotFoundError} from '#core/errors.js';
import {revokeWorkspaceApiKey} from '#core/index.js';
import {toApiKeyDto} from '#presentation/dto/index.js';

export const revokeApiKeyRoute = defineRoute({
  method: 'POST',
  path: '/:apiKeyId/revoke',
  description: 'Revoke an API key so it can no longer be used.',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
      apiKeyId: z.string().uuid(),
    }),
    response: {
      200: revokeApiKeyResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ApiKeyNotFoundError) {
      throw new ClientError('API key not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {workspaceId, apiKeyId} = request.params;

    const revoked = await revokeWorkspaceApiKey({workspaceId, apiKeyId});

    return toApiKeyDto(revoked);
  },
});
