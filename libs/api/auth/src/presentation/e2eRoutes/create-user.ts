import {e2eCreateUserBodySchema, e2eCreateUserResponseSchema} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createUser} from '#core/auth.js';
import {EmailTakenError} from '#core/errors.js';
import {toUserDto} from '#presentation/dto/user.js';

export const createE2eUserRoute = defineRoute({
  method: 'POST',
  path: '/users',
  description: 'Create a user for E2E tests.',
  schema: {
    body: e2eCreateUserBodySchema,
    response: {
      201: e2eCreateUserResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof EmailTakenError) {
      throw new ClientError('Email already registered', 'email-taken', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const user = await createUser({
      email: request.body.email,
      password: request.body.password,
      verified: request.body.verified,
      ...(request.body.name ? {name: request.body.name} : {}),
    });

    reply.code(201);
    return {
      user: toUserDto(user),
      email: user.email,
      password: request.body.password,
    };
  },
});
