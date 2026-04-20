import {createApiKeyBodySchema, createApiKeyResponseSchema} from '@shipfox/api-workspaces-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {WorkspaceNotFoundError} from '#core/errors.js';
import {createWorkspaceApiKey} from '#core/index.js';

export const createApiKeyRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create an API key for a workspace.',
  schema: {
    params: z.object({
      workspaceId: z.string().uuid(),
    }),
    body: createApiKeyBodySchema,
    response: {
      201: createApiKeyResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof WorkspaceNotFoundError) {
      throw new ClientError('Workspace not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {workspaceId} = request.params;
    const {scopes, ttl_seconds} = request.body;

    const {apiKey, rawKey} = await createWorkspaceApiKey({
      workspaceId,
      scopes,
      ttlSeconds: ttl_seconds,
    });

    reply.code(201);
    return {
      id: apiKey.id,
      raw_key: rawKey,
      prefix: apiKey.prefix,
      scopes: apiKey.scopes,
      expires_at: apiKey.expiresAt?.toISOString() ?? null,
      created_at: apiKey.createdAt.toISOString(),
    };
  },
});
