import {materializedAgentStepConfigSchema} from '@shipfox/api-agent-dto';
import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import type {DefinitionsInterModuleClient} from '@shipfox/api-definitions-dto/inter-module';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {RunnersInterModuleClient} from '@shipfox/api-runners-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModuleKnownErrorFor,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {DEFAULT_HARNESS, harnessSchema} from '@shipfox/workflow-document';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {
  InvalidJobRunnerLabelsError,
  WorkspaceDeletedError,
  WorkspaceNotFoundError,
  WorkspaceSuspendedError,
} from '#core/errors.js';
import {
  AgentConfigUnresolvableError,
  AgentIntegrationMaterializationError,
  DefinitionNotFoundError,
  InterpolationUnresolvableError,
  ProjectMismatchError,
  runDevWorkflow,
  runWorkflow,
} from '#core/index.js';
import {resolveWorkflowRunTriggerReference} from '#core/resolve-trigger-reference.js';
import {assertWorkspaceAdmitsNewJobs} from '#core/workspace-admission.js';
import {
  getJobScope,
  getStepById,
  getStepByIdForJobExecution,
  listStepAttemptIdsByJobId,
} from '#db/index.js';
import {deliverEventToListener} from '#db/job-listener-events.js';

type WorkspaceAdmissionKnownError = InterModuleKnownErrorFor<
  typeof workflowsInterModuleContract.methods.deliverEventToJobListener
>;

export function createWorkflowsInterModulePresentation(params: {
  agent: AgentInterModuleClient;
  definitions: DefinitionsInterModuleClient;
  workspaces: WorkspacesInterModuleClient;
  secrets: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'>;
  runners: RunnersInterModuleClient;
  integrations: IntegrationsModuleClient;
  projects: ProjectsModuleClient;
}): InterModulePresentation<typeof workflowsInterModuleContract> {
  return defineInterModulePresentation(workflowsInterModuleContract, {
    startRunFromTrigger: async (input) => {
      try {
        await assertWorkspaceAdmitsNewJobs(params.workspaces, input.workspaceId);
        const run = await runWorkflow(
          params.definitions,
          {
            agent: params.agent,
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            definitionId: input.definitionId,
            triggerPayload: input.triggerPayload,
            triggerConnectionId: input.triggerConnectionId,
            inputs: input.inputs,
            triggerIdempotencyKey: input.idempotencyKey,
            integrations: params.integrations,
            projects: params.projects,
          },
          {secrets: params.secrets},
        );
        return {id: run.id, name: run.name};
      } catch (error) {
        throw toStartRunKnownError(error, input.definitionId);
      }
    },
    startDevRun: async (input) => {
      try {
        await assertWorkspaceAdmitsNewJobs(params.workspaces, input.workspaceId);
        const run = await runDevWorkflow(
          params.agent,
          {
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            workflowId: input.workflowId,
            model: input.model,
            sourceSnapshot: input.sourceSnapshot,
            devSource: {
              ...input.devSource,
              replayOfEventId: input.devSource.replayOfEventId ?? null,
            },
            triggerPayload: input.triggerPayload,
            triggerConnectionId: input.triggerConnectionId,
            inputs: input.inputs,
            integrations: params.integrations,
            projects: params.projects,
          },
          {secrets: params.secrets},
        );
        return {id: run.id, name: run.name};
      } catch (error) {
        throw toStartDevRunKnownError(error);
      }
    },
    resolveWorkflowRunTriggerReference: async (input) =>
      await resolveWorkflowRunTriggerReference({
        workspaceId: input.workspaceId,
        triggerConnectionId: input.triggerConnectionId,
        triggerPayload: input.triggerPayload,
        integrations: params.integrations,
        projects: params.projects,
      }),
    deliverEventToJobListener: async (input) => {
      const method = workflowsInterModuleContract.methods.deliverEventToJobListener;
      try {
        const scope = input.disposition === 'fire' ? await getJobScope(input.jobId) : undefined;
        if (scope) {
          await assertWorkspaceAdmitsNewJobs(params.workspaces, scope.workspaceId);
        }

        let triggerReference: WorkflowRunTriggerReference | null = null;
        if (input.triggerReference !== undefined) {
          triggerReference = input.triggerReference;
        } else if (scope) {
          triggerReference = await resolveWorkflowRunTriggerReference({
            workspaceId: scope.workspaceId,
            triggerConnectionId: input.triggerConnectionId,
            triggerPayload: {
              provider: input.provider,
              source: input.source,
              event: input.event,
              deliveryId: input.deliveryId,
              data: input.payload,
            },
            integrations: params.integrations,
            projects: params.projects,
          });
        }
        return await deliverEventToListener({
          ...input,
          triggerReference,
          receivedAt: new Date(input.receivedAt),
        });
      } catch (error) {
        const workspaceError = toWorkspaceAdmissionKnownError(method, error);
        if (workspaceError !== undefined) throw workspaceError;
        throw error;
      }
    },
    getStepLogContext: async ({stepId}) => {
      const step = await getStepById(stepId);
      const parsed = harnessSchema.safeParse(step?.config.harness);
      return {harness: parsed.success ? parsed.data : DEFAULT_HARNESS};
    },
    listJobStepAttempts: async ({jobId}) => {
      return {stepAttemptIds: await listStepAttemptIdsByJobId(jobId)};
    },
    getLeasedAgentToolContext: async (input) => {
      const method = workflowsInterModuleContract.methods.getLeasedAgentToolContext;
      const {active: leaseIsActive} = await params.runners.getLeaseState({
        jobId: input.jobId,
        jobExecutionId: input.jobExecutionId,
        runnerSessionId: input.runnerSessionId,
      });
      if (!leaseIsActive) throw createInterModuleKnownError(method, 'lease-not-active', {});

      const step = await getStepByIdForJobExecution({
        stepId: input.stepId,
        jobExecutionId: input.jobExecutionId,
      });
      if (!step) throw createInterModuleKnownError(method, 'step-not-found', {});

      const scope = await getJobScope(input.jobId);
      if (!scope) throw createInterModuleKnownError(method, 'job-not-found', {});
      if (step.currentAttempt !== input.attempt) {
        throw createInterModuleKnownError(method, 'step-attempt-mismatch', {});
      }
      if (step.status !== 'running')
        throw createInterModuleKnownError(method, 'step-not-running', {});
      if (step.type !== 'agent')
        throw createInterModuleKnownError(method, 'leased-step-not-agent', {});

      const config = materializedAgentStepConfigSchema.safeParse(step.config);
      if (!config.success) {
        throw createInterModuleKnownError(method, 'agent-step-config-invalid', {});
      }
      return {workspaceId: scope.workspaceId, integrations: config.data.integrations ?? []};
    },
  });
}

export function toStartRunKnownError(error: unknown, definitionId: string): unknown {
  const method = workflowsInterModuleContract.methods.startRunFromTrigger;
  const mapped = toRunCreationKnownError(method, error);
  if (mapped !== undefined) return mapped;
  if (error instanceof DefinitionNotFoundError) {
    return createInterModuleKnownError(method, 'definition-not-found', {definitionId});
  }
  if (error instanceof ProjectMismatchError) {
    return createInterModuleKnownError(method, 'project-mismatch', {});
  }
  return error;
}

export function toStartDevRunKnownError(error: unknown): unknown {
  return toRunCreationKnownError(workflowsInterModuleContract.methods.startDevRun, error) ?? error;
}

function toRunCreationKnownError(
  method:
    | typeof workflowsInterModuleContract.methods.startRunFromTrigger
    | typeof workflowsInterModuleContract.methods.startDevRun,
  error: unknown,
): unknown {
  const workspaceError = toWorkspaceAdmissionKnownError(method, error);
  if (workspaceError !== undefined) return workspaceError;
  if (error instanceof AgentConfigUnresolvableError) {
    return createInterModuleKnownError(method, 'agent-config-unresolvable', {
      definitionId: error.definitionId,
    });
  }
  if (error instanceof AgentIntegrationMaterializationError) {
    return createInterModuleKnownError(method, 'agent-integration-materialization-failed', {});
  }
  if (error instanceof InterpolationUnresolvableError) {
    return createInterModuleKnownError(method, 'interpolation-unresolvable', {
      definitionId: error.definitionId,
      field: error.field,
      source: error.source,
      ...(error.envKey === undefined ? {} : {envKey: error.envKey}),
    });
  }
  if (error instanceof InvalidJobRunnerLabelsError) {
    return createInterModuleKnownError(method, 'invalid-job-runner-labels', {
      labels: [...error.labels],
    });
  }
  return undefined;
}

function toWorkspaceAdmissionKnownError(
  method:
    | typeof workflowsInterModuleContract.methods.startRunFromTrigger
    | typeof workflowsInterModuleContract.methods.startDevRun
    | typeof workflowsInterModuleContract.methods.deliverEventToJobListener,
  error: unknown,
): WorkspaceAdmissionKnownError | undefined {
  if (error instanceof WorkspaceSuspendedError) {
    return createInterModuleKnownError(method, 'workspace-suspended', {
      workspaceId: error.workspaceId,
    });
  }
  if (error instanceof WorkspaceDeletedError) {
    return createInterModuleKnownError(method, 'workspace-deleted', {
      workspaceId: error.workspaceId,
    });
  }
  if (error instanceof WorkspaceNotFoundError) {
    return createInterModuleKnownError(method, 'workspace-not-found', {
      workspaceId: error.workspaceId,
    });
  }
  return undefined;
}
