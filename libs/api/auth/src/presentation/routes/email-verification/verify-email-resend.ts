import {verifyEmailResendBodySchema} from '@shipfox/api-auth-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {resendEmailVerification} from '#core/index.js';

export const verifyEmailResendRoute = defineRoute({
  method: 'POST',
  path: '/verify-email/resend',
  description: 'Send a new email verification link if the account can be verified.',
  schema: {
    body: verifyEmailResendBodySchema,
    response: {
      204: z.void(),
    },
  },
  handler: async (request, reply) => {
    const {email} = request.body;

    await resendEmailVerification({email});

    reply.code(204);
  },
});
