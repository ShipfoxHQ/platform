import {signupBodySchema, signupResponseSchema} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {EmailTakenError} from '#core/errors.js';
import {signup} from '#core/index.js';
import {toUserDto} from '#presentation/dto/index.js';

export const signupRoute = defineRoute({
  method: 'POST',
  path: '/signup',
  description: 'Create a user account and send an email verification link.',
  schema: {
    body: signupBodySchema,
    response: {
      201: signupResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof EmailTakenError) {
      throw new ClientError('Email already registered', 'email-taken', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {email, password, name} = request.body;

    const user = await signup({email, password, name});

    reply.code(201);
    return {user: toUserDto(user)};
  },
});
