import {AUTH_USER} from '@shipfox/api-auth-context';
import {meResponseSchema} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {getCurrentUser} from '#core/auth.js';
import {UserNotFoundError} from '#core/errors.js';
import {getClientContext} from '#presentation/auth/jwt-auth.js';
import {toUserDto} from '#presentation/dto/user.js';

export const meRoute = defineRoute({
  method: 'GET',
  path: '/me',
  description: 'Get the signed-in user.',
  auth: AUTH_USER,
  schema: {
    response: {
      200: meResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof UserNotFoundError) {
      throw new ClientError('User not found', 'not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const client = getClientContext(request);
    if (!client) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const result = await getCurrentUser({userId: client.userId});

    return {user: toUserDto(result.user)};
  },
});
