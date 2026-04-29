import {AUTH_USER} from '@shipfox/api-auth-context';
import {changePasswordBodySchema} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {changePassword} from '#core/auth.js';
import {InvalidCredentialsError, UserNotFoundError} from '#core/errors.js';
import {getClientContext} from '#presentation/auth/jwt-auth.js';
import {getRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';

export const changePasswordRoute = defineRoute({
  method: 'POST',
  path: '/change-password',
  description: 'Change the signed-in user password.',
  auth: AUTH_USER,
  schema: {
    body: changePasswordBodySchema,
    response: {
      204: z.void(),
    },
  },
  errorHandler: (error) => {
    if (error instanceof UserNotFoundError) {
      throw new ClientError('User not found', 'not-found', {status: 404});
    }
    if (error instanceof InvalidCredentialsError) {
      throw new ClientError('Invalid credentials', 'invalid-credentials', {status: 401});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const client = getClientContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    await changePassword({
      userId: client.userId,
      currentPassword: request.body.current_password,
      newPassword: request.body.new_password,
      refreshToken: getRefreshTokenCookie(request),
    });

    reply.code(204);
  },
});
