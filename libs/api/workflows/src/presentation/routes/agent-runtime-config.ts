import {
  agentRuntimeCredentialsResponseSchema,
  type MaterializedAgentStepConfigDto,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
import {
  type AgentInterModuleClient,
  agentInterModuleContract,
} from '@shipfox/api-agent-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import {agentRuntimeConfigQuerySchema} from '@shipfox/api-workflows-dto';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {captureException} from '@shipfox/node-error-monitoring';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {ZodError} from 'zod';
import {getStepAttemptDetail} from '#db/index.js';
import {loadRunningLeasedStep} from './leased-step.js';

export function createAgentRuntimeConfigRoute(params: {
  agent: AgentInterModuleClient;
  runners: RunnersInterModuleClient;
}) {
  return defineRoute({
    method: 'GET',
    path: '/agent-runtime-config',
    description:
      "Returns the resolved harness, provider, model, thinking effort, and decrypted provider credential bundle for the runner's currently leased running agent step. The job is identified by the lease token and the step is bound to that job before credentials are returned.",
    schema: {
      querystring: agentRuntimeConfigQuerySchema,
      response: {
        200: agentRuntimeCredentialsResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (
        isInterModuleKnownError(
          agentInterModuleContract.methods.resolveRuntimeCredentials,
          error,
        ) &&
        error.code === 'model-provider-credentials-invalid'
      ) {
        captureException(error);
        throw new ClientError(
          'Model provider credentials could not be decrypted',
          'model-provider-credentials-invalid',
          {
            status: 409,
            cause: error,
          },
        );
      }
      if (
        isInterModuleKnownError(
          agentInterModuleContract.methods.resolveRuntimeCredentials,
          error,
        ) &&
        error.code === 'model-provider-not-configured'
      ) {
        throw new ClientError(
          'Model provider credentials are not configured',
          'model-provider-not-configured',
          {
            status: 409,
          },
        );
      }
      if (
        isInterModuleKnownError(
          agentInterModuleContract.methods.resolveRuntimeCredentials,
          error,
        ) &&
        error.code === 'workspace-providers-disabled'
      ) {
        throw new ClientError(
          error.details.message ?? 'Workspace provider configuration is disabled',
          'workspace-providers-disabled',
          {
            status: 422,
            details: {
              managed_provider_id: error.details.managed_provider_id,
              ...(error.details.message === undefined ? {} : {message: error.details.message}),
            },
          },
        );
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {step_id: stepId, attempt} = request.query;
      const {step, workspaceId} = await loadRunningLeasedStep({
        runners: params.runners,
        request,
        stepId,
        attempt,
      });

      if (step.type !== 'agent') {
        throw new ClientError('Step is not an agent step', 'step-not-agent', {status: 409});
      }

      let agentConfig: MaterializedAgentStepConfigDto;
      try {
        agentConfig = materializedAgentStepConfigSchema.parse(step.config);
      } catch (error) {
        if (error instanceof ZodError) {
          throw new ClientError('Agent step config is invalid', 'agent-step-config-invalid', {
            status: 409,
            cause: error,
          });
        }
        throw error;
      }

      const stepAttempt = await getStepAttemptDetail({stepId, attempt});
      if (!stepAttempt) {
        throw new ClientError('Step attempt not found', 'step-attempt-not-found', {status: 409});
      }

      const runtimeConfig = await params.agent.resolveRuntimeCredentials({
        workspaceId,
        runId: stepAttempt.workflowRunId,
        stepAttemptId: stepAttempt.attempt.id,
        harness: agentConfig.harness,
        provider: agentConfig.provider,
        model: agentConfig.model,
        thinking: agentConfig.thinking,
      });

      reply.header('cache-control', 'no-store');
      return runtimeConfig;
    },
  });
}
