import {logoutBodySchema} from '@shipfox/api-auth-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {logout} from '#core/auth.js';
import {clearRefreshTokenCookie, getRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';

export const logoutRoute = defineRoute({
  method: 'POST',
  path: '/logout',
  description: 'Sign out of the current session.',
  schema: {
    body: logoutBodySchema,
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    await logout({refreshToken: getRefreshTokenCookie(request)});
    clearRefreshTokenCookie(reply);

    reply.code(204);
  },
});
