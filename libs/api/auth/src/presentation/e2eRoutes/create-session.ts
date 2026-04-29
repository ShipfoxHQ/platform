import {e2eCreateSessionBodySchema, e2eCreateSessionResponseSchema} from '@shipfox/api-auth-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createSessionForUser} from '#core/auth.js';
import {EmailNotVerifiedError, InvalidCredentialsError, UserNotFoundError} from '#core/errors.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toAuthSessionDto} from '#presentation/dto/user.js';

export const createE2eSessionRoute = defineRoute({
  method: 'POST',
  path: '/sessions',
  description: 'Create an authenticated browser session for E2E tests.',
  schema: {
    body: e2eCreateSessionBodySchema,
    response: {
      200: e2eCreateSessionResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof UserNotFoundError) {
      throw new ClientError('User not found', 'user-not-found', {status: 404});
    }
    if (error instanceof EmailNotVerifiedError) {
      throw new ClientError('Email not verified', 'email-not-verified', {status: 403});
    }
    if (error instanceof InvalidCredentialsError) {
      throw new ClientError('User is not active', 'user-inactive', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const result = await createSessionForUser({
      ...(request.body.user_id ? {userId: request.body.user_id} : {}),
      ...(request.body.email ? {email: request.body.email} : {}),
    });

    setRefreshTokenCookie(reply, result.refreshToken);
    return toAuthSessionDto(result);
  },
});
