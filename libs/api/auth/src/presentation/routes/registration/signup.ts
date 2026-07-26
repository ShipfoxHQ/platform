import {signupBodySchema, signupResponseSchema} from '@shipfox/api-auth-dto';
import {EmailChallengeError} from '@shipfox/api-email-challenges';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {signup, signupWithInvitation} from '#core/auth.js';
import {
  EmailTakenError,
  InvitationEmailMismatchError,
  SignupNotAllowedError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidError,
} from '#core/errors.js';
import {setRefreshTokenCookie} from '#presentation/auth/refresh-cookie.js';
import {toUserDto} from '#presentation/dto/user.js';

const SIGNUP_NOT_ALLOWED_MESSAGE_MAX_LENGTH = 500;

export function createSignupRoute(workspaces: WorkspacesInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/signup',
    description:
      'Create a user account. Sends a verification email unless an invitation token is supplied.',
    schema: {
      body: signupBodySchema,
      response: {
        201: signupResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof EmailChallengeError) {
        throw new ClientError(error.message, `email-challenge-${error.code}`, {
          status: error.code === 'limited' ? 429 : 400,
          ...(error.retryAt ? {details: {retry_at: error.retryAt.toISOString()}} : {}),
        });
      }
      if (error instanceof EmailTakenError) {
        throw new ClientError('Email already registered', 'email-taken', {status: 409});
      }
      if (error instanceof SignupNotAllowedError) {
        const message = error.message.slice(0, SIGNUP_NOT_ALLOWED_MESSAGE_MAX_LENGTH);
        throw new ClientError(message, 'signup-not-allowed', {
          status: 403,
          details: {message},
        });
      }
      if (error instanceof TokenInvalidError) {
        throw new ClientError('Invitation token is invalid', 'invitation-token-invalid', {
          status: 410,
        });
      }
      if (error instanceof TokenAlreadyUsedError) {
        throw new ClientError('Invitation has already been accepted', 'invitation-token-used', {
          status: 410,
        });
      }
      if (error instanceof TokenExpiredError) {
        throw new ClientError('Invitation has expired', 'invitation-token-expired', {
          status: 410,
        });
      }
      if (error instanceof InvitationEmailMismatchError) {
        throw new ClientError(
          'Signup email does not match the invitation',
          'invitation-email-mismatch',
          {status: 403},
        );
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {email, password, name, invitation_token} = request.body;

      if (invitation_token === undefined) {
        const result = await signup({email, password, name, sourceIp: request.ip});
        reply.code(201);
        return {
          user: toUserDto(result),
          email_challenge: {
            id: result.emailChallenge.id,
            next_resend_available_at: result.emailChallenge.nextResendAvailableAt.toISOString(),
          },
        };
      }

      const result = await signupWithInvitation({
        email,
        password,
        name,
        invitationToken: invitation_token,
        workspaces,
      });
      setRefreshTokenCookie(reply, result.refreshToken);
      reply.code(201);
      return {
        user: toUserDto(result.user),
        token: result.token,
        membership: result.membership
          ? {
              id: result.membership.id,
              user_id: result.membership.userId,
              workspace_id: result.membership.workspaceId,
            }
          : null,
        ...(result.acceptError ? {accept_error: result.acceptError} : {}),
      };
    },
  });
}
