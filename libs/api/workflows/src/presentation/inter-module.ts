import type {AnnotationsInterModuleClient} from '@shipfox/annotations-dto/inter-module';
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
import {
  WORKFLOW_JOB_EXECUTION_SEQUENCE_MAX,
  WORKFLOW_RUN_ATTEMPT_MAX,
  WORKFLOW_RUN_JOB_POSITION_MAX,
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
  WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT,
  workflowDiagnosticFieldSchema,
} from '@shipfox/api-workflows-dto';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import type {WorkspacesInterModuleClient} from '@shipfox/api-workspaces-dto/inter-module';
import {
  createInterModuleKnownError,
  defineInterModulePresentation,
  type InterModuleKnownErrorFor,
  type InterModulePresentation,
} from '@shipfox/inter-module';
import {
  decodeNumberIdCursor,
  decodeStringIdCursor,
  encodeNumberIdCursor,
  encodeStringIdCursor,
} from '@shipfox/node-drizzle';
import {DEFAULT_HARNESS, harnessSchema} from '@shipfox/workflow-document';
import {z} from 'zod';
import type {Step} from '#core/entities/step.js';
import type {WorkflowRunTriggerReference} from '#core/entities/workflow-run.js';
import {
  InvalidJobRunnerLabelsError,
  WorkflowDiagnosticTooLargeError,
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
  getWorkflowJobDetail,
  getWorkflowJobExecutionContext,
  getWorkflowJobReadScope,
  getWorkflowRunAccessScopeById,
  getWorkflowRunAnnotationOrigins,
  getWorkflowRunAttemptIdForScope,
  getWorkflowRunDetail,
  getWorkflowRunOverview,
  getWorkflowRunSource,
  getWorkflowStepReadScope,
  listFailedStepAttempts,
  listRunAttemptsPage,
  listStepAttemptIdsByJobId,
  listWorkflowExecutionSteps,
  listWorkflowJobExecutionSummaries,
  listWorkflowRunJobExplanationsPage,
  listWorkflowRunJobSummaries,
  listWorkflowRunJobsPage,
  listWorkflowRuns,
  listWorkflowStepAttemptSummaries,
  workflowRunAnnotationOriginKey,
} from '#db/index.js';
import {deliverEventToListener} from '#db/job-listener-events.js';
import {
  toRunAttemptDto,
  toRunDetailDto,
  toRunListItemDto,
  toRunOverviewDto,
  toRunOverviewJobsPageDto,
  toStepAttemptDetailResponseDto,
  toWorkflowExecutionStepsResponseDto,
  toWorkflowJobDetailDto,
  toWorkflowJobExecutionContextResponseDto,
  toWorkflowJobExecutionSummariesResponseDto,
  toWorkflowRunAnnotationItemDto,
  toWorkflowRunJobExplanationDto,
  toWorkflowRunSourceResponseDto,
  toWorkflowStepAttemptSummariesResponseDto,
} from '#presentation/dto/index.js';

type WorkspaceAdmissionKnownError = InterModuleKnownErrorFor<
  typeof workflowsInterModuleContract.methods.deliverEventToJobListener
>;

const DECIMAL_CURSOR_VALUE = /^\d+$/;

export function createWorkflowsInterModulePresentation(params: {
  agent: AgentInterModuleClient;
  annotations?: AnnotationsInterModuleClient;
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
    getWorkflowRunOverview: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope) return null;

      const attempt = await resolveRunAttempt(scope, input.workspaceId, input.attempt);
      if (attempt === undefined) return null;

      const overview = await getWorkflowRunOverview({
        workflowRunId: scope.id,
        projectId: scope.projectId,
        attempt,
      });
      return overview ? toBoundedRunOverview(overview) : null;
    },
    listWorkflowRunAttempts: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope) return null;

      const page = await listRunAttemptsPage({
        workflowRunId: scope.id,
        projectId: scope.projectId,
        limit: input.limit,
        cursor: decodeNumberCursor(input.cursor),
      });
      if (!page) return null;

      return {
        items: page.attempts.map(toRunAttemptDto),
        nextCursor: page.nextCursor ? encodeNumberIdCursor(page.nextCursor) : null,
      };
    },
    listWorkflowRunJobs: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope) return null;

      const attempt = await resolveRunAttempt(scope, input.workspaceId, input.attempt);
      if (attempt === undefined) return null;

      const page = await listWorkflowRunJobsPage({
        workflowRunId: scope.id,
        projectId: scope.projectId,
        attempt,
        limit: input.limit,
        cursor: decodePositionCursor(input.cursor),
      });
      if (!page) return null;

      const response = toRunOverviewJobsPageDto(page);
      return {
        workflow_run_attempt: attempt,
        items: response.items,
        nextCursor: response.next_cursor,
        ...(response.total === undefined ? {} : {total: response.total}),
      };
    },
    getWorkflowJobDetail: async (input) => {
      const scope = await getAccessibleJobScope(input.workspaceId, input.jobId);
      if (!scope) return null;

      const detail = await getWorkflowJobDetail({
        jobId: input.jobId,
        executionId: input.executionId,
        scope,
      });
      return detail ? toWorkflowJobDetailDto(detail) : null;
    },
    listWorkflowJobExecutions: async (input) => {
      const scope = await getAccessibleJobScope(input.workspaceId, input.jobId);
      if (!scope) return null;

      const page = await listWorkflowJobExecutionSummaries({
        jobId: input.jobId,
        limit: input.limit,
        cursor: toExecutionCursor(
          decodeNumberCursor(input.cursor, WORKFLOW_JOB_EXECUTION_SEQUENCE_MAX),
        ),
        scope,
      });
      if (!page) return null;

      const response = toWorkflowJobExecutionSummariesResponseDto(page);
      return {
        items: response.items,
        nextCursor: response.next_cursor,
        ...(response.total === undefined ? {} : {total: response.total}),
      };
    },
    listWorkflowExecutionSteps: async (input) => {
      const scope = await getAccessibleJobScope(input.workspaceId, input.jobId);
      if (!scope) return null;

      const page = await listWorkflowExecutionSteps({
        jobId: input.jobId,
        executionId: input.executionId,
        limit: input.limit,
        cursor: decodePositionCursor(input.cursor),
        scope,
      });
      if (!page) return null;

      const response = toWorkflowExecutionStepsResponseDto(page);
      return {
        items: response.items,
        nextCursor: response.next_cursor,
        ...(response.total === undefined ? {} : {total: response.total}),
      };
    },
    listWorkflowStepAttempts: async (input) => {
      const scope = await getAccessibleStepScope(input.workspaceId, input.stepId);
      if (!scope) return null;

      const page = await listWorkflowStepAttemptSummaries({
        stepId: input.stepId,
        limit: input.limit,
        cursor: toStepAttemptCursor(decodeNumberCursor(input.cursor)),
        scope,
      });
      if (!page) return null;

      const response = toWorkflowStepAttemptSummariesResponseDto(page);
      return {
        items: response.items,
        nextCursor: response.next_cursor,
        ...(response.total === undefined ? {} : {total: response.total}),
      };
    },
    getWorkflowRunSource: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope) return null;

      const attempt = await resolveRunAttempt(scope, input.workspaceId, input.attempt);
      if (attempt === undefined) return null;

      const source = await getWorkflowRunSource({workflowRunId: scope.id, attempt});
      return source ? toWorkflowRunSourceResponseDto(source) : null;
    },
    getWorkflowJobExecutionContext: async (input) => {
      const scope = await getAccessibleJobScope(input.workspaceId, input.jobId);
      if (!scope) return null;

      const context = await getWorkflowJobExecutionContext({
        jobId: input.jobId,
        executionId: input.executionId,
        scope,
      });
      return context ? toWorkflowJobExecutionContextResponseDto(context) : null;
    },
    getWorkflowStepAttemptDetail: async (input) => {
      const scope = await getAccessibleStepScope(input.workspaceId, input.stepId);
      if (!scope) return null;

      const attempt =
        input.attempt ??
        (await getLatestStepAttempt({stepId: input.stepId, workspaceId: input.workspaceId}));
      if (attempt === undefined) return null;

      const detail = await getStepAttemptDetail({
        stepId: input.stepId,
        attempt,
        workspaceId: input.workspaceId,
      });
      if (!detail || detail.workflowRunId !== scope.workflowRunId) return null;

      return toStepAttemptDetailResponseDto(
        detail.step,
        detail.attempt,
        {
          workflowRunId: detail.workflowRunId,
          workflowRunAttempt: detail.workflowRunAttempt,
          jobId: detail.jobId,
          jobExecutionId: detail.jobExecutionId,
        },
        detail.diagnosticBytes,
      );
    },
    listWorkflowRunAnnotations: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope || !params.annotations) return null;

      const attempt = await resolveRunAttempt(scope, input.workspaceId, input.attempt);
      if (attempt === undefined) return null;
      const attemptId = await getWorkflowRunAttemptIdForScope({
        workflowRunId: scope.id,
        projectId: scope.projectId,
        workspaceId: input.workspaceId,
        attempt,
      });
      if (!attemptId) return null;

      const page = await params.annotations.listAnnotationsForRunAttempt({
        workspaceId: input.workspaceId,
        workflowRunId: scope.id,
        workflowRunAttempt: attempt,
        cursor: decodeNumberCursor(input.cursor),
        limit: input.limit,
      });
      const origins = await getWorkflowRunAnnotationOrigins({
        workspaceId: input.workspaceId,
        projectId: scope.projectId,
        workflowRunId: scope.id,
        attempt,
        origins: page.annotations.map((annotation) => ({
          jobId: annotation.job_id,
          jobExecutionId: annotation.job_execution_id,
          stepId: annotation.origin_step_id,
          stepAttempt: annotation.origin_step_attempt,
        })),
      });
      const originByKey = new Map(
        origins.map((origin) => [workflowRunAnnotationOriginKey(origin), origin]),
      );

      return {
        workflow_run_attempt: attempt,
        items: page.annotations.flatMap((annotation) => {
          const origin = originByKey.get(
            workflowRunAnnotationOriginKey({
              jobId: annotation.job_id,
              jobExecutionId: annotation.job_execution_id,
              stepId: annotation.origin_step_id,
              stepAttempt: annotation.origin_step_attempt,
            }),
          );
          return origin ? [toWorkflowRunAnnotationItemDto(annotation, origin)] : [];
        }),
        nextCursor: page.nextCursor ? encodeNumberIdCursor(page.nextCursor) : null,
      };
    },
    listWorkflowRunJobExplanations: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope) return null;

      const attempt = await resolveRunAttempt(scope, input.workspaceId, input.attempt);
      if (attempt === undefined) return null;
      const page = await listWorkflowRunJobExplanationsPage({
        workspaceId: input.workspaceId,
        projectId: scope.projectId,
        workflowRunId: scope.id,
        attempt,
        limit: input.limit,
        cursor: decodePositionCursor(input.cursor),
      });
      if (!page) return null;

      return {
        workflow_run_attempt: attempt,
        items: page.items.map(toWorkflowRunJobExplanationDto),
        nextCursor: page.nextCursor
          ? encodeStringIdCursor({value: String(page.nextCursor.position), id: page.nextCursor.id})
          : null,
      };
    },
    listFailedStepAttempts: async (input) => {
      const scope = await getAccessibleRunScope(input.workspaceId, input.workflowRunId);
      if (!scope) return null;

      const attempt = await resolveRunAttempt(scope, input.workspaceId, input.attempt);
      if (attempt === undefined) return null;
      const page = await listFailedStepAttempts({
        workspaceId: input.workspaceId,
        projectId: scope.projectId,
        workflowRunId: scope.id,
        attempt,
        limit: input.limit,
      });
      if (!page) return null;
      return {workflow_run_attempt: attempt, items: page.map(toFailedStepAttemptCoordinate)};
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
          ? toStepAttemptDetailResponseDto(
              detail.step,
              detail.attempt,
              {
                workflowRunId: detail.workflowRunId,
                workflowRunAttempt: detail.workflowRunAttempt,
                jobId: detail.jobId,
                jobExecutionId: detail.jobExecutionId,
              },
              detail.diagnosticBytes,
            )
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
      // attempt's config. The detail query projects it independently so a
      // legacy oversized config cannot make a valid resume session disappear.
      const recorded = detail.sessionDescriptor ?? detail.attempt.config?.session;
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

type WorkflowRunAccessScope = NonNullable<
  Awaited<ReturnType<typeof getWorkflowRunAccessScopeById>>
>;
type WorkflowJobReadScope = NonNullable<Awaited<ReturnType<typeof getWorkflowJobReadScope>>>;
type WorkflowStepReadScope = NonNullable<Awaited<ReturnType<typeof getWorkflowStepReadScope>>>;

async function getAccessibleRunScope(
  workspaceId: string,
  workflowRunId: string,
): Promise<WorkflowRunAccessScope | undefined> {
  const scope = await getWorkflowRunAccessScopeById(workflowRunId);
  return scope?.workspaceId === workspaceId ? scope : undefined;
}

async function getAccessibleJobScope(
  workspaceId: string,
  jobId: string,
): Promise<WorkflowJobReadScope | undefined> {
  const scope = await getWorkflowJobReadScope(jobId);
  if (!scope) return undefined;

  const run = await getWorkflowRunAccessScopeById(scope.workflowRunId);
  if (!run || run.workspaceId !== workspaceId || run.projectId !== scope.projectId)
    return undefined;
  return scope;
}

async function getAccessibleStepScope(
  workspaceId: string,
  stepId: string,
): Promise<WorkflowStepReadScope | undefined> {
  const scope = await getWorkflowStepReadScope(stepId);
  if (!scope) return undefined;

  const run = await getWorkflowRunAccessScopeById(scope.workflowRunId);
  if (!run || run.workspaceId !== workspaceId || run.projectId !== scope.projectId)
    return undefined;
  return scope;
}

async function resolveRunAttempt(
  scope: WorkflowRunAccessScope,
  workspaceId: string,
  attempt: number | undefined,
): Promise<number | undefined> {
  if (attempt !== undefined) return attempt;
  return await getLatestRunAttempt({workflowRunId: scope.id, workspaceId});
}

function toBoundedRunOverview(
  overview: Parameters<typeof toRunOverviewDto>[0],
): ReturnType<typeof toRunOverviewDto> {
  const initialResponse = toRunOverviewDto(overview);
  if (serializedByteLength(initialResponse) <= WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT) {
    return initialResponse;
  }

  let pageSize = WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT;
  while (true) {
    const response = toRunOverviewDto(overview, {forceLarge: true, largePageSize: pageSize});
    if (serializedByteLength(response) <= WORKFLOW_RUN_OVERVIEW_RESPONSE_BYTE_LIMIT)
      return response;
    if (pageSize === 1) throw new Error('Workflow run overview exceeds the response byte limit');
    pageSize = Math.max(1, Math.floor(pageSize / 2));
  }
}

function serializedByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

function decodeNumberCursor(
  cursor: string | undefined,
  maxValue = WORKFLOW_RUN_ATTEMPT_MAX,
): {value: number; id: string} | undefined {
  if (cursor === undefined) return undefined;
  const decoded = decodeNumberIdCursor(cursor);
  if (
    !decoded ||
    !isUuid(decoded.id) ||
    !Number.isSafeInteger(decoded.value) ||
    decoded.value < 1 ||
    decoded.value > maxValue
  ) {
    throw new Error('Invalid workflow read cursor');
  }
  return decoded;
}

function decodePositionCursor(
  cursor: string | undefined,
): {position: number; id: string} | undefined {
  if (cursor === undefined) return undefined;
  const decoded = decodeStringIdCursor(cursor);
  if (!decoded || !isUuid(decoded.id) || !DECIMAL_CURSOR_VALUE.test(decoded.value)) {
    throw new Error('Invalid workflow read cursor');
  }
  const position = Number(decoded.value);
  if (!Number.isSafeInteger(position) || position < 0 || position > WORKFLOW_RUN_JOB_POSITION_MAX) {
    throw new Error('Invalid workflow read cursor');
  }
  return {position, id: decoded.id};
}

function toExecutionCursor(
  cursor: {value: number; id: string} | undefined,
): {sequence: number; id: string} | undefined {
  return cursor ? {sequence: cursor.value, id: cursor.id} : undefined;
}

function toStepAttemptCursor(
  cursor: {value: number; id: string} | undefined,
): {attempt: number; id: string} | undefined {
  return cursor ? {attempt: cursor.value, id: cursor.id} : undefined;
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

function toFailedStepAttemptCoordinate(coordinate: {
  workflowRunId: string;
  workflowRunAttempt: number;
  jobId: string;
  jobExecutionId: string;
  stepId: string;
  stepAttemptId: string;
  stepAttempt: number;
}) {
  return {
    workflow_run_id: coordinate.workflowRunId,
    workflow_run_attempt: coordinate.workflowRunAttempt,
    job_id: coordinate.jobId,
    job_execution_id: coordinate.jobExecutionId,
    step_id: coordinate.stepId,
    step_attempt_id: coordinate.stepAttemptId,
    step_attempt: coordinate.stepAttempt,
  };
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
  if (error instanceof WorkflowDiagnosticTooLargeError) {
    const field = workflowDiagnosticFieldSchema.safeParse(error.field);
    if (!field.success) return undefined;
    return createInterModuleKnownError(method, 'diagnostic-too-large', {
      field: field.data,
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
