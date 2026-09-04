import type {RunnerJobClaimedEvent, RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import {
  MAX_USAGE_REPLAY_LIMIT,
  USAGE_JOB_EXECUTION_RECORDED,
  type UsageEventMap,
  type UsageJobExecutionRecordedEvent,
} from '@shipfox/api-usage-dto';
import type {
  WorkflowsJobExecutionQueuedEventDto,
  WorkflowsJobExecutionTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, asc, eq, gt, gte, isNotNull, or, sql} from 'drizzle-orm';
import {parseRunnerIdentity} from '#core/runner-identity.js';
import {db, type Transaction} from './db.js';
import {usageJobExecutions} from './schema/job-executions.js';
import {usageOutbox} from './schema/outbox.js';

export type UsageJobExecutionRow = typeof usageJobExecutions.$inferSelect;

export interface JobExecutionUsageCursor {
  recordedAt: Date;
  jobExecutionId: string;
}

export interface ListJobExecutionUsageParams {
  workspaceId?: string | undefined;
  since?: Date | undefined;
  cursor?: JobExecutionUsageCursor | undefined;
  limit?: number | undefined;
}

export interface ListJobExecutionUsageResult {
  jobExecutions: UsageJobExecutionRow[];
  nextCursor: JobExecutionUsageCursor | null;
}

export interface JobExecutionEventIdentity {
  jobExecutionId: string;
  jobId: string;
  workflowRunId: string;
  workflowRunAttemptId: string;
}

export async function recordJobExecutionQueued(
  payload: WorkflowsJobExecutionQueuedEventDto,
): Promise<void> {
  await db().transaction(async (tx) => {
    await lockJobExecution(tx, payload.jobExecutionId);
    const current = await loadJobExecution(tx, payload.jobExecutionId);
    const identity = eventIdentity(payload);

    if (!current) {
      await tx.insert(usageJobExecutions).values({
        ...identity,
        workspaceId: payload.workspaceId,
        projectId: payload.projectId,
        definitionId: payload.definitionId ?? null,
        jobKey: payload.jobKey ?? null,
        runNumber: payload.runNumber ?? null,
        requestedLabels: payload.requiredLabels,
        queuedAt: new Date(payload.queuedAt),
        state: 'queued',
      });
      return;
    }

    assertIdentity(current, identity);
    await tx
      .update(usageJobExecutions)
      .set({
        workspaceId: current.workspaceId ?? payload.workspaceId,
        projectId: current.projectId ?? payload.projectId,
        definitionId: current.definitionId ?? payload.definitionId ?? null,
        jobKey: current.jobKey ?? payload.jobKey ?? null,
        runNumber: current.runNumber ?? payload.runNumber ?? null,
        requestedLabels: current.requestedLabels ?? payload.requiredLabels,
        queuedAt: current.queuedAt ?? new Date(payload.queuedAt),
        state:
          current.state === 'running' || current.state === 'terminated' ? current.state : 'queued',
      })
      .where(eq(usageJobExecutions.jobExecutionId, payload.jobExecutionId));
  });
}

export function recordJobExecutionClaimed(payload: RunnerJobClaimedEvent): Promise<void> {
  return db().transaction((tx) => recordClaimedInTransaction(tx, payload));
}

async function recordClaimedInTransaction(
  tx: Transaction,
  payload: RunnerJobClaimedEvent,
): Promise<void> {
  await lockJobExecution(tx, payload.jobExecutionId);
  const current = await loadJobExecution(tx, payload.jobExecutionId);
  const identity = eventIdentity(payload);

  if (!current) {
    await insertClaimedJobExecution(tx, payload, identity);
    return;
  }

  assertIdentity(current, identity);
  await updateClaimedJobExecution(tx, current, payload);
}

async function insertClaimedJobExecution(
  tx: Transaction,
  payload: RunnerJobClaimedEvent,
  identity: JobExecutionEventIdentity,
): Promise<void> {
  const parsed = parseRunnerIdentity(
    payload.runnerLabels ?? null,
    payload.provisionerScope ?? null,
  );
  await tx.insert(usageJobExecutions).values({
    ...identity,
    workspaceId: payload.workspaceId ?? null,
    projectId: payload.projectId ?? null,
    runnerLabels: parsed.runnerLabels,
    templateKey: payload.templateKey ?? null,
    provisionerId: payload.provisionerId ?? null,
    provisionerScope: payload.provisionerScope ?? null,
    providerKind: payload.providerKind ?? null,
    launchKind: payload.launchKind ?? null,
    runnerClass: parsed.runnerClass,
    runnerArch: parsed.runnerArch,
    runnerCpu: parsed.runnerCpu,
    managed: parsed.managed,
    startedAt: new Date(payload.claimedAt),
    state: 'running',
  });
}

async function updateClaimedJobExecution(
  tx: Transaction,
  current: UsageJobExecutionRow,
  payload: RunnerJobClaimedEvent,
): Promise<void> {
  const runnerIdentity = mergeClaimedRunnerIdentity(current, payload);
  const startedAt = current.startedAt ?? new Date(payload.claimedAt);
  await tx
    .update(usageJobExecutions)
    .set({
      workspaceId: current.workspaceId ?? payload.workspaceId ?? null,
      projectId: current.projectId ?? payload.projectId ?? null,
      runnerLabels: runnerIdentity.runnerLabels,
      templateKey: current.templateKey ?? payload.templateKey ?? null,
      provisionerId: current.provisionerId ?? payload.provisionerId ?? null,
      provisionerScope: current.provisionerScope ?? payload.provisionerScope ?? null,
      providerKind: current.providerKind ?? payload.providerKind ?? null,
      launchKind: current.launchKind ?? payload.launchKind ?? null,
      runnerClass: current.runnerClass ?? runnerIdentity.runnerClass,
      runnerArch: current.runnerArch ?? runnerIdentity.runnerArch,
      runnerCpu: current.runnerCpu ?? runnerIdentity.runnerCpu,
      managed: current.managed ?? runnerIdentity.managed,
      startedAt,
      durationSeconds: current.durationSeconds ?? durationSeconds(startedAt, current.finishedAt),
      state: current.state === 'terminated' ? 'terminated' : 'running',
    })
    .where(eq(usageJobExecutions.jobExecutionId, payload.jobExecutionId));
}

function mergeClaimedRunnerIdentity(
  current: UsageJobExecutionRow,
  payload: RunnerJobClaimedEvent,
): ReturnType<typeof parseRunnerIdentity> {
  const scope = current.provisionerScope ?? payload.provisionerScope ?? null;
  if (current.runnerLabels !== null) {
    return {
      runnerLabels: current.runnerLabels,
      runnerClass: current.runnerClass,
      runnerArch: current.runnerArch,
      runnerCpu: current.runnerCpu,
      managed: current.managed,
    };
  }
  return parseRunnerIdentity(payload.runnerLabels ?? null, scope);
}

export async function recordJobExecutionLeaseExpired(
  payload: RunnerJobLeaseExpiredEvent,
): Promise<void> {
  await db().transaction(async (tx) => {
    await lockJobExecution(tx, payload.jobExecutionId);
    const current = await loadJobExecution(tx, payload.jobExecutionId);
    const identity = eventIdentity(payload);
    const expiredAt = new Date(payload.expiredAt ?? new Date().toISOString());

    if (!current) {
      await tx.insert(usageJobExecutions).values({
        ...identity,
        leaseExpiredAt: expiredAt,
      });
      return;
    }

    assertIdentity(current, identity);
    await tx
      .update(usageJobExecutions)
      .set({leaseExpiredAt: current.leaseExpiredAt ?? expiredAt})
      .where(eq(usageJobExecutions.jobExecutionId, payload.jobExecutionId));
  });
}

export interface RecordJobExecutionTerminatedResult {
  published: boolean;
  row: UsageJobExecutionRow;
}

export function recordJobExecutionTerminated(
  payload: WorkflowsJobExecutionTerminatedEventDto,
): Promise<RecordJobExecutionTerminatedResult> {
  return db().transaction((tx) => recordTerminatedInTransaction(tx, payload));
}

async function recordTerminatedInTransaction(
  tx: Transaction,
  payload: WorkflowsJobExecutionTerminatedEventDto,
): Promise<RecordJobExecutionTerminatedResult> {
  await lockJobExecution(tx, payload.jobExecutionId);
  const current = await loadJobExecution(tx, payload.jobExecutionId);
  const identity = eventIdentity(payload);
  const now = new Date();
  const row = current
    ? await updateTerminatedJobExecution(tx, current, payload, identity, now)
    : await insertTerminatedJobExecution(tx, payload, identity, now);
  const published = current?.recordedAt == null;

  if (published) {
    await writeOutboxEvent<UsageEventMap>(tx, usageOutbox, {
      type: USAGE_JOB_EXECUTION_RECORDED,
      orderingKey: row.workflowRunId,
      payload: toRecordedJobExecution(row),
    });
  }

  return {published, row};
}

async function insertTerminatedJobExecution(
  tx: Transaction,
  payload: WorkflowsJobExecutionTerminatedEventDto,
  identity: JobExecutionEventIdentity,
  now: Date,
): Promise<UsageJobExecutionRow> {
  const finishedAt = toDate(payload.finishedAt) ?? now;
  const startedAt = toDate(payload.startedAt);
  const parsed = parseRunnerIdentity(
    payload.runnerLabels ?? null,
    payload.provisionerScope ?? null,
  );
  const [inserted] = await tx
    .insert(usageJobExecutions)
    .values({
      ...identity,
      workspaceId: payload.workspaceId ?? null,
      projectId: payload.projectId ?? null,
      definitionId: payload.definitionId ?? null,
      jobKey: payload.jobKey ?? null,
      runnerLabels: parsed.runnerLabels,
      templateKey: payload.templateKey ?? null,
      provisionerId: payload.provisionerId ?? null,
      provisionerScope: payload.provisionerScope ?? null,
      providerKind: payload.providerKind ?? null,
      launchKind: payload.launchKind ?? null,
      runnerClass: parsed.runnerClass,
      runnerArch: parsed.runnerArch,
      runnerCpu: parsed.runnerCpu,
      managed: parsed.managed,
      queuedAt: toDate(payload.queuedAt),
      startedAt,
      finishedAt,
      status: payload.status,
      statusReason: payload.statusReason,
      cancellationReason: payload.cancellationReason ?? null,
      durationSeconds: durationSeconds(startedAt, finishedAt),
      state: 'terminated',
      recordedAt: now,
    })
    .returning();
  if (!inserted) throw new Error('Usage job execution was not inserted');
  return inserted;
}

async function updateTerminatedJobExecution(
  tx: Transaction,
  current: UsageJobExecutionRow,
  payload: WorkflowsJobExecutionTerminatedEventDto,
  identity: JobExecutionEventIdentity,
  now: Date,
): Promise<UsageJobExecutionRow> {
  assertIdentity(current, identity);
  const startedAt = firstValue(current.startedAt, toDate(payload.startedAt));
  const finishedAt = firstValue(current.finishedAt, toDate(payload.finishedAt) ?? now);
  const runnerIdentity = mergeTerminatedRunnerIdentity(current, payload);
  const [updated] = await tx
    .update(usageJobExecutions)
    .set({
      workspaceId: firstValue(current.workspaceId, payload.workspaceId),
      projectId: firstValue(current.projectId, payload.projectId),
      definitionId: firstValue(current.definitionId, payload.definitionId),
      jobKey: firstValue(current.jobKey, payload.jobKey),
      ...runnerIdentity,
      templateKey: firstValue(current.templateKey, payload.templateKey),
      provisionerId: firstValue(current.provisionerId, payload.provisionerId),
      provisionerScope: firstValue(current.provisionerScope, payload.provisionerScope),
      providerKind: firstValue(current.providerKind, payload.providerKind),
      launchKind: firstValue(current.launchKind, payload.launchKind),
      queuedAt: firstValue(current.queuedAt, toDate(payload.queuedAt)),
      startedAt,
      finishedAt,
      status: preferValue(current.status, payload.status),
      statusReason: preferValue(current.statusReason, payload.statusReason),
      cancellationReason: firstValue(current.cancellationReason, payload.cancellationReason),
      durationSeconds: preferValue(current.durationSeconds, durationSeconds(startedAt, finishedAt)),
      state: 'terminated',
      recordedAt: preferValue(current.recordedAt, now),
    })
    .where(eq(usageJobExecutions.jobExecutionId, payload.jobExecutionId))
    .returning();
  if (!updated) throw new Error('Usage job execution disappeared during termination');
  return updated;
}

function mergeTerminatedRunnerIdentity(
  current: UsageJobExecutionRow,
  payload: WorkflowsJobExecutionTerminatedEventDto,
): ReturnType<typeof parseRunnerIdentity> {
  const runnerLabels = current.runnerLabels ?? payload.runnerLabels ?? null;
  const provisionerScope = current.provisionerScope ?? payload.provisionerScope ?? null;
  if (current.runnerLabels !== null) {
    return {
      runnerLabels,
      runnerClass: current.runnerClass,
      runnerArch: current.runnerArch,
      runnerCpu: current.runnerCpu,
      managed: current.managed,
    };
  }
  return parseRunnerIdentity(runnerLabels, provisionerScope);
}

export async function getJobExecutionUsage(params: {
  workspaceId: string;
  jobExecutionId: string;
}): Promise<UsageJobExecutionRow | null> {
  const [row] = await db()
    .select()
    .from(usageJobExecutions)
    .where(
      and(
        eq(usageJobExecutions.workspaceId, params.workspaceId),
        eq(usageJobExecutions.jobExecutionId, params.jobExecutionId),
      ),
    );
  return row ?? null;
}

export function listJobExecutionsForRun(params: {
  workspaceId: string;
  workflowRunId: string;
}): Promise<UsageJobExecutionRow[]> {
  return db()
    .select()
    .from(usageJobExecutions)
    .where(
      and(
        eq(usageJobExecutions.workspaceId, params.workspaceId),
        eq(usageJobExecutions.workflowRunId, params.workflowRunId),
      ),
    )
    .orderBy(asc(usageJobExecutions.queuedAt), asc(usageJobExecutions.jobExecutionId));
}

export async function listJobExecutionUsage(
  params: ListJobExecutionUsageParams,
): Promise<ListJobExecutionUsageResult> {
  const limit = params.limit ?? MAX_USAGE_REPLAY_LIMIT;
  const conditions = [isNotNull(usageJobExecutions.recordedAt)];
  if (params.workspaceId) conditions.push(eq(usageJobExecutions.workspaceId, params.workspaceId));
  if (params.since) conditions.push(gte(usageJobExecutions.recordedAt, params.since));
  if (params.cursor) {
    const cursorCondition = or(
      gt(usageJobExecutions.recordedAt, params.cursor.recordedAt),
      and(
        eq(usageJobExecutions.recordedAt, params.cursor.recordedAt),
        gt(usageJobExecutions.jobExecutionId, params.cursor.jobExecutionId),
      ),
    );
    if (cursorCondition) conditions.push(cursorCondition);
  }

  const rows = await db()
    .select()
    .from(usageJobExecutions)
    .where(and(...conditions))
    .orderBy(asc(usageJobExecutions.recordedAt), asc(usageJobExecutions.jobExecutionId))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = rows.length > limit ? page.at(-1) : undefined;
  return {
    jobExecutions: page,
    nextCursor: last?.recordedAt
      ? {recordedAt: last.recordedAt, jobExecutionId: last.jobExecutionId}
      : null,
  };
}

export function toRecordedJobExecution(row: UsageJobExecutionRow): UsageJobExecutionRecordedEvent {
  if (!row.recordedAt) throw new Error('Cannot publish an unrecorded Usage job execution');
  return {
    version: 1,
    ...toJobExecutionUsage(row),
    recordedAt: row.recordedAt.toISOString(),
  };
}

export function toJobExecutionUsage(
  row: UsageJobExecutionRow,
): import('@shipfox/api-usage-dto').JobExecutionUsageDto {
  return {
    jobExecutionId: row.jobExecutionId,
    jobId: row.jobId,
    workflowRunId: row.workflowRunId,
    workflowRunAttemptId: row.workflowRunAttemptId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    definitionId: row.definitionId,
    jobKey: row.jobKey,
    runNumber: row.runNumber,
    requestedLabels: row.requestedLabels,
    runnerLabels: row.runnerLabels,
    templateKey: row.templateKey,
    provisionerId: row.provisionerId,
    provisionerScope: row.provisionerScope,
    providerKind: row.providerKind,
    launchKind: row.launchKind,
    runnerClass: row.runnerClass,
    runnerArch: row.runnerArch,
    runnerCpu: row.runnerCpu,
    managed: row.managed,
    queuedAt: iso(row.queuedAt),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    leaseExpiredAt: iso(row.leaseExpiredAt),
    status: row.status,
    statusReason: row.statusReason,
    cancellationReason: row.cancellationReason,
    durationSeconds: row.durationSeconds,
    state: row.state,
    recordedAt: iso(row.recordedAt),
  };
}

function eventIdentity(payload: JobExecutionEventIdentity): JobExecutionEventIdentity {
  return {
    jobExecutionId: payload.jobExecutionId,
    jobId: payload.jobId,
    workflowRunId: payload.workflowRunId,
    workflowRunAttemptId: payload.workflowRunAttemptId,
  };
}

async function loadJobExecution(
  tx: Transaction,
  jobExecutionId: string,
): Promise<UsageJobExecutionRow | null> {
  const [row] = await tx
    .select()
    .from(usageJobExecutions)
    .where(eq(usageJobExecutions.jobExecutionId, jobExecutionId));
  return row ?? null;
}

async function lockJobExecution(tx: Transaction, jobExecutionId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${jobExecutionId}))`);
}

function assertIdentity(row: UsageJobExecutionRow, identity: JobExecutionEventIdentity): void {
  if (
    row.jobId !== identity.jobId ||
    row.workflowRunId !== identity.workflowRunId ||
    row.workflowRunAttemptId !== identity.workflowRunAttemptId
  ) {
    throw new Error(`Usage job execution identity mismatch for ${identity.jobExecutionId}`);
  }
}

function durationSeconds(startedAt: Date | null, finishedAt: Date | null): number | null {
  if (!startedAt || !finishedAt) return null;
  return Math.max(0, (finishedAt.getTime() - startedAt.getTime()) / 1_000);
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function toDate(value: string | null | undefined): Date | null {
  return value ? new Date(value) : null;
}

function firstValue<T>(current: T | null | undefined, incoming: T | null | undefined): T | null {
  return current ?? incoming ?? null;
}

function preferValue<T>(current: T | null | undefined, incoming: T): T {
  return current ?? incoming;
}
