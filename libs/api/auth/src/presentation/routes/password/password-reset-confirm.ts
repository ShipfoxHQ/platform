import {
  passwordResetConfirmBodySchema,
  passwordResetConfirmResponseSchema,
} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {TokenInvalidError} from '#core/errors.js';
import {confirmPasswordReset} from '#core/index.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/index.js';

export const passwordResetConfirmRoute = defineRoute({
  method: 'POST',
  path: '/password-reset/confirm',
  description: 'Set a new password using the link sent by email.',
  schema: {
    body: passwordResetConfirmBodySchema,
    response: {
      200: passwordResetConfirmResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof TokenInvalidError) {
      throw new ClientError('Reset token is invalid or expired', 'token-invalid', {status: 410});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {token, new_password} = request.body;

    const result = await confirmPasswordReset({token, newPassword: new_password});
    setRefreshTokenCookie(reply, result.refreshToken);

    return toAuthSessionDto(result);
  },
});
