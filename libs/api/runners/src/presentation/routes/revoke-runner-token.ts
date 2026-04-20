import {AUTH_API_KEY, getApiKeyContext} from '@shipfox/api-auth-context';
import {revokeRunnerTokenResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {revokeRunnerToken} from '#db/runner-tokens.js';
import {toRunnerTokenDto} from '#presentation/dto/index.js';

export const revokeRunnerTokenRoute = defineRoute({
  method: 'POST',
  path: '/:tokenId/revoke',
  description: 'Stop a runner token from being used to connect to your account',
  auth: AUTH_API_KEY,
  schema: {
    params: z.object({tokenId: z.string().uuid()}),
    response: {
      200: revokeRunnerTokenResponseSchema,
    },
  },
  handler: async (request) => {
    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('API key context is missing', 'unauthorized', {status: 401});
    }

    const revoked = await revokeRunnerToken({
      tokenId: request.params.tokenId,
      workspaceId: apiKeyContext.workspaceId,
    });
    if (!revoked) {
      throw new ClientError('Runner token not found', 'not-found', {status: 404});
    }

    return toRunnerTokenDto(revoked);
  },
});
