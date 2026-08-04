import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  checkoutTokenParamsSchema,
  checkoutTokenQuerySchema,
  checkoutTokenResponseSchema,
} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createStepCheckoutSpec} from '#core/checkout.js';
import {CheckoutConfigInvalidError, CheckoutIntentUnresolvedError} from '#core/errors.js';
import {toCheckoutTokenDto} from '#presentation/dto/checkout-token.js';
import {loadRunningLeasedStep} from './leased-step.js';

export function createCheckoutTokenRoute(clients: {
  runners: RunnersInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}) {
  return defineRoute({
    method: 'POST',
    path: '/steps/:stepId/checkout-token',
    description:
      "Exchanges the runner's lease for short-lived checkout credentials for the currently running checkout step. The step id and attempt are checked against the lease and the server-frozen step config supplies the target, ref, permissions, and fetch depth.",
    schema: {
      params: checkoutTokenParamsSchema,
      querystring: checkoutTokenQuerySchema,
      response: {200: checkoutTokenResponseSchema},
    },
    errorHandler: (error) => {
      const known = isInterModuleKnownError(
        integrationsInterModuleContract.methods.createCheckoutSpec,
        error,
      )
        ? error
        : undefined;
      const targetError = isInterModuleKnownError(
        projectsInterModuleContract.methods.resolveCheckoutTarget,
        error,
      )
        ? error
        : undefined;
      if (error instanceof CheckoutIntentUnresolvedError)
        throw new ClientError(error.message, 'checkout-unavailable', {status: 404});
      if (error instanceof CheckoutConfigInvalidError)
        throw new ClientError('Checkout configuration is invalid', 'checkout-config-invalid', {
          status: 409,
        });
      if (targetError?.code === 'checkout-repository-not-authorized')
        throw new ClientError(
          'Checkout repository is not authorized for this workspace',
          'checkout-repository-not-authorized',
          {status: 404},
        );
      if (known?.code === 'connection-not-found')
        throw new ClientError(
          'Integration connection not found',
          'integration-connection-not-found',
          {
            status: 404,
          },
        );
      if (known?.code === 'connection-inactive')
        throw new ClientError(
          'Integration connection is not active',
          'integration-connection-inactive',
          {
            status: 422,
          },
        );
      if (known?.code === 'connection-workspace-mismatch')
        throw new ClientError(
          'Integration connection does not belong to this workspace',
          'forbidden',
          {status: 403},
        );
      if (known?.code === 'provider-unavailable')
        throw new ClientError(
          'Integration provider is unavailable',
          'integration-provider-unavailable',
          {
            status: 422,
          },
        );
      if (known?.code === 'capability-unavailable')
        throw new ClientError(
          'Integration capability is unavailable',
          'integration-capability-unavailable',
          {
            status: 422,
          },
        );
      if (known?.code === 'checkout-unsupported')
        throw new ClientError(
          'Integration checkout is unsupported',
          'integration-checkout-unsupported',
          {
            status: 422,
          },
        );
      if (known?.code === 'provider-failure') {
        const status =
          known.details.reason === 'rate-limited'
            ? 429
            : known.details.reason === 'timeout' || known.details.reason === 'provider-unavailable'
              ? 503
              : 422;
        throw new ClientError('Integration provider request failed', known.details.reason, {
          details: {retry_after_seconds: known.details.retryAfterSeconds},
          status,
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {stepId} = request.params;
      const {attempt} = request.query;
      const {step, workspaceId, projectId, triggerReference} = await loadRunningLeasedStep({
        runners: clients.runners,
        request,
        stepId,
        attempt,
      });

      if (step.type !== 'setup' && step.type !== 'checkout') {
        throw new ClientError('Step is not a checkout step', 'step-not-checkout', {status: 409});
      }

      const checkout = await createStepCheckoutSpec({
        step,
        workspaceId,
        projectId,
        triggerReference,
        integrations: clients.integrations,
        projects: clients.projects,
      });
      reply.header('cache-control', 'no-store');
      return toCheckoutTokenDto(checkout.spec, {
        fetchDepth: checkout.fetchDepth,
        persist: checkout.persistCredentials,
      });
    },
  });
}
