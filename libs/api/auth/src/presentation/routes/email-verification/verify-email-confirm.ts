import {
  verifyEmailConfirmBodySchema,
  verifyEmailConfirmResponseSchema,
} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {confirmEmailVerification} from '#core/auth.js';
import {TokenInvalidError} from '#core/errors.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/user.js';

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
