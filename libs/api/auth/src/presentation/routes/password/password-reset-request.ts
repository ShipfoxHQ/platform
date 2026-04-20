import {passwordResetRequestBodySchema} from '@shipfox/api-auth-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {requestPasswordReset} from '#core/index.js';

export const passwordResetRequestRoute = defineRoute({
  method: 'POST',
  path: '/password-reset',
  description: 'Send a password reset email when an account is eligible.',
  schema: {
    body: passwordResetRequestBodySchema,
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const {email} = request.body;

    await requestPasswordReset({email});

    reply.code(204);
  },
});
