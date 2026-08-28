import type {AuthInterModuleClient} from '@shipfox/api-auth-dto/inter-module';
import {registerRunnerBodySchema, registerRunnerResponseSchema} from '@shipfox/api-runners-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  EmptyRunnerLabelsError,
  RunnerActivationTokenInvalidError,
  RunnerLabelsReservedError,
} from '#core/errors.js';
import {registerRunnerSession} from '#core/runner-sessions.js';
import {getRunnerContext} from '#presentation/auth/index.js';

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
    errorHandler: (error, _request) => {
      if (error instanceof RunnerLabelsReservedError) {
        throw new ClientError(error.message, 'runner-labels-reserved', {
          details: {labels: error.labels},
          status: 400,
        });
      }
      if (error instanceof EmptyRunnerLabelsError) {
        throw new ClientError(error.message, 'empty-runner-labels', {status: 400});
      }
      if (error instanceof RunnerActivationTokenInvalidError)
        throw new ClientError('Invalid runner registration token', 'unauthorized', {status: 401});
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
        lifecycleCapabilities: request.body.lifecycle_capabilities ?? null,
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
