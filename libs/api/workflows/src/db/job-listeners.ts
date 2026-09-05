import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {readPersistedWorkflowModel, type WorkflowModel} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import type {SecretsInterModuleClient} from '@shipfox/api-secrets-dto/inter-module';
import {
  WORKFLOWS_JOB_ACTIVATED,
  type WorkflowsJobActivatedEventDto,
} from '@shipfox/api-workflows-dto';
import {logger} from '@shipfox/node-opentelemetry';
import {and, asc, count, eq, inArray, isNull, notInArray, sql} from 'drizzle-orm';
import {type AgentDefaultsResolver, createAgentDefaultsResolver} from '#core/agent-defaults.js';
import {
  type AgentToolMaterializationContext,
  loadAgentToolMaterializationContext,
} from '#core/agent-tools.js';
import {
  assertWorkflowExecutionPayloadSize,
  observeWorkflowDiagnosticSize,
} from '#core/diagnostics.js';
import {isJobTerminal, type JobStatus, type ResolutionReason} from '#core/entities/job.js';
import type {
  JobExecution,
  JobExecutionStatus,
  WorkflowExecutionEvent,
} from '#core/entities/job-execution.js';
import {
  InterpolationUnresolvableError,
  WorkflowExecutionPayloadTooLargeError,
} from '#core/errors.js';
import {type DeriveJobSuccessResult, deriveJobSuccess} from '#core/job-transition/index.js';
import {
  createListenerEventBatchPacker,
  type ListenerBatchPartitionReason,
  MAX_LISTENER_TRIGGER_EVENTS_BYTES,
} from '#core/listener-event-batching.js';
import {
  type MaterializedListenerExecution,
  materializeListenerExecution,
} from '#core/listener-execution-materialization.js';
import {listenerPriorExecutionEventsRequired} from '#core/listener-prior-execution-context.js';
import {
  applyListenerFilterSnapshots,
  assembleListenerSnapshotContext,
  type ListenerTriggerWithSnapshot,
  listenerFilterOutputTypesForJobs,
  planListenerFilterSnapshots,
} from '#core/step-config/assemble-run-context.js';
import {
  recordListenerBatchPartition,
  recordListenerEventsCoalesced,
  recordWorkflowJobExecutionStatusChanged,
  recordWorkflowListenerEventOutcome,
  recordWorkflowListenerResolved,
} from '#metrics/instance.js';
import {db, type Tx} from './db.js';
import {
  type FinalizedListenerEventCounts,
  finalizePendingListenerEvents,
  normalizeListenerEvent,
} from './job-listener-events.js';
import {writeWorkflowsOutboxEvent} from './outbox-writes.js';
import {
  type JobExecutionDb,
  type JobExecutionDbWithoutTriggerEvents,
  jobExecutions,
  toJobExecution,
} from './schema/job-executions.js';
import {type JobListenerEventDb, jobListenerEvents} from './schema/job-listener-events.js';
import {jobs, toJob} from './schema/jobs.js';
import {steps} from './schema/steps.js';
import {workflowRunAttempts} from './schema/workflow-run-attempts.js';
import {toWorkflowRun, workflowRuns} from './schema/workflow-runs.js';
import {lockWorkflowRun} from './workflow-runs/shared.js';
import {
  bulkUpdateStepStatuses,
  getDirectDependencyJobContexts,
  loadReferencedVariables,
  updateJobStatusAtVersion,
  writeJobExecutionTerminatedOutbox,
} from './workflow-runs.js';

const TERMINAL_EXECUTION_STATUSES: JobExecutionStatus[] = ['succeeded', 'failed', 'cancelled'];
const MAX_LISTENER_RESOLUTION_ATTEMPTS = 3;
// Stored sizes use PostgreSQL JSONB text accounting, while execution payloads use compact JSON.
// Keep the SQL prefix conservative; exact application serialization remains authoritative.
const LISTENER_EVENT_SQL_BYTE_SAFETY_MARGIN_BYTES = 1_024;
const LISTENER_EVENT_SQL_BYTE_LIMIT =
  MAX_LISTENER_TRIGGER_EVENTS_BYTES - LISTENER_EVENT_SQL_BYTE_SAFETY_MARGIN_BYTES;
// Bound the metadata probe and payload hydration when the author did not set
// a batch count. The application packer remains the byte authority.
const LISTENER_EVENT_SQL_CANDIDATE_COUNT_LIMIT = 100;

function pendingListenerEventCondition() {
  return and(
    eq(jobListenerEvents.outcome, 'pending'),
    isNull(jobListenerEvents.consumedByExecutionId),
  );
}

function recordFinalizedListenerEventMetrics(
  counts: FinalizedListenerEventCounts,
  reason: ResolutionReason,
): void {
  if (counts.honored > 0) {
    recordWorkflowListenerEventOutcome('honored', 'none', counts.honored);
  }
  if (counts.abandoned > 0) {
    recordWorkflowListenerEventOutcome('abandoned', reason, counts.abandoned);
  }
}

const listenerPriorExecutionSelection = {
  id: jobExecutions.id,
  jobId: jobExecutions.jobId,
  sequence: jobExecutions.sequence,
  name: jobExecutions.name,
  runner: jobExecutions.runner,
  runnerLabels: jobExecutions.runnerLabels,
  templateKey: jobExecutions.templateKey,
  provisionerId: jobExecutions.provisionerId,
  provisionerScope: jobExecutions.provisionerScope,
  providerKind: jobExecutions.providerKind,
  launchKind: jobExecutions.launchKind,
  status: jobExecutions.status,
  statusReason: jobExecutions.statusReason,
  statusReasonMessage: jobExecutions.statusReasonMessage,
  outputs: jobExecutions.outputs,
  evaluationTrace: jobExecutions.evaluationTrace,
  version: jobExecutions.version,
  createdAt: jobExecutions.createdAt,
  updatedAt: jobExecutions.updatedAt,
  queuedAt: jobExecutions.queuedAt,
  startedAt: jobExecutions.startedAt,
  finishedAt: jobExecutions.finishedAt,
  timedOutAt: jobExecutions.timedOutAt,
} satisfies Record<keyof JobExecutionDbWithoutTriggerEvents, unknown>;

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
    snapshotPlan.jobKeys.size === 0 && !snapshotPlan.jobsAreBroad
      ? []
      : await getDirectDependencyJobContexts(jobId, tx);
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
  const on = applyActivatedListenerFilterSnapshots(
    snapshotPlan.on,
    snapshotContext,
    listenerOutputTypes,
  );
  const until =
    matchers.until === null
      ? null
      : applyActivatedListenerFilterSnapshots(
          snapshotPlan.until,
          snapshotContext,
          listenerOutputTypes,
        );
  const filterSnapshots = [...on, ...(until ?? [])].flatMap(({filter_snapshot}) =>
    filter_snapshot === undefined ? [] : [filter_snapshot],
  );
  if (filterSnapshots.length > 0) {
    assertWorkflowExecutionPayloadSize('filter_snapshot', filterSnapshots);
  }

  await writeWorkflowsOutboxEvent(tx, {
    type: WORKFLOWS_JOB_ACTIVATED,
    payload: {
      jobId,
      workflowRunId: target.run.id,
      workspaceId: target.run.workspaceId,
      mode: 'listening',
      on,
      until,
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

interface DrainedListenerEvents {
  readonly result: DrainListenerEventsResult;
  readonly batchSize?: number;
  readonly partitionReason?: ListenerBatchPartitionReason;
}

interface LockedListenerEventBatch {
  readonly bufferedEvents: readonly JobListenerEventDb[];
  readonly triggerEvents: readonly WorkflowExecutionEvent[];
  readonly partitionReason?: ListenerBatchPartitionReason;
}

interface ListenerEventCandidateRow {
  readonly id: string;
  readonly candidateNumber: number;
  readonly runningBytes: number;
}

interface ListenerDrainTransactionParams {
  readonly drain: DrainListenerEventsParams;
  readonly model: WorkflowModel | null;
  readonly includePriorExecutionTriggerEvents: boolean;
  readonly vars: Record<string, string> | undefined;
  readonly variableResolutionError: InterpolationUnresolvableError | undefined;
  readonly agentToolContext: AgentToolMaterializationContext | undefined;
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
  const includePriorExecutionTriggerEvents = listenerPriorExecutionEventsRequired({
    model,
    jobKey: materializationTarget.job.key,
  });
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

  const drained = await db().transaction((tx) =>
    drainListenerEventsInTransaction(
      {
        drain: params,
        model,
        includePriorExecutionTriggerEvents,
        vars,
        variableResolutionError,
        agentToolContext,
      },
      tx,
    ),
  );

  if (drained.partitionReason !== undefined) {
    recordListenerBatchPartition(drained.partitionReason);
  }
  if (drained.result.kind === 'empty' && drained.partitionReason === 'byte_limit') {
    logger().warn(
      {jobId: params.jobId, limitBytes: MAX_LISTENER_TRIGGER_EVENTS_BYTES},
      'Listener event batch head exceeds the execution byte limit; leaving it buffered',
    );
  }
  if (drained.result.kind === 'execution' && drained.batchSize !== undefined) {
    recordListenerEventsCoalesced(drained.batchSize);
    recordWorkflowListenerEventOutcome('consumed', 'none', drained.batchSize);
  }

  return drained.result;
}

async function drainListenerEventsInTransaction(
  params: ListenerDrainTransactionParams,
  tx: Tx,
): Promise<DrainedListenerEvents> {
  // Cancellation locks the run, attempt, job, and then listener events. Keep
  // the drain's lock order the same before locking any event rows.
  const target = await loadListenerMaterializationTarget(params.drain.jobId, tx);
  const existing = await findExistingExecution(params.drain, tx);
  if (existing) return {result: existing};

  const resolveRequested = await hasPendingResolveEvent(params.drain.jobId, tx);
  if (resolveRequested) return {result: {kind: 'resolve-requested'}};

  const bufferedEventBatch = await lockBufferedFireEventBatch(params.drain, tx);
  if (bufferedEventBatch.bufferedEvents.length === 0) {
    return {
      result: {kind: 'empty'},
      ...(bufferedEventBatch.partitionReason === undefined
        ? {}
        : {partitionReason: bufferedEventBatch.partitionReason}),
    };
  }
  const existingAfterEventLock = await findExistingExecution(params.drain, tx);
  if (existingAfterEventLock) return {result: existingAfterEventLock};

  const priorExecutions = await loadListenerPriorExecutions(
    params.drain.jobId,
    target.job.name ?? target.job.key,
    tx,
    params.includePriorExecutionTriggerEvents,
  );
  const materialized = await materializeListenerExecution({
    model: params.model,
    run: toWorkflowRun(target.run),
    job: toJob(target.job),
    vars: params.vars,
    variableResolutionError: params.variableResolutionError,
    sequence: params.drain.expectedSequence,
    triggerEvents: bufferedEventBatch.triggerEvents,
    priorExecutions,
    resolveAgentDefaults:
      params.drain.resolveAgentDefaults ??
      (params.drain.agent
        ? createAgentDefaultsResolver(params.drain.agent, target.run.workspaceId)
        : undefined),
    agentToolContext: params.agentToolContext,
    agentToolSnapshot: target.attempt.agentToolMaterialization,
  });
  const execution = await persistMaterializedListenerExecution(tx, {
    jobId: params.drain.jobId,
    sequence: params.drain.expectedSequence,
    bufferedEventIds: bufferedEventBatch.bufferedEvents.map((event) => event.id),
    materialized,
  });

  if (materialized.status === 'failed' || execution.status === 'failed') {
    recordWorkflowJobExecutionStatusChanged(execution.status);
  }

  return {
    result: drainExecutionResult(execution),
    batchSize: bufferedEventBatch.bufferedEvents.length,
    ...(bufferedEventBatch.partitionReason === undefined
      ? {}
      : {partitionReason: bufferedEventBatch.partitionReason}),
  };
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
    .where(and(eq(jobListenerEvents.jobId, params.jobId), pendingListenerEventCondition()));

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

  recordFinalizedListenerEventMetrics(result.eventOutcomes, params.reason);
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
      eventOutcomes: FinalizedListenerEventCounts;
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

  const model =
    target.attempt.model === null ? null : readPersistedWorkflowModel(target.attempt.model);
  const includePriorExecutionTriggerEvents = listenerPriorExecutionEventsRequired({
    model,
    jobKey: jobRow.key,
    success: jobRow.success,
  });

  const [executionRows, dependencyJobs] = await Promise.all([
    (includePriorExecutionTriggerEvents
      ? db().select().from(jobExecutions)
      : db().select(listenerPriorExecutionSelection).from(jobExecutions)
    )
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
    const eventOutcomes = await finalizePendingListenerEvents(tx, {
      jobId: params.jobId,
      reason: params.reason,
    });
    const resolvedStatus: 'succeeded' | 'failed' =
      job.status === 'succeeded' ? 'succeeded' : 'failed';
    return {
      kind: 'applied' as const,
      status: resolvedStatus,
      jobVersion: job.version,
      changed:
        listenerRows.length > 0 ||
        updated?.changed === true ||
        eventOutcomes.honored > 0 ||
        eventOutcomes.abandoned > 0,
      eventOutcomes,
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
      queuedAt: execution.queuedAt,
      startedAt: execution.startedAt,
      runnerLabels: execution.runnerLabels,
      templateKey: execution.templateKey,
      provisionerId: execution.provisionerId,
      provisionerScope: execution.provisionerScope,
      providerKind: execution.providerKind,
      launchKind: execution.launchKind,
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
        pendingListenerEventCondition(),
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
        pendingListenerEventCondition(),
      ),
    )
    .limit(1);
  return fireEvent !== undefined;
}

async function lockBufferedFireEventBatch(
  params: DrainListenerEventsParams,
  tx: Tx,
): Promise<LockedListenerEventBatch> {
  if (params.maxSize !== undefined && params.maxSize <= 0) {
    return {bufferedEvents: [], triggerEvents: []};
  }

  const candidateCountLimit = params.maxSize ?? LISTENER_EVENT_SQL_CANDIDATE_COUNT_LIMIT;
  const candidateInput = tx
    .select({
      id: jobListenerEvents.id,
      receivedAt: jobListenerEvents.receivedAt,
      normalizedEventBytes: jobListenerEvents.normalizedEventBytes,
    })
    .from(jobListenerEvents)
    .where(
      and(
        eq(jobListenerEvents.jobId, params.jobId),
        eq(jobListenerEvents.disposition, 'fire'),
        pendingListenerEventCondition(),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id))
    .limit(candidateCountLimit + 1)
    .as('listener_event_candidate_input');
  const candidateSelection = tx
    .select({
      id: candidateInput.id,
      receivedAt: candidateInput.receivedAt,
      candidateNumber: sql<number>`row_number() over (
        order by ${candidateInput.receivedAt} asc, ${candidateInput.id} asc
      )`.as('candidate_number'),
      runningBytes: sql<number>`sum(
        case
          when ${candidateInput.normalizedEventBytes} = 0
            then 0
          else ${candidateInput.normalizedEventBytes}
        end
      ) over (
        order by ${candidateInput.receivedAt} asc, ${candidateInput.id} asc
        rows between unbounded preceding and current row
      )`.as('running_bytes'),
    })
    .from(candidateInput)
    .as('listener_event_candidates');
  const candidateProjectionRows = await tx
    .select({
      id: candidateSelection.id,
      candidateNumber: candidateSelection.candidateNumber,
      runningBytes: candidateSelection.runningBytes,
    })
    .from(candidateSelection)
    .orderBy(asc(candidateSelection.receivedAt), asc(candidateSelection.id));
  const candidateRows = selectListenerEventCandidates(candidateProjectionRows, candidateCountLimit);
  if (candidateRows.length === 0) return {bufferedEvents: [], triggerEvents: []};

  const sqlPartitionReason = listenerSqlPartitionReason(
    candidateProjectionRows,
    candidateCountLimit,
  );

  // The projection above excludes payload so PostgreSQL can choose a cheap numeric prefix.
  // Hydration is intentionally a second query over only those IDs, in lock order.
  const hydratedEvents = await tx
    .select()
    .from(jobListenerEvents)
    .where(
      and(
        inArray(
          jobListenerEvents.id,
          candidateRows.map((row) => row.id),
        ),
        eq(jobListenerEvents.jobId, params.jobId),
        eq(jobListenerEvents.disposition, 'fire'),
        pendingListenerEventCondition(),
      ),
    )
    .orderBy(asc(jobListenerEvents.receivedAt), asc(jobListenerEvents.id))
    .for('update');
  const packer = createListenerEventBatchPacker();
  for (const event of hydratedEvents) {
    if (!packer.add(listenerTriggerEvent(event))) break;
  }

  const batch = packer.finish({
    countLimitReached: sqlPartitionReason === 'count_limit',
  });
  const partitionReason =
    batch.kind === 'empty' ? batch.reason : (batch.partitionReason ?? sqlPartitionReason);
  const selectedEventCount = batch.kind === 'empty' ? 0 : batch.events.length;
  return {
    bufferedEvents: hydratedEvents.slice(0, selectedEventCount),
    triggerEvents: batch.kind === 'empty' ? [] : batch.events,
    ...(partitionReason === undefined ? {} : {partitionReason}),
  };
}

function selectListenerEventCandidates(
  rows: readonly ListenerEventCandidateRow[],
  countLimit: number,
): ListenerEventCandidateRow[] {
  return rows.filter((row) => {
    const candidateNumber = Number(row.candidateNumber);
    if (candidateNumber > countLimit) return false;
    return candidateNumber === 1 || Number(row.runningBytes) <= LISTENER_EVENT_SQL_BYTE_LIMIT;
  });
}

function listenerSqlPartitionReason(
  rows: readonly ListenerEventCandidateRow[],
  countLimit: number,
): ListenerBatchPartitionReason | undefined {
  if (rows.some((row) => Number(row.runningBytes) > LISTENER_EVENT_SQL_BYTE_LIMIT)) {
    return 'byte_limit';
  }
  if (rows.length > countLimit) return 'count_limit';
  return undefined;
}

function listenerTriggerEvent(event: JobListenerEventDb): WorkflowExecutionEvent {
  return normalizeListenerEvent(event);
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
  try {
    assertWorkflowExecutionPayloadSize('listener_batch', params.materialized.triggerEvents);
    observeWorkflowDiagnosticSize(
      'execution_evaluation_trace',
      params.materialized.evaluationTrace,
    );
    for (const step of params.materialized.steps) {
      assertWorkflowExecutionPayloadSize('resolved_config', step.config);
      assertWorkflowExecutionPayloadSize('authored_config', step.authoredConfig);
      assertWorkflowExecutionPayloadSize('condition', step.condition);
      assertWorkflowExecutionPayloadSize('config_plan', step.configPlan);
    }
  } catch (error) {
    if (!(error instanceof WorkflowExecutionPayloadTooLargeError)) throw error;
    return persistRejectedMaterializedListenerExecution(tx, params, error);
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
      queuedAt: execution.queuedAt,
      startedAt: execution.startedAt,
      runnerLabels: execution.runnerLabels,
      templateKey: execution.templateKey,
      provisionerId: execution.provisionerId,
      provisionerScope: execution.provisionerScope,
      providerKind: execution.providerKind,
      launchKind: execution.launchKind,
    });
  }

  await tx
    .update(jobListenerEvents)
    .set({consumedByExecutionId: execution.id, outcome: 'consumed', outcomeReason: null})
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

async function persistRejectedMaterializedListenerExecution(
  tx: Tx,
  params: {
    readonly jobId: string;
    readonly sequence: number;
    readonly bufferedEventIds: readonly string[];
    readonly materialized: MaterializedListenerExecution;
  },
  error: WorkflowExecutionPayloadTooLargeError,
): Promise<JobExecutionDb> {
  const [execution] = await tx
    .insert(jobExecutions)
    .values({
      jobId: params.jobId,
      sequence: params.sequence,
      name: params.materialized.nameOverride,
      runner: null,
      status: 'failed',
      statusReason: 'output_too_large',
      statusReasonMessage: boundedListenerDiagnosticMessage(error.message),
      triggerEvents: [],
      evaluationTrace: null,
      finishedAt: sql`now()`,
    })
    .returning();
  if (!execution) throw new Error('Insert rejected listener execution returned no rows');

  await writeJobExecutionTerminatedOutbox(tx, {
    jobId: execution.jobId,
    jobExecutionId: execution.id,
    status: execution.status,
    finishedAt: execution.finishedAt,
    statusReason: execution.statusReason,
    statusReasonMessage: execution.statusReasonMessage,
    queuedAt: execution.queuedAt,
    startedAt: execution.startedAt,
    runnerLabels: execution.runnerLabels,
    templateKey: execution.templateKey,
    provisionerId: execution.provisionerId,
    provisionerScope: execution.provisionerScope,
    providerKind: execution.providerKind,
    launchKind: execution.launchKind,
  });
  await tx
    .update(jobListenerEvents)
    .set({consumedByExecutionId: execution.id, outcome: 'consumed', outcomeReason: null})
    .where(inArray(jobListenerEvents.id, [...params.bufferedEventIds]));

  return execution;
}

function boundedListenerDiagnosticMessage(message: string): string {
  const maxLength = 2048;
  return message.length <= maxLength ? message : `${message.slice(0, maxLength - 1)}…`;
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
  if (tx !== undefined) {
    // Keep transaction lock acquisition explicit and aligned with cancellation
    // and timeout: run, attempt, job, then listener events.
    const [jobReference] = await tx
      .select({workflowRunAttemptId: jobs.workflowRunAttemptId})
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1);
    if (!jobReference) throw new Error(`Job not found: ${jobId}`);

    const [attemptReference] = await tx
      .select({workflowRunId: workflowRunAttempts.workflowRunId})
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.id, jobReference.workflowRunAttemptId))
      .limit(1);
    if (!attemptReference) throw new Error(`Job not found: ${jobId}`);

    const run = await lockWorkflowRun(attemptReference.workflowRunId, tx);
    if (!run) throw new Error(`Job not found: ${jobId}`);

    const [attempt] = await tx
      .select()
      .from(workflowRunAttempts)
      .where(eq(workflowRunAttempts.id, jobReference.workflowRunAttemptId))
      .limit(1)
      .for('update');
    if (!attempt) throw new Error(`Job not found: ${jobId}`);

    const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1).for('update');
    if (!job) throw new Error(`Job not found: ${jobId}`);

    return {job, attempt, run};
  }

  const [target] = await db()
    .select({job: jobs, attempt: workflowRunAttempts, run: workflowRuns})
    .from(jobs)
    .innerJoin(workflowRunAttempts, eq(jobs.workflowRunAttemptId, workflowRunAttempts.id))
    .innerJoin(workflowRuns, eq(workflowRunAttempts.workflowRunId, workflowRuns.id))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!target) throw new Error(`Job not found: ${jobId}`);

  return target;
}

async function loadListenerPriorExecutions(
  jobId: string,
  fallbackName: string,
  tx: Tx,
  includeTriggerEvents: boolean,
): Promise<JobExecution[]> {
  const priorExecutions = await (includeTriggerEvents
    ? tx.select().from(jobExecutions)
    : tx.select(listenerPriorExecutionSelection).from(jobExecutions)
  )
    .where(eq(jobExecutions.jobId, jobId))
    .orderBy(asc(jobExecutions.sequence), asc(jobExecutions.id));
  return priorExecutions.map((execution) => toJobExecution(execution, fallbackName));
}
