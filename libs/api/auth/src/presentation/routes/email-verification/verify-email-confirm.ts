import {
  verifyEmailConfirmBodySchema,
  verifyEmailConfirmResponseSchema,
} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {TokenInvalidError} from '#core/errors.js';
import {confirmEmailVerification} from '#core/index.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/index.js';

export const verifyEmailConfirmRoute = defineRoute({
  method: 'POST',
  path: '/verify-email/confirm',
  description: 'Verify a user email address with the link sent by email.',
  schema: {
    body: verifyEmailConfirmBodySchema,
    response: {
      200: verifyEmailConfirmResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof TokenInvalidError) {
      throw new ClientError('Verification token is invalid or expired', 'token-invalid', {
        status: 410,
      });
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {token} = request.body;

    const result = await confirmEmailVerification({token});
    setRefreshTokenCookie(reply, result.refreshToken);

    return toAuthSessionDto(result);
  },
});
