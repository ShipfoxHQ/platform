import {
  agentSessionDescriptorSchema,
  materializedAgentStepConfigSchema,
} from '@shipfox/api-agent-dto';
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
import type {Step} from '#core/entities/step.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {
  InvalidJobRunnerLabelsError,
  WorkflowSourceSnapshotTooLargeError,
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
  getLatestRunAttempt,
  getLatestStepAttempt,
  getStepAttemptDetail,
  getStepById,
  getStepByIdForJobExecution,
  getWorkflowRunDetail,
  listStepAttemptIdsByJobId,
  listWorkflowRunJobSummaries,
  listWorkflowRuns,
} from '#db/index.js';
import {deliverEventToListener} from '#db/job-listener-events.js';
import {
  toRunDetailDto,
  toRunListItemDto,
  toStepAttemptDetailResponseDto,
} from '#presentation/dto/index.js';

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
  /**
   * Shared lease + running-agent-step resolution for the lease-authed
   * inter-module methods (`getLeasedAgentToolContext` and
   * `getLeasedAgentSessionContext`): verifies the runner lease, resolves the
   * step for the job execution, then validates the job scope, attempt, status,
   * and agent type in one canonical order. The two seams previously
   * copy-pasted this chain with diverging check orders (the tool method
   * resolved the job scope before the attempt/status checks, the session
   * method after), so the same underlying state surfaced different errors
   * depending on the method; a single helper keeps error codes and check
   * ordering from drifting.
   *
   * `loadRunningLeasedStep` (routes) deliberately keeps its own copy: it
   * returns the run scope (trigger reference/origin state), skips the
   * agent-type check, and speaks HTTP `ClientError`s instead of contract
   * known errors.
   */
  async function resolveLeasedAgentStep(resolution: {
    method:
      | typeof workflowsInterModuleContract.methods.getLeasedAgentToolContext
      | typeof workflowsInterModuleContract.methods.getLeasedAgentSessionContext;
    input: {
      jobId: string;
      jobExecutionId: string;
      runnerSessionId: string;
      stepId: string;
      attempt: number;
    };
  }): Promise<{
    step: Step;
    scope: NonNullable<Awaited<ReturnType<typeof getJobScope>>>;
  }> {
    const {active: leaseIsActive} = await params.runners.getLeaseState({
      jobId: resolution.input.jobId,
      jobExecutionId: resolution.input.jobExecutionId,
      runnerSessionId: resolution.input.runnerSessionId,
    });
    if (!leaseIsActive)
      throw createInterModuleKnownError(resolution.method, 'lease-not-active', {});

    const step = await getStepByIdForJobExecution({
      stepId: resolution.input.stepId,
      jobExecutionId: resolution.input.jobExecutionId,
    });
    if (!step) throw createInterModuleKnownError(resolution.method, 'step-not-found', {});

    const scope = await getJobScope(resolution.input.jobId);
    if (!scope) throw createInterModuleKnownError(resolution.method, 'job-not-found', {});
    if (step.currentAttempt !== resolution.input.attempt) {
      throw createInterModuleKnownError(resolution.method, 'step-attempt-mismatch', {});
    }
    if (step.status !== 'running')
      throw createInterModuleKnownError(resolution.method, 'step-not-running', {});
    if (step.type !== 'agent')
      throw createInterModuleKnownError(resolution.method, 'leased-step-not-agent', {});

    return {step, scope};
  }

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
    listWorkflowRuns: async (input) => {
      const result = await listWorkflowRuns({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        limit: input.limit,
        cursor: input.cursor
          ? {createdAt: new Date(input.cursor.createdAt), id: input.cursor.id}
          : undefined,
        filters: input.filters
          ? {
              status: input.filters.status,
              definitionId: input.filters.definitionId,
              triggerSource: input.filters.triggerSource,
              origin: input.filters.origin,
              createdFrom: input.filters.createdFrom
                ? new Date(input.filters.createdFrom)
                : undefined,
              createdTo: input.filters.createdTo ? new Date(input.filters.createdTo) : undefined,
            }
          : undefined,
        includeTotal: input.cursor === undefined,
      });
      const jobsByRun = await listWorkflowRunJobSummaries(
        result.runs.map((run) => ({id: run.id, currentAttempt: run.currentAttempt})),
      );

      return {
        runs: result.runs.map((run) => toRunListItemDto(run, jobsByRun.get(run.id))),
        nextCursor: result.nextCursor
          ? {createdAt: result.nextCursor.createdAt.toISOString(), id: result.nextCursor.id}
          : null,
        filteredTotalCount: result.filteredTotalCount,
      };
    },
    getWorkflowRunDetail: async (input) => {
      const detail = await getWorkflowRunDetail(
        input.workflowRunId,
        input.attempt,
        input.workspaceId,
      );
      return {run: detail ? toRunDetailDto(detail) : null};
    },
    getStepAttemptDetail: async (input) => {
      const detail = await getStepAttemptDetail({
        stepId: input.stepId,
        attempt: input.attempt,
        workspaceId: input.workspaceId,
      });
      return {
        detail: detail
          ? toStepAttemptDetailResponseDto(detail.step, detail.attempt, {
              workflowRunId: detail.workflowRunId,
              workflowRunAttempt: detail.workflowRunAttempt,
              jobId: detail.jobId,
              jobExecutionId: detail.jobExecutionId,
            })
          : null,
      };
    },
    getLatestRunAttempt: async (input) => ({
      attempt:
        (await getLatestRunAttempt({
          workflowRunId: input.workflowRunId,
          workspaceId: input.workspaceId,
        })) ?? null,
    }),
    getLatestStepAttempt: async (input) => ({
      attempt:
        (await getLatestStepAttempt({stepId: input.stepId, workspaceId: input.workspaceId})) ??
        null,
    }),
    getLeasedAgentToolContext: async (input) => {
      const method = workflowsInterModuleContract.methods.getLeasedAgentToolContext;
      const {step, scope} = await resolveLeasedAgentStep({method, input});

      const config = materializedAgentStepConfigSchema.safeParse(step.config);
      if (!config.success) {
        throw createInterModuleKnownError(method, 'agent-step-config-invalid', {});
      }
      return {workspaceId: scope.workspaceId, integrations: config.data.integrations ?? []};
    },
    getLeasedAgentSessionContext: async (input) => {
      const method = workflowsInterModuleContract.methods.getLeasedAgentSessionContext;
      const {scope} = await resolveLeasedAgentStep({method, input});

      const detail = await getStepAttemptDetail({stepId: input.stepId, attempt: input.attempt});
      if (!detail) throw createInterModuleKnownError(method, 'step-attempt-mismatch', {});

      // The dispatch integration records the resolved descriptor on the step
      // attempt's config; anything else is a recording we cannot trust.
      const recorded = detail.attempt.config?.session;
      if (recorded === undefined || recorded === null) {
        return {
          workspaceId: scope.workspaceId,
          projectId: scope.projectId,
          workflowRunAttemptId: detail.workflowRunAttemptId,
          stepAttemptId: detail.attempt.id,
          session: null,
        };
      }
      const parsed = agentSessionDescriptorSchema.safeParse(recorded);
      if (!parsed.success) {
        throw createInterModuleKnownError(method, 'step-session-config-invalid', {});
      }
      return {
        workspaceId: scope.workspaceId,
        projectId: scope.projectId,
        workflowRunAttemptId: detail.workflowRunAttemptId,
        stepAttemptId: detail.attempt.id,
        session: parsed.data,
      };
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
  if (error instanceof WorkflowSourceSnapshotTooLargeError) {
    return createInterModuleKnownError(method, 'source-snapshot-too-large', {
      limitBytes: error.limitBytes,
      measuredBytes: error.measuredBytes,
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
