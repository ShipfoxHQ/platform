import {AUTH_API_KEY, getApiKeyContext} from '@shipfox/api-auth-context';
import {
  createRunnerTokenBodySchema,
  createRunnerTokenResponseSchema,
} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {extractDisplayPrefix, generateOpaqueToken, hashOpaqueToken} from '@shipfox/node-tokens';
import {createRunnerToken} from '#db/runner-tokens.js';

export const createRunnerTokenRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a token that lets a runner connect to your account',
  auth: AUTH_API_KEY,
  schema: {
    body: createRunnerTokenBodySchema,
    response: {
      201: createRunnerTokenResponseSchema,
    },
  },
  handler: async (request, reply) => {
    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('API key context is missing', 'unauthorized', {status: 401});
    }

    const {name, ttl_seconds} = request.body;
    const rawToken = generateOpaqueToken('runnerToken');
    const expiresAt = ttl_seconds ? new Date(Date.now() + ttl_seconds * 1000) : undefined;

    const token = await createRunnerToken({
      workspaceId: apiKeyContext.workspaceId,
      hashedToken: hashOpaqueToken(rawToken),
      prefix: extractDisplayPrefix(rawToken),
      name,
      expiresAt,
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
