import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
import {
  type IntegrationsModuleClient,
  integrationsInterModuleContract,
  repositoryAuthorizationErrorCodes,
} from '@shipfox/api-integration-core-dto/inter-module';
import {
  type ProjectsModuleClient,
  projectsInterModuleContract,
} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {
  checkoutTokenBodySchema,
  checkoutTokenParamsSchema,
  checkoutTokenQuerySchema,
  checkoutTokenResponseSchema,
} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createStepCheckoutSpec, renewStepCheckoutCredentials} from '#core/checkout.js';
import {warnRenewableGitCapabilityMismatchOnDispatch} from '#core/checkout-capability-warning.js';
import type {CheckoutRenewalSubject} from '#core/entities/checkout-renewal-subject.js';
import {
  CheckoutConfigInvalidError,
  CheckoutIntentUnresolvedError,
  CheckoutRepositoryUrlInvalidError,
} from '#core/errors.js';
import {savePendingCheckoutRenewalSubject} from '#db/checkout-renewal-subjects.js';
import {recordWorkflowCheckoutTokenRequest} from '#metrics/instance.js';
import {toCheckoutTokenDto, toCheckoutTokenRenewalDto} from '#presentation/dto/checkout-token.js';
import {
  assertLeasedJobActive,
  type LoadedRunningLeasedStep,
  loadRunningLeasedStep,
} from './leased-step.js';

export function createCheckoutTokenRoute(clients: {
  annotations: AnnotationsInterModuleClient;
  runners: RunnersInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}) {
  return defineRoute({
    method: 'POST',
    path: '/steps/:stepId/checkout-token',
    description:
      "Exchanges the runner's lease for short-lived checkout credentials for a current checkout step or a successful persisted checkout attempt. The step id and attempt are checked against the lease and all repository scope is supplied by server-owned state; a renewal may report only the rejected credential generation.",
    schema: {
      params: checkoutTokenParamsSchema,
      querystring: checkoutTokenQuerySchema,
      body: checkoutTokenBodySchema.nullish(),
      response: {200: checkoutTokenResponseSchema},
    },
    errorHandler: handleCheckoutTokenError,
    handler: async (request, reply) => {
      const hasRejectedGeneration = request.body?.rejected_generation !== undefined;
      let mode: 'initial' | 'renewal' = 'initial';
      try {
        const {stepId} = request.params;
        const {attempt} = request.query;
        const loaded = await loadRunningLeasedStep({
          runners: clients.runners,
          request,
          stepId,
          attempt,
          allowSuccessfulPersistedCheckout: true,
        });

        mode = loaded.checkoutRenewalSubject === undefined ? 'initial' : 'renewal';

        if (loaded.step.type !== 'setup' && loaded.step.type !== 'checkout') {
          throw new ClientError('Step is not a checkout step', 'step-not-checkout', {status: 409});
        }
        if (hasRejectedGeneration && loaded.checkoutRenewalSubject === undefined) {
          throw new ClientError(
            'Checkout credentials cannot be renewed until the checkout step succeeds',
            'checkout-renewal-unavailable',
            {status: 409},
          );
        }

        const response = await createCheckoutTokenResponse({
          clients,
          loaded,
          stepId,
          attempt,
          rejectedGeneration: request.body?.rejected_generation,
          warn: (context, message) => request.log.warn(context, message),
          error: (context, message) => request.log.error(context, message),
        });
        if (response.auth?.persist === true) {
          await warnRenewableGitCapabilityMismatchOnDispatch({
            annotations: clients.annotations,
            runners: clients.runners,
            leaseIdentity: loaded.leasedJob,
            step: loaded.step,
          });
        }
        recordWorkflowCheckoutTokenRequest(mode, 'success');
        reply.header('cache-control', 'no-store');
        return response;
      } catch (error) {
        recordWorkflowCheckoutTokenRequest(mode, 'failure');
        throw error;
      }
    },
  });
}

async function createCheckoutTokenResponse(params: {
  clients: Parameters<typeof createCheckoutTokenRoute>[0];
  loaded: LoadedRunningLeasedStep;
  stepId: string;
  attempt: number;
  rejectedGeneration?: string | undefined;
  warn: (context: {outcome: string}, message: string) => void;
  error: (context: {outcome: string}, message: string) => void;
}): Promise<ReturnType<typeof toCheckoutTokenDto>> {
  await assertLeasedJobActive(params.clients.runners, params.loaded.leasedJob);

  if (params.loaded.checkoutRenewalSubject !== undefined) {
    const credentials = await renewStepCheckoutCredentials({
      integrations: params.clients.integrations,
      workspaceId: params.loaded.workspaceId,
      subject: params.loaded.checkoutRenewalSubject,
      ...(params.rejectedGeneration === undefined
        ? {}
        : {rejectedGeneration: params.rejectedGeneration}),
    });
    await assertLeasedJobActive(params.clients.runners, params.loaded.leasedJob);
    return toCheckoutTokenRenewalDto(
      params.loaded.checkoutRenewalSubject.repositoryUrl,
      credentials,
    );
  }

  const checkout = await createStepCheckoutSpec({
    step: params.loaded.step,
    workspaceId: params.loaded.workspaceId,
    projectId: params.loaded.projectId,
    triggerReference: params.loaded.triggerReference,
    run: params.loaded.run,
    integrations: params.clients.integrations,
    projects: params.clients.projects,
  });
  await assertLeasedJobActive(params.clients.runners, params.loaded.leasedJob);
  const response = toCheckoutTokenDto(checkout.spec, {
    fetchDepth: checkout.fetchDepth,
    persist: checkout.persistCredentials,
  });
  if (checkout.renewalSubject !== undefined) {
    const subjectSaved = await persistCheckoutRenewalSubject({
      renewalSubject: checkout.renewalSubject,
      stepId: params.stepId,
      attempt: params.attempt,
      jobExecutionId: params.loaded.step.jobExecutionId,
      workflowRunAttemptId: params.loaded.leasedJob.workflowRunAttemptId,
      warn: params.warn,
      error: params.error,
    });
    if (!subjectSaved && response.auth !== undefined) response.auth.persist = false;
  }
  return response;
}

async function persistCheckoutRenewalSubject(params: {
  renewalSubject: Omit<CheckoutRenewalSubject, 'stepId' | 'attempt'>;
  stepId: string;
  attempt: number;
  jobExecutionId: string;
  workflowRunAttemptId: string;
  warn: (context: {outcome: string}, message: string) => void;
  error: (context: {outcome: string}, message: string) => void;
}): Promise<boolean> {
  try {
    const subjectSaved = await savePendingCheckoutRenewalSubject({
      ...params.renewalSubject,
      stepId: params.stepId,
      attempt: params.attempt,
      jobExecutionId: params.jobExecutionId,
      workflowRunAttemptId: params.workflowRunAttemptId,
    });
    if (subjectSaved) return true;
    params.warn(
      {outcome: 'checkout-renewal-subject-not-saved'},
      'Checkout credentials will not be persisted',
    );
    return false;
  } catch (error) {
    params.error(
      {outcome: 'checkout-renewal-subject-save-failed'},
      'Checkout renewal subject could not be saved',
    );
    captureException(error);
    return false;
  }
}

function handleCheckoutTokenError(error: unknown): never {
  if (error instanceof CheckoutIntentUnresolvedError) {
    throw new ClientError(error.message, 'checkout-unavailable', {status: 404});
  }
  if (error instanceof CheckoutRepositoryUrlInvalidError) {
    throw new ClientError('Checkout repository URL is invalid', 'checkout-repository-url-invalid', {
      status: 422,
      cause: error,
    });
  }
  if (error instanceof CheckoutConfigInvalidError) {
    throw new ClientError('Checkout configuration is invalid', 'checkout-config-invalid', {
      status: 409,
    });
  }
  if (
    isInterModuleKnownError(projectsInterModuleContract.methods.resolveCheckoutTarget, error) &&
    error.code === 'checkout-repository-not-authorized'
  ) {
    throw new ClientError(
      'Checkout repository is not authorized for this workspace',
      'checkout-repository-not-authorized',
      {status: 404},
    );
  }
  if (
    isInterModuleKnownError(integrationsInterModuleContract.methods.createCheckoutSpec, error) ||
    isInterModuleKnownError(
      integrationsInterModuleContract.methods.createCheckoutCredentials,
      error,
    )
  ) {
    throwIntegrationCheckoutError(error as {code: string});
  }
  throw error;
}

function throwIntegrationCheckoutError(
  error: Parameters<typeof handleCheckoutTokenError>[0] & {code: string},
): never {
  switch (error.code) {
    case 'connection-not-found':
      throw new ClientError(
        'Integration connection not found',
        'integration-connection-not-found',
        {status: 404},
      );
    case 'connection-inactive':
      throw new ClientError(
        'Integration connection is not active',
        'integration-connection-inactive',
        {status: 422},
      );
    case 'connection-workspace-mismatch':
      throw new ClientError(
        'Integration connection does not belong to this workspace',
        'forbidden',
        {status: 403},
      );
    case 'provider-unavailable':
      throw new ClientError(
        'Integration provider is unavailable',
        'integration-provider-unavailable',
        {status: 422},
      );
    case 'capability-unavailable':
      throw new ClientError(
        'Integration capability is unavailable',
        'integration-capability-unavailable',
        {status: 422},
      );
    case 'checkout-unsupported':
      throw new ClientError(
        'Integration checkout is unsupported',
        'integration-checkout-unsupported',
        {status: 422},
      );
    case 'provider-failure': {
      const details = (
        error as unknown as {
          details: {reason: string; retryAfterSeconds?: number};
        }
      ).details;
      throw new ClientError('Integration provider request failed', details.reason, {
        details: {retry_after_seconds: details.retryAfterSeconds},
        status: providerFailureStatus(details.reason),
      });
    }
    case repositoryAuthorizationErrorCodes.notGranted:
      throw new ClientError(
        'Checkout repository is not authorized for this workspace',
        repositoryAuthorizationErrorCodes.notGranted,
        {status: 404},
      );
    case repositoryAuthorizationErrorCodes.ambiguous:
      throw new ClientError(
        'Checkout repository target is ambiguous',
        repositoryAuthorizationErrorCodes.ambiguous,
        {status: 409},
      );
    case repositoryAuthorizationErrorCodes.storeUnavailable:
      throw new ClientError(
        'Repository authorization is unavailable',
        repositoryAuthorizationErrorCodes.storeUnavailable,
        {status: 503},
      );
    case repositoryAuthorizationErrorCodes.targetInvalid:
      throw new ClientError(
        'Checkout repository target is invalid',
        repositoryAuthorizationErrorCodes.targetInvalid,
        {status: 409},
      );
    default:
      throw error;
  }
}

function providerFailureStatus(reason: string): 422 | 429 | 503 {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}
