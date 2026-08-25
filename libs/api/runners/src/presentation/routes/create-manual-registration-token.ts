import {rejectImpersonatedSession} from '@shipfox/api-auth-context';
import {
  createManualRegistrationTokenBodySchema,
  createManualRegistrationTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createWorkspaceManualRegistrationToken} from '#core/index.js';
import {requireManualRegistrationTokenWorkspaceMembership} from './workspace-membership.js';

export const createManualRegistrationTokenRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a token that lets a runner connect to your account',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: createManualRegistrationTokenBodySchema,
    response: {
      201: createManualRegistrationTokenResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const {workspaceId} = request.params;
    rejectImpersonatedSession(request);
    requireManualRegistrationTokenWorkspaceMembership({request, workspaceId});
    const {name, ttl_seconds} = request.body;

    const {token, rawToken} = await createWorkspaceManualRegistrationToken({
      workspaceId,
      name,
      ttlSeconds: ttl_seconds,
    });

    reply.code(201);
    return {
      id: token.id,
      raw_token: rawToken,
      prefix: token.prefix,
      name: token.name,
      workspace_id: token.workspaceId,
      expires_at: token.expiresAt?.toISOString() ?? null,
      created_at: token.createdAt.toISOString(),
    };
  },
});
