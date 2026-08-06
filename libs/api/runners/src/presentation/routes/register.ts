import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {registerRunnerBodySchema, registerRunnerResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  EmptyRunnerLabelsError,
  RegistrationTokenConsumedError,
  RegistrationTokenExpiredError,
  RunnerLabelsReservedError,
} from '#core/errors.js';
import {registerRunnerSession} from '#core/runner-sessions.js';
import {getRunnerContext} from '#presentation/auth/index.js';
import {createEphemeralRegisterRateLimitPreHandler} from './rate-limit.js';

export function createRegisterRoute(auth: AuthInterModuleClient) {
  return defineRoute({
    method: 'POST',
    path: '/register',
    description: 'Exchange a runner registration token for a runner session token',
    schema: {
      body: registerRunnerBodySchema,
      response: {
        200: registerRunnerResponseSchema,
      },
    },
    preHandler: createEphemeralRegisterRateLimitPreHandler(),
    errorHandler: (error, request) => {
      if (error instanceof RunnerLabelsReservedError) {
        throw new ClientError(error.message, 'runner-labels-reserved', {
          details: {labels: error.labels},
          status: 400,
        });
      }
      if (error instanceof EmptyRunnerLabelsError) {
        throw new ClientError(error.message, 'empty-runner-labels', {status: 400});
      }
      if (error instanceof RegistrationTokenConsumedError) {
        const runner = getRunnerContext(request);
        if (runner.kind === 'ephemeral') {
          request.log.warn(
            {
              ephemeralTokenId: error.ephemeralTokenId,
              provisionerId: runner.provisionerId,
            },
            'Ephemeral registration token reuse rejected',
          );
        }
        throw new ClientError(
          'Registration token has already been consumed',
          'registration-token-consumed',
          {
            status: 409,
          },
        );
      }
      if (error instanceof RegistrationTokenExpiredError) {
        throw new ClientError('Registration token has expired', 'registration-token-expired', {
          status: 401,
        });
      }
      throw error;
    },
    handler: async (request) => {
      const runner = getRunnerContext(request);
      const result = await registerRunnerSession({
        auth,
        credential:
          runner.kind === 'manual'
            ? {
                kind: 'manual',
                registrationTokenId: runner.registrationTokenId,
                workspaceId: runner.workspaceId,
              }
            : runner,
        labels: request.body.labels,
        toolCapabilities: request.body.capabilities ?? null,
      });

      return {
        session_token: result.sessionToken,
        session_id: result.session.id,
        mode: result.mode,
        max_claims: result.maxClaims,
      };
    },
  });
}
