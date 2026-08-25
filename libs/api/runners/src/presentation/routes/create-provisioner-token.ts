import {
  rejectImpersonatedSession,
  requireUserContext,
  requireWorkspaceAccess,
} from '@shipfox/api-auth-context';
import {
  createProvisionerTokenBodySchema,
  createProvisionerTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {createWorkspaceProvisionerToken} from '#core/index.js';
import {toProvisionerTokenDto} from '#presentation/dto/index.js';

export const createProvisionerTokenRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a token that lets a provisioner connect to your account',
  schema: {
    params: z.object({workspaceId: z.string().uuid()}),
    body: createProvisionerTokenBodySchema,
    response: {
      201: createProvisionerTokenResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const {workspaceId} = request.params;
    rejectImpersonatedSession(request);
    requireWorkspaceAccess({request, workspaceId});
    const user = requireUserContext(request);
    const {name, ttl_seconds} = request.body;

    const {token, rawToken} = await createWorkspaceProvisionerToken({
      workspaceId,
      createdByUserId: user.userId,
      name,
      ttlSeconds: ttl_seconds,
    });

    reply.code(201);
    return {
      ...toProvisionerTokenDto(token),
      raw_token: rawToken,
    };
  },
});
