import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {readPersistedWorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  WORKFLOWS_JOB_ACTIVATED,
  type WorkflowsJobActivatedEventDto,
} from '@shipfox/api-workflows-dto';
import {and, asc, count, eq, inArray, isNull, notInArray, sql} from 'drizzle-orm';
import {type AgentDefaultsResolver, createAgentDefaultsResolver} from '#core/agent-defaults.js';
import {loadAgentToolMaterializationContext} from '#core/agent-tools.js';
import {assertWorkflowDiagnosticSize} from '#core/diagnostics.js';
import {isJobTerminal, type JobStatus, type ResolutionReason} from '#core/entities/job.js';
import type {
  JobExecution,
  JobExecutionStatus,
  WorkflowExecutionEvent,
} from '#core/entities/job-execution.js';
import {normalizeWorkflowExecutionEvent} from '#core/entities/job-execution.js';
import {InterpolationUnresolvableError} from '#core/errors.js';
import {type DeriveJobSuccessResult, deriveJobSuccess} from '#core/job-transition/index.js';
import {
  type MaterializedListenerExecution,
  materializeListenerExecution,
} from '#core/listener-execution-materialization.js';
import {
  applyListenerFilterSnapshots,
  assembleListenerSnapshotContext,
  type ListenerTriggerWithSnapshot,
  listenerFilterOutputTypesForJobs,
  planListenerFilterSnapshots,
} from '#core/step-config/assemble-run-context.js';
import {
  recordListenerEventsCoalesced,
  recordWorkflowJobExecutionStatusChanged,
  recordWorkflowListenerResolved,
} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {writeWorkflowsOutboxEvent} from './outbox-writes.js';
import {type JobExecutionDb, jobExecutions, toJobExecution} from './schema/job-executions.js';
import {type JobListenerEventDb, jobListenerEvents} from './schema/job-listener-events.js';
import {jobs, toJob} from './schema/jobs.js';
import {steps} from './schema/steps.js';
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';
import {
  bulkUpdateStepStatuses,
  getDirectDependencyJobContexts,
  loadReferencedVariables,
  updateJobStatusAtVersion,
  writeJobExecutionTerminatedOutbox,
} from './workflow-runs.js';

const TERMINAL_EXECUTION_STATUSES: JobExecutionStatus[] = ['succeeded', 'failed', 'cancelled'];
const MAX_LISTENER_RESOLUTION_ATTEMPTS = 3;

export interface ActivateJobListenerParams {
  jobId: string;
  expectedVersion: number;
}

export interface ActivateJobListenerResult {
  status: 'running' | 'terminal';
  jobStatus: JobStatus;
  jobVersion: number;
  executionCount: number;
}

type JobActivatedListenerMatcher = Extract<
  WorkflowsJobActivatedEventDto,
  {mode: 'listening'}
>['on'][number] &
  ListenerTriggerWithSnapshot;

function applyActivatedListenerFilterSnapshots(
  plans: Parameters<typeof applyListenerFilterSnapshots>[0],
  context: Parameters<typeof applyListenerFilterSnapshots>[1],
  outputTypes: Parameters<typeof applyListenerFilterSnapshots>[2],
): JobActivatedListenerMatcher[] {
  return applyListenerFilterSnapshots(plans, context, outputTypes);
}

export async function activateJobListener(
  params: ActivateJobListenerParams,
): Promise<ActivateJobListenerResult> {
  return await db().transaction(async (tx) => {
    const target = await loadListenerActivationTarget(params.jobId, tx);
    const executionCount = await countJobExecutions(params.jobId, tx);

    if (isJobTerminal(target.job.status)) {
      return {
        status: 'terminal',
        jobStatus: target.job.status,
        jobVersion: target.job.version,
        executionCount,
      };
    }

    const job = await activatePendingListenerJob(target.job, params, tx);

    const listenerRows = await tx
      .update(jobs)
      .set({listenerStatus: 'listening', updatedAt: new Date()})
      .where(and(eq(jobs.id, params.jobId), eq(jobs.listenerStatus, 'inactive')))
      .returning();

    if (listenerRows[0]) await writeListenerActivatedEvent(target, params.jobId, tx);

    return {status: 'running', jobStatus: job.status, jobVersion: job.version, executionCount};
  });
}

async function loadListenerActivationTarget(jobId: string, tx: Tx) {
  const [target] = await tx
    .select({job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1)
    .for('update');
  if (!target) throw new Error(`Job not found: ${jobId}`);
  return target;
}

async function countJobExecutions(jobId: string, tx: Tx): Promise<number> {
  const [{value} = {value: 0}] = await tx
    .select({value: count()})
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId));
  return value;
}

async function activatePendingListenerJob(
  row: typeof jobs.$inferSelect,
  params: ActivateJobListenerParams,
  tx: Tx,
) {
  if (row.status !== 'pending') return toJob(row);

  const updated = await updateJobStatusAtVersion(tx, {
    jobId: params.jobId,
    status: 'running',
    expectedVersion: params.expectedVersion,
  });
  if (updated) return updated.job;

  const [existing] = await tx.select().from(jobs).where(eq(jobs.id, params.jobId)).limit(1);
  if (existing?.status === 'running') return toJob(existing);
  throw new Error(
    `Optimistic lock failure activating listener job ${params.jobId} version ${params.expectedVersion}`,
  );
}

async function writeListenerActivatedEvent(
  target: Awaited<ReturnType<typeof loadListenerActivationTarget>>,
  jobId: string,
  tx: Tx,
): Promise<void> {
  const matchers = {
    on: target.job.listeningOn ?? [],
    until: target.job.listeningUntil ?? null,
  };
  const snapshotPlan = planListenerFilterSnapshots(matchers);
  const dependencyJobs =
    snapshotPlan.jobKeys.size === 0 ? [] : await getDirectDependencyJobContexts(jobId, tx);
  const snapshotContext = assembleListenerSnapshotContext({
    job: toJob(target.job),
    run: toWorkflowRun(target.run),
    triggerPayload: target.run.triggerPayload,
    inputs: target.run.inputs,
    vars: target.attempt.vars ?? undefined,
    plan: snapshotPlan,
    dependencyJobs,
  });
  const listenerOutputTypes = listenerFilterOutputTypesForJobs(dependencyJobs);

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_JOB_ACTIVATED,
    payload: {
      jobId,
      workflowRunId: target.run.id,
      workspaceId: target.run.workspaceId,
      mode: 'listening',
      on: applyActivatedListenerFilterSnapshots(
        snapshotPlan.on,
        snapshotContext,
        listenerOutputTypes,
      ),
      until:
        matchers.until === null
          ? null
          : applyActivatedListenerFilterSnapshots(
              snapshotPlan.until,
              snapshotContext,
              listenerOutputTypes,
            ),
    },
  });
}

export type DrainListenerEventsResult =
  | {
      kind: 'execution';
      jobExecutionId: string;
      executionVersion: number;
      sequence: number;
      requiredLabels: string[];
      status: JobExecutionStatus;
    }
  | {kind: 'resolve-requested'}
  | {kind: 'empty'};

export interface DrainListenerEventsParams {
  jobId: string;
  expectedSequence: number;
  maxSize?: number | undefined;
  integrations?: IntegrationsModuleClient | undefined;
  projects?: ProjectsModuleClient | undefined;
  resolveAgentDefaults?: AgentDefaultsResolver | undefined;
  agent?: AgentInterModuleClient | undefined;
  secrets?: Pick<SecretsInterModuleClient, 'getVariablesByNamespace'> | undefined;
}

export async function drainListenerEventsIntoExecution(
  params: DrainListenerEventsParams,
): Promise<DrainListenerEventsResult> {
  const probeResult = await db().transaction(async (tx) => {
    const existing = await findExistingExecution(params, tx);
    if (existing) return existing;

    const resolveRequested = await hasPendingResolveEvent(params.jobId, tx);
    if (resolveRequested) return {kind: 'resolve-requested' as const};

    const hasBufferedFire = await hasBufferedFireEvent(params.jobId, tx);
    return hasBufferedFire ? null : {kind: 'empty' as const};
  });
  if (probeResult !== null) return probeResult;

  // Resolve external state before opening the persistence transaction. The
  // secrets module uses the shared pool and cannot reuse this transaction's
  // connection across the inter-module boundary.
  const materializationTarget = await loadListenerMaterializationTarget(params.jobId);
  const model =
    materializationTarget.attempt.model === null
      ? null
      : readPersistedWorkflowModel(materializationTarget.attempt.model);
  const modelJob = model?.jobs.find((job) => job.key === materializationTarget.job.key);
  let vars: Record<string, string> | undefined;
  let variableResolutionError: InterpolationUnresolvableError | undefined;
  if (model !== null && modelJob !== undefined) {
    try {
      vars = await loadReferencedVariables({
        model,
        jobs: [modelJob],
        workspaceId: materializationTarget.run.workspaceId,
        projectId: materializationTarget.run.projectId,
        definitionId: materializationTarget.run.definitionId,
        secrets: params.secrets,
      });
    } catch (error) {
      if (!(error instanceof InterpolationUnresolvableError)) throw error;
      variableResolutionError = error;
    }
  }
  const agentToolContext =
    materializationTarget.attempt.agentToolMaterialization === null
      ? await loadAgentToolMaterializationContext({
          model,
          workspaceId: materializationTarget.run.workspaceId,
          projectId: materializationTarget.run.projectId,
          integrations: params.integrations,
          projects: params.projects,
        })
      : undefined;

  const drained = await db().transaction(async (tx) => {
    const existing = await findExistingExecution(params, tx);
    if (existing) return {result: existing};

    const resolveRequested = await hasPendingResolveEvent(params.jobId, tx);
    if (resolveRequested) return {result: {kind: 'resolve-requested' as const}};

    const bufferedEvents = await lockBufferedFireEvents(params, tx);
    if (bufferedEvents.length === 0) return {result: {kind: 'empty' as const}};

    const target = await loadListenerMaterializationTarget(params.jobId, tx);
    const priorExecutions = await loadListenerPriorExecutions(
      params.jobId,
      target.job.name ?? target.job.key,
      tx,
    );
    const materialized = await materializeListenerExecution({
      model,
      run: toWorkflowRun(target.run),
      job: toJob(target.job),
      vars,
      variableResolutionError,
      sequence: params.expectedSequence,
      triggerEvents: listenerTriggerEvents(bufferedEvents),
      priorExecutions,
      resolveAgentDefaults:
        params.resolveAgentDefaults ??
        (params.agent
          ? createAgentDefaultsResolver(params.agent, target.run.workspaceId)
          : undefined),
      agentToolContext,
      agentToolSnapshot: target.attempt.agentToolMaterialization,
    });
    const execution = await persistMaterializedListenerExecution(tx, {
      jobId: params.jobId,
      sequence: params.expectedSequence,
      bufferedEventIds: bufferedEvents.map((event) => event.id),
      materialized,
    });

    if (materialized.status === 'failed') {
      recordWorkflowJobExecutionStatusChanged(materialized.status);
    }

    return {
      result: drainExecutionResult(execution),
      batchSize: bufferedEvents.length,
    };
  });

  if (drained.result.kind === 'execution' && drained.batchSize !== undefined) {
    recordListenerEventsCoalesced(drained.batchSize);
  }

  return drained.result;
}

export interface ListenerBufferPeek {
  fireCount: number;
  resolvePending: boolean;
  oldestAgeMs: number;
  newestAgeMs: number;
}

export async function peekListenerBuffer(params: {jobId: string}): Promise<ListenerBufferPeek> {
  const [row] = await db()
    .select({
      fireCount: sql<number>`count(*) filter (where ${jobListenerEvents.disposition} = 'fire')::integer`,
      resolvePending: sql<boolean>`coalesce(bool_or(${jobListenerEvents.disposition} = 'resolve'), false)`,
      oldestAgeMs: sql<number>`coalesce(floor(extract(epoch from (statement_timestamp() - min(${jobListenerEvents.receivedAt}) filter (where ${jobListenerEvents.disposition} = 'fire'))) * 1000), 0)::integer`,
      newestAgeMs: sql<number>`coalesce(floor(extract(epoch from (statement_timestamp() - max(${jobListenerEvents.receivedAt}) filter (where ${jobListenerEvents.disposition} = 'fire'))) * 1000), 0)::integer`,
    })
    .from(jobListenerEvents)
    .where(
      and(
        eq(jobListenerEvents.jobId, params.jobId),
        isNull(jobListenerEvents.consumedByExecutionId),
      ),
    );

  return {
    fireCount: row?.fireCount ?? 0,
    resolvePending: row?.resolvePending ?? false,
    oldestAgeMs: row?.oldestAgeMs ?? 0,
    newestAgeMs: row?.newestAgeMs ?? 0,
  };
}

export async function resolveJobListener(params: {
  jobId: string;
  reason: ResolutionReason;
}): Promise<{status: 'succeeded' | 'failed'; jobVersion: number}> {
  let result: ApplyJobListenerResolutionResult | undefined;
  for (let attempt = 0; attempt < MAX_LISTENER_RESOLUTION_ATTEMPTS; attempt += 1) {
    const decision = await deriveJobListenerResolutionDecision(params.jobId);
    result = await applyJobListenerResolution(params, decision);
    if (result.kind === 'applied') break;
  }

  if (result?.kind !== 'applied') {
    throw new Error(`Optimistic lock failure resolving listener job ${params.jobId}`);
  }

  if (result.changed) recordWorkflowListenerResolved(params.reason);
  return {status: result.status, jobVersion: result.jobVersion};
}

type JobListenerResolutionDecision = DeriveJobSuccessResult & {
  expectedVersion: number;
};

type ApplyJobListenerResolutionResult =
  | {
      kind: 'applied';
      status: 'succeeded' | 'failed';
      jobVersion: number;
      changed: boolean;
    }
  | {kind: 'stale'};

async function deriveJobListenerResolutionDecision(
  jobId: string,
): Promise<JobListenerResolutionDecision> {
  const [target] = await db()
    .select({job: jobs, attempt: workflowRunAttempts})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const jobRow = target?.job;
  if (!jobRow) throw new Error(`Job not found: ${jobId}`);

  const [executionRows, dependencyJobs] = await Promise.all([
    db()
      .select()
      .from(jobExecutions)
      .where(eq(jobExecutions.jobId, jobId))
      .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id)),
    getDirectDependencyJobContexts(jobId),
  ]);
  return {
    expectedVersion: jobRow.version,
    ...deriveJobSuccess({
      success: jobRow.success,
      executions: executionRows.map((execution) =>
        toJobExecution(execution, jobRow.name ?? jobRow.key),
      ),
      jobs: dependencyJobs,
      vars: target.attempt.vars ?? undefined,
    }),
  };
}

async function applyJobListenerResolution(
  params: {
    jobId: string;
    reason: ResolutionReason;
  },
  decision: JobListenerResolutionDecision,
): Promise<ApplyJobListenerResolutionResult> {
  return await db().transaction(async (tx) => {
    const [jobRow] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, params.jobId))
      .limit(1)
      .for('update');
    if (!jobRow) throw new Error(`Job not found: ${params.jobId}`);

    if (jobRow.version !== decision.expectedVersion && !isJobTerminal(jobRow.status)) {
      return {kind: 'stale' as const};
    }

    const listenerRows = await tx
      .update(jobs)
      .set({
        listenerStatus: 'resolved',
        resolutionReason: params.reason,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, params.jobId), notInArray(jobs.listenerStatus, ['resolved'])))
      .returning({id: jobs.id});

    const updated = await updateJobStatusAtVersion(tx, {
      jobId: params.jobId,
      status: decision.status,
      expectedVersion: decision.expectedVersion,
      statusReason: decision.statusReason,
      evaluationTrace: decision.trace,
    });
    const job = updated?.job ?? toJob(jobRow);
    const resolvedStatus: 'succeeded' | 'failed' =
      job.status === 'succeeded' ? 'succeeded' : 'failed';
    return {
      kind: 'applied' as const,
      status: resolvedStatus,
      jobVersion: job.version,
      changed: listenerRows.length > 0 || updated?.changed === true,
    };
  });
}

export async function settleListenerJobExecution(params: {
  jobExecutionId: string;
  status: Extract<JobExecutionStatus, 'failed' | 'cancelled'>;
}): Promise<void> {
  const changed = await db().transaction(async (tx) => {
    const [execution] = await tx
      .update(jobExecutions)
      .set({
        status: params.status,
        statusReason: params.status === 'failed' ? 'step_failed' : 'run_cancelled',
        version: sql`${jobExecutions.version} + 1`,
        updatedAt: new Date(),
        finishedAt: sql`now()`,
      })
      .where(
        and(
          eq(jobExecutions.id, params.jobExecutionId),
          notInArray(jobExecutions.status, TERMINAL_EXECUTION_STATUSES),
        ),
      )
      .returning();
    if (!execution) return false;
    await writeJobExecutionTerminatedOutbox(tx, {
      jobId: execution.jobId,
      jobExecutionId: execution.id,
      status: execution.status,
      finishedAt: execution.finishedAt,
      statusReason: execution.statusReason,
      statusReasonMessage: execution.statusReasonMessage,
    });
    await bulkUpdateStepStatuses(
      {jobExecutionId: params.jobExecutionId, status: params.status},
      tx,
    );
    return true;
  });

  if (changed) {
    recordWorkflowJobExecutionStatusChanged(params.status);
  }
}

export async function countActiveListeners(): Promise<number> {
  const [row] = await db()
    .select({value: count()})
    .from(jobs)
    .where(eq(jobs.listenerStatus, 'listening'));
  return row?.value ?? 0;
}

async function findExistingExecution(
  params: DrainListenerEventsParams,
  tx: Tx,
): Promise<Extract<DrainListenerEventsResult, {kind: 'execution'}> | undefined> {
  const [existing] = await tx
    .select()
    .from(jobExecutions)
    .where(
      and(
        eq(jobExecutions.jobId, params.jobId),
        eq(jobExecutions.sequence, params.expectedSequence),
      ),
    )
    .limit(1);
  if (!existing) return undefined;
  return drainExecutionResult(existing);
}

async function hasPendingResolveEvent(jobId: string, tx: Tx): Promise<boolean> {
  const [resolveEvent] = await tx
    .select({id: jobListenerEvents.id})
    .from(jobListenerEvents)
    .where(
      and(
        eq(jobListenerEvents.jobId, jobId),
        eq(jobListenerEvents.disposition, 'resolve'),
        isNull(jobListenerEvents.consumedByExecutionId),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id))
    .limit(1)
    .for('update');
  return resolveEvent !== undefined;
}

async function hasBufferedFireEvent(jobId: string, tx: Tx): Promise<boolean> {
  const [fireEvent] = await tx
    .select({id: jobListenerEvents.id})
    .from(jobListenerEvents)
    .where(
      and(
        eq(jobListenerEvents.jobId, jobId),
        eq(jobListenerEvents.disposition, 'fire'),
        isNull(jobListenerEvents.consumedByExecutionId),
      ),
    )
    .limit(1);
  return fireEvent !== undefined;
}

async function lockBufferedFireEvents(
  params: DrainListenerEventsParams,
  tx: Tx,
): Promise<JobListenerEventDb[]> {
  const bufferedQuery = tx
    .select()
    .from(jobListenerEvents)
    .where(
      and(
        eq(jobListenerEvents.jobId, params.jobId),
        eq(jobListenerEvents.disposition, 'fire'),
        isNull(jobListenerEvents.consumedByExecutionId),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id));
  return await (params.maxSize === undefined
    ? bufferedQuery
    : bufferedQuery.limit(params.maxSize)
  ).for('update');
}

function listenerTriggerEvents(
  bufferedEvents: readonly JobListenerEventDb[],
): WorkflowExecutionEvent[] {
  return bufferedEvents.map((event) =>
    normalizeWorkflowExecutionEvent({
      source: event.source,
      event: event.event,
      delivery_id: event.deliveryId,
      received_at: event.receivedAt.toISOString(),
      project: event.triggerReference?.project ?? null,
      repository: event.triggerReference?.repository ?? null,
      ref: event.triggerReference?.ref ?? null,
      commit: event.triggerReference?.commit ?? null,
      data: event.payload,
    }),
  );
}

async function persistMaterializedListenerExecution(
  tx: Tx,
  params: {
    readonly jobId: string;
    readonly sequence: number;
    readonly bufferedEventIds: readonly string[];
    readonly materialized: MaterializedListenerExecution;
  },
): Promise<JobExecutionDb> {
  assertWorkflowDiagnosticSize('execution_evaluation_trace', params.materialized.evaluationTrace);
  for (const step of params.materialized.steps) {
    assertWorkflowDiagnosticSize('config', step.config);
    assertWorkflowDiagnosticSize('authored_config', step.authoredConfig);
    assertWorkflowDiagnosticSize('condition', step.condition);
    assertWorkflowDiagnosticSize('config', step.configPlan);
  }

  const [execution] = await tx
    .insert(jobExecutions)
    .values({
      jobId: params.jobId,
      sequence: params.sequence,
      name: params.materialized.nameOverride,
      runner: params.materialized.runner.length === 0 ? null : [...params.materialized.runner],
      status: params.materialized.status,
      statusReason: params.materialized.statusReason,
      triggerEvents: [...params.materialized.triggerEvents],
      evaluationTrace: params.materialized.evaluationTrace,
      ...(params.materialized.status === 'failed' ? {finishedAt: sql`now()`} : {}),
    })
    .returning();
  if (!execution) throw new Error('Insert returned no rows');

  if (execution.status === 'failed') {
    await writeJobExecutionTerminatedOutbox(tx, {
      jobId: execution.jobId,
      jobExecutionId: execution.id,
      status: execution.status,
      finishedAt: execution.finishedAt,
      statusReason: execution.statusReason,
      statusReasonMessage: execution.statusReasonMessage,
    });
  }

  await tx
    .update(jobListenerEvents)
    .set({consumedByExecutionId: execution.id})
    .where(inArray(jobListenerEvents.id, [...params.bufferedEventIds]));

  if (params.materialized.status === 'pending' && params.materialized.steps.length > 0) {
    await tx.insert(steps).values(
      params.materialized.steps.map((step) => ({
        jobExecutionId: execution.id,
        key: step.key,
        name: step.name,
        sourceLocation: step.sourceLocation,
        status: step.status,
        type: step.type,
        config: step.config,
        configPlan: step.configPlan ?? null,
        authoredConfig: step.authoredConfig,
        condition: step.condition ?? null,
        position: step.position,
      })),
    );
  }

  return execution;
}

function drainExecutionResult(
  execution: JobExecutionDb,
): Extract<DrainListenerEventsResult, {kind: 'execution'}> {
  return {
    kind: 'execution',
    jobExecutionId: execution.id,
    executionVersion: execution.version,
    sequence: execution.sequence,
    requiredLabels: execution.runner ?? [],
    status: execution.status,
  };
}

async function loadListenerMaterializationTarget(jobId: string, tx?: Tx) {
  const query = (tx ?? db())
    .select({job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  const [target] = tx === undefined ? await query : await query.for('update');
  if (!target) throw new Error(`Job not found: ${jobId}`);

  return target;
}

async function loadListenerPriorExecutions(
  jobId: string,
  fallbackName: string,
  tx: Tx,
): Promise<JobExecution[]> {
  const priorExecutions = await tx
    .select()
    .from(jobExecutions)
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return priorExecutions.map((execution) => toJobExecution(execution, fallbackName));
}
