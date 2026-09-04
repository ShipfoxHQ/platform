import type {RunnerJobClaimedEvent, RunnerJobLeaseExpiredEvent} from '@shipfox/api-runners-dto';
import type {
  WorkflowsJobExecutionQueuedEventDto,
  WorkflowsJobExecutionTerminatedEventDto,
} from '@shipfox/api-workflows-dto';
import {eq, sql} from 'drizzle-orm';
import {db} from './db.js';
import {
  listInferenceSegments,
  recordInferenceSegments,
  toInferenceSegmentUsage,
} from './inference-segments.js';
import {
  getJobExecutionUsage,
  listJobExecutionUsage,
  recordJobExecutionClaimed,
  recordJobExecutionLeaseExpired,
  recordJobExecutionQueued,
  recordJobExecutionTerminated,
} from './job-executions.js';
import {dropExpiredUsagePartitions} from './retention.js';
import {usageOutbox} from './schema/outbox.js';

const monthlyPartitionPattern = /usage_(job_executions|inference_segments)_\d{4}_\d{2}/;

interface JobEventSet {
  queued: WorkflowsJobExecutionQueuedEventDto;
  claimed: RunnerJobClaimedEvent;
  leaseExpired: RunnerJobLeaseExpiredEvent;
  terminated: WorkflowsJobExecutionTerminatedEventDto;
}

function jobEvents(): JobEventSet {
  const workspaceId = crypto.randomUUID();
  const projectId = crypto.randomUUID();
  const workflowRunId = crypto.randomUUID();
  const workflowRunAttemptId = crypto.randomUUID();
  const jobId = crypto.randomUUID();
  const jobExecutionId = crypto.randomUUID();
  const definitionId = crypto.randomUUID();
  const queuedAt = '2026-09-04T10:00:00.000Z';
  const startedAt = '2026-09-04T10:00:01.000Z';
  const finishedAt = '2026-09-04T10:00:11.000Z';

  return {
    queued: {
      workspaceId,
      projectId,
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      definitionId,
      jobKey: 'build',
      runNumber: 2,
      requiredLabels: ['linux'],
      queuedAt,
    },
    claimed: {
      workspaceId,
      projectId,
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      claimedAt: startedAt,
      runnerLabels: ['arch.x64', 'class.standard', 'cpu.2', 'linux', 'shipfox-managed'],
      templateKey: 'standard',
      provisionerId: crypto.randomUUID(),
      provisionerScope: 'installation',
      providerKind: 'aws',
      launchKind: 'demand',
    },
    leaseExpired: {
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      expiredAt: '2026-09-04T10:00:05.000Z',
    },
    terminated: {
      workspaceId,
      projectId,
      definitionId,
      jobKey: 'build',
      workflowRunId,
      workflowRunAttemptId,
      jobId,
      jobExecutionId,
      status: 'succeeded',
      statusReason: null,
      cancellationReason: null,
      finishedAt,
      startedAt,
      queuedAt,
      runnerLabels: ['arch.x64', 'class.standard', 'cpu.2', 'linux', 'shipfox-managed'],
      templateKey: 'standard',
      provisionerId: null,
      provisionerScope: 'installation',
      providerKind: 'aws',
      launchKind: 'demand',
    },
  };
}

function inferenceSegment(workspaceId = crypto.randomUUID()) {
  return {
    segmentKey: `gateway:${crypto.randomUUID()}`,
    source: 'gateway' as const,
    workspaceId,
    projectId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    jobExecutionId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    stepAttemptId: crypto.randomUUID(),
    upstream: 'openai',
    model: 'gpt-5',
    dialect: 'openai-responses' as const,
    windowStart: '2026-09-04T10:00:00.000Z',
    windowEnd: '2026-09-04T10:01:00.000Z',
    requestCount: 2,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 0,
    cacheReadTokens: 4,
    reasoningTokens: 6,
  };
}

async function outboxFor(eventType: string, field: 'jobExecutionId' | 'segmentKey', value: string) {
  const rows = await db().select().from(usageOutbox).where(eq(usageOutbox.eventType, eventType));
  return rows.filter((row) => {
    const payload = row.payload as Record<string, unknown>;
    return payload[field] === value;
  });
}

describe('Usage projections', () => {
  it.each([
    [
      'queued, claimed, lease expiry, terminated',
      ['queued', 'claimed', 'leaseExpired', 'terminated'],
    ],
    [
      'claimed, queued, terminated, lease expiry',
      ['claimed', 'queued', 'terminated', 'leaseExpired'],
    ],
    [
      'lease expiry, terminated, queued, claimed',
      ['leaseExpired', 'terminated', 'queued', 'claimed'],
    ],
  ] as const)('converges for the %s arrival order', async (_name, order) => {
    const events = jobEvents();
    const steps = {
      queued: () => recordJobExecutionQueued(events.queued),
      claimed: () => recordJobExecutionClaimed(events.claimed),
      leaseExpired: () => recordJobExecutionLeaseExpired(events.leaseExpired),
      terminated: () => recordJobExecutionTerminated(events.terminated),
    };

    for (const step of order) await steps[step]();

    const row = await getJobExecutionUsage({
      workspaceId: events.queued.workspaceId,
      jobExecutionId: events.queued.jobExecutionId,
    });
    expect(row).not.toBeNull();
    expect(row?.state).toBe('terminated');
    expect(row?.status).toBe('succeeded');
    expect(row?.runnerClass).toBe('standard');
    expect(row?.runnerArch).toBe('x64');
    expect(row?.runnerCpu).toBe('2');
    expect(row?.managed).toBe(true);
    expect(row?.leaseExpiredAt?.toISOString()).toBe('2026-09-04T10:00:05.000Z');
    expect(row?.durationSeconds).toBe(10);
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.queued.jobExecutionId,
      ),
    ).toHaveLength(1);

    const duplicate = await recordJobExecutionTerminated(events.terminated);
    expect(duplicate.published).toBe(false);
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.queued.jobExecutionId,
      ),
    ).toHaveLength(1);
  });

  it('serializes concurrent terminal deliveries and publishes one durable snapshot', async () => {
    const events = jobEvents();
    await recordJobExecutionQueued(events.queued);
    const results = await Promise.all([
      recordJobExecutionTerminated(events.terminated),
      recordJobExecutionTerminated(events.terminated),
    ]);

    expect(results.filter((result) => result.published)).toHaveLength(1);
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.terminated.jobExecutionId,
      ),
    ).toHaveLength(1);
  });

  it('defers terminal publication until the queued projection fills its fields', async () => {
    const events = jobEvents();

    await expect(recordJobExecutionTerminated(events.terminated)).resolves.toMatchObject({
      published: false,
      deferred: true,
    });
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.terminated.jobExecutionId,
      ),
    ).toHaveLength(0);

    await expect(recordJobExecutionQueued(events.queued)).resolves.toMatchObject({
      published: true,
      deferred: false,
    });
    const row = await getJobExecutionUsage({
      workspaceId: events.queued.workspaceId,
      jobExecutionId: events.queued.jobExecutionId,
    });
    expect(row).toMatchObject({requestedLabels: ['linux'], runNumber: 2, state: 'terminated'});
    expect(
      await outboxFor(
        'usage.job_execution.recorded',
        'jobExecutionId',
        events.terminated.jobExecutionId,
      ),
    ).toHaveLength(1);
  });

  it('defers legacy terminal events that omit queuedAt', async () => {
    const events = jobEvents();
    const legacyTerminated = {...events.terminated, queuedAt: undefined};

    await expect(recordJobExecutionTerminated(legacyTerminated)).resolves.toMatchObject({
      published: false,
      deferred: true,
    });
    await expect(recordJobExecutionQueued(events.queued)).resolves.toMatchObject({
      published: true,
    });
  });

  it('recomputes duration when a late claim supplies the missing start time', async () => {
    const events = jobEvents();
    events.terminated.startedAt = null;

    await recordJobExecutionTerminated(events.terminated);
    expect(
      (
        await getJobExecutionUsage({
          workspaceId: events.queued.workspaceId,
          jobExecutionId: events.terminated.jobExecutionId,
        })
      )?.durationSeconds,
    ).toBeNull();

    await recordJobExecutionClaimed(events.claimed);
    const row = await getJobExecutionUsage({
      workspaceId: events.queued.workspaceId,
      jobExecutionId: events.terminated.jobExecutionId,
    });
    expect(row?.startedAt?.toISOString()).toBe(events.claimed.claimedAt);
    expect(row?.durationSeconds).toBe(10);
  });

  it('records inference segments idempotently and exposes replay cursors', async () => {
    const workspaceId = crypto.randomUUID();
    const first = inferenceSegment(workspaceId);
    const second = inferenceSegment(workspaceId);
    const recordedAt = new Date('2026-09-04T10:05:00.000Z');

    await expect(
      recordInferenceSegments({segments: [first, second], now: recordedAt}),
    ).resolves.toEqual({
      recorded: 2,
      duplicates: 0,
    });
    await expect(recordInferenceSegments({segments: [first], now: recordedAt})).resolves.toEqual({
      recorded: 0,
      duplicates: 1,
    });
    expect(
      await outboxFor('usage.inference_segment.recorded', 'segmentKey', first.segmentKey),
    ).toHaveLength(1);

    const page = await listInferenceSegments({workspaceId, limit: 1});
    expect(page.segments).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const cursor = page.nextCursor;
    if (!cursor) throw new Error('Expected an inference replay cursor');
    const nextPage = await listInferenceSegments({workspaceId, cursor, limit: 1});
    expect(nextPage.segments).toHaveLength(1);
    expect(nextPage.nextCursor).toBeNull();
    const firstSegment = page.segments[0];
    if (!firstSegment) throw new Error('Expected a first inference segment');
    expect(toInferenceSegmentUsage(firstSegment)).toMatchObject({workspaceId});
  });

  it('replays terminal job executions by a stable timestamp and id cursor', async () => {
    const first = jobEvents();
    const second = jobEvents();
    second.queued.workspaceId = first.queued.workspaceId;
    second.queued.projectId = first.queued.projectId;
    second.terminated.workspaceId = first.terminated.workspaceId;
    second.terminated.projectId = first.terminated.projectId;
    await recordJobExecutionQueued(first.queued);
    await recordJobExecutionQueued(second.queued);
    await Promise.all([
      recordJobExecutionTerminated(first.terminated),
      recordJobExecutionTerminated(second.terminated),
    ]);

    const page = await listJobExecutionUsage({workspaceId: first.queued.workspaceId, limit: 1});
    expect(page.jobExecutions).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const cursor = page.nextCursor;
    if (!cursor) throw new Error('Expected a job execution replay cursor');
    const nextPage = await listJobExecutionUsage({
      workspaceId: first.queued.workspaceId,
      cursor,
      limit: 1,
    });
    expect(nextPage.jobExecutions).toHaveLength(1);
    expect(nextPage.nextCursor).toBeNull();
  });

  it('creates monthly range children and drops only expired complete months', async () => {
    const partitions = await db().execute(sql`
      select count(*)::int as count
      from pg_inherits
      join pg_class parent on parent.oid = pg_inherits.inhparent
      where parent.relname = ${'usage_job_executions'}
         or parent.relname = ${'usage_inference_segments'}
    `);
    expect(Number(partitions.rows[0]?.count)).toBeGreaterThan(200);

    const future = inferenceSegment();
    await recordInferenceSegments({
      segments: [future],
      now: new Date('2032-02-15T00:00:00.000Z'),
    });
    const provisioned = await dropExpiredUsagePartitions({
      retentionDays: 100_000,
      now: new Date('2032-02-15T00:00:00.000Z'),
    });
    expect(provisioned.dropped).toBe(0);
    const futurePartition = await db().execute(sql`
      select tableoid::regclass::text as name
      from usage_inference_segments
      where segment_key = ${future.segmentKey}
    `);
    expect(futurePartition.rows[0]?.name).toBe('usage_inference_segments_2032_02');

    const result = await dropExpiredUsagePartitions({
      retentionDays: 29,
      now: new Date('2020-03-02T00:00:00.000Z'),
    });
    expect(result.dropped).toBeGreaterThan(0);
    expect(result.partitions).toEqual(
      expect.arrayContaining(['usage_job_executions_2020_01', 'usage_inference_segments_2020_01']),
    );
    expect(result.partitions).not.toContain('usage_job_executions_2020_02');
    expect(result.partitions).not.toContain('usage_inference_segments_2020_02');
    expect(result.partitions.every((name) => monthlyPartitionPattern.test(name))).toBe(true);
  });
});
