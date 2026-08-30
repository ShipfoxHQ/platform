import {verifyEmailResendBodySchema, verifyEmailResendResponseSchema} from '@shipfox/api-auth-dto';
import {EmailChallengeError} from '@shipfox/api-email-challenges';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {resendEmailVerification} from '#core/auth.js';
import {createAuthRateLimitPreHandler} from '#presentation/routes/rate-limit.js';

function emailChallengeStatus(code: EmailChallengeError['code']): 400 | 410 | 429 {
  if (code === 'limited') return 429;
  if (code === 'expired') return 410;
  return 400;
}

export const verifyEmailResendRoute = defineRoute({
  method: 'POST',
  path: '/verify-email/resend',
  description: 'Send a new email verification code if the account can be verified.',
  schema: {
    body: verifyEmailResendBodySchema,
    response: {
      200: verifyEmailResendResponseSchema,
    },
  },
  preHandler: createAuthRateLimitPreHandler('email-send'),
  errorHandler: (error) => {
    if (error instanceof EmailChallengeError) {
      throw new ClientError(error.message, `email-challenge-${error.code}`, {
        status: emailChallengeStatus(error.code),
        ...(error.retryAt ? {details: {retry_at: error.retryAt.toISOString()}} : {}),
      });
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {email, challenge_id} = request.body;

    const result = await resendEmailVerification({
      email,
      challengeId: challenge_id,
      sourceIp: request.ip,
    });

    reply.code(200).send({
      next_resend_available_at: result.nextResendAvailableAt.toISOString(),
    });
  },
});
