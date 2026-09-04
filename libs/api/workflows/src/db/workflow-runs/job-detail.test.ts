import {
  WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES,
  WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES,
} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {diagnosticValueByteLength} from '#core/diagnostics.js';
import type {WorkflowExecutionEvent} from '#core/entities/job-execution.js';
import {createHighCardinalityWorkflowRun} from '#test/index.js';
import {db} from '../db.js';
import {jobExecutions} from '../schema/job-executions.js';
import {jobListenerEvents} from '../schema/job-listener-events.js';
import {jobs} from '../schema/jobs.js';
import {stepAttempts} from '../schema/step-attempts.js';
import {steps} from '../schema/steps.js';
import {
  getExecutionTriggerEvent,
  getWorkflowJobDetail,
  getWorkflowJobExecutionContext,
  listExecutionTriggerEvents,
  listWorkflowExecutionSteps,
  listWorkflowJobExecutionSummaries,
  listWorkflowStepAttemptSummaries,
} from '../workflow-runs.js';

async function insertConsumedListenerEvent(params: {
  jobId: string;
  executionId: string;
  eventRef: string;
  receivedAt: Date;
  payload?: unknown;
  disposition?: 'fire' | 'resolve';
  outcome?: 'pending' | 'consumed' | 'honored' | 'rejected' | 'abandoned';
  outcomeReason?: 'payload_too_large' | 'until' | 'timeout' | 'max_executions' | 'cancelled' | null;
  storedPayloadBytes?: number;
  normalizedEventBytes?: number;
  triggerReference?: {
    project: {id: string} | null;
    repository: string | null;
    ref: string | null;
    commit: string | null;
    actor: string | null;
  } | null;
}) {
  const payload = params.payload ?? {action: 'opened'};
  const normalizedEvent = {
    source: 'github',
    event: 'pull_request',
    delivery_id: `delivery-${params.eventRef}`,
    received_at: params.receivedAt.toISOString(),
    project: params.triggerReference?.project ?? null,
    repository: params.triggerReference?.repository ?? null,
    ref: params.triggerReference?.ref ?? null,
    commit: params.triggerReference?.commit ?? null,
    data: payload,
  } satisfies WorkflowExecutionEvent;

  await db()
    .insert(jobListenerEvents)
    .values({
      jobId: params.jobId,
      disposition: params.disposition ?? 'fire',
      outcome: params.outcome ?? 'consumed',
      outcomeReason: params.outcomeReason ?? null,
      eventRef: params.eventRef,
      deliveryId: normalizedEvent.delivery_id,
      source: normalizedEvent.source,
      event: normalizedEvent.event,
      triggerReference: params.triggerReference ?? null,
      payload,
      storedPayloadBytes: params.storedPayloadBytes ?? diagnosticValueByteLength(payload),
      normalizedEventBytes:
        params.normalizedEventBytes ?? diagnosticValueByteLength([normalizedEvent]),
      receivedAt: params.receivedAt,
      consumedByExecutionId: params.executionId,
    });
}

describe('selected workflow job reads', () => {
  test('selects the active execution and embeds bounded step-attempt previews', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 2,
      attemptsPerStep: 12,
    });

    const detail = await getWorkflowJobDetail({jobId: fixture.jobIds[0] as string});

    expect(detail?.job.id).toBe(fixture.jobIds[0]);
    expect(detail?.selectedExecution?.id).toBe(fixture.executionIds[0]);
    expect(detail?.selectedExecution?.sequence).toBe(1);
    expect(detail?.selectedExecution?.steps.total).toBe(2);
    expect(detail?.selectedExecution?.steps.items).toHaveLength(2);
    expect(
      detail?.selectedExecution?.steps.items[0]?.attempts.items.map((item) => item.attempt),
    ).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    expect(detail?.selectedExecution?.steps.items[0]?.attempts.total).toBe(12);
    expect(detail?.selectedExecution?.steps.items[0]?.attempts.nextCursor).not.toBeNull();
    expect(detail?.selectedExecution?.steps.items[0]).not.toHaveProperty('job');
    expect(detail?.selectedExecution).not.toHaveProperty('outputs');
  });

  test('lists canonical execution events newest first with a stable timestamp/id cursor', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const firstReceivedAt = new Date('2026-08-31T12:00:00.000Z');
    const secondReceivedAt = new Date('2026-08-31T12:01:00.000Z');
    const thirdReceivedAt = new Date('2026-08-31T12:02:00.000Z');

    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-1',
      receivedAt: firstReceivedAt,
    });
    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-2',
      receivedAt: secondReceivedAt,
    });
    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-3',
      receivedAt: thirdReceivedAt,
    });

    const firstPage = await listExecutionTriggerEvents({jobId, executionId, limit: 2});
    expect(firstPage?.items.map((item) => item.eventRef)).toEqual(['event-3', 'event-2']);
    expect(firstPage?.items[0]).not.toHaveProperty('payload');
    expect(firstPage?.total).toBe(3);
    expect(firstPage?.nextCursor).toEqual({
      createdAt: secondReceivedAt,
      id: expect.any(String),
    });

    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-4',
      receivedAt: new Date('2026-08-31T12:03:00.000Z'),
    });
    const continuation = await listExecutionTriggerEvents({
      jobId,
      executionId,
      limit: 2,
      cursor: firstPage?.nextCursor ?? undefined,
    });
    expect(continuation?.items.map((item) => item.eventRef)).toEqual(['event-1']);
    expect(continuation?.total).toBeUndefined();
  });

  test('returns one bounded canonical event detail and preserves execution ancestry', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 2,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const otherJobId = fixture.jobIds[1] as string;
    const otherExecutionId = fixture.executionIds[1] as string;
    const receivedAt = new Date('2026-08-31T12:00:00.000Z');
    const triggerReference = {
      project: {id: crypto.randomUUID()},
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: 'a'.repeat(40),
      actor: 'octocat',
    };
    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-detail',
      receivedAt,
      payload: {action: 'opened'},
      triggerReference,
    });

    const detail = await getExecutionTriggerEvent({
      jobId,
      executionId,
      eventRef: 'event-detail',
    });
    expect(detail).toMatchObject({
      eventRef: 'event-detail',
      deliveryId: 'delivery-event-detail',
      source: 'github',
      event: 'pull_request',
      payload: {action: 'opened'},
      receivedAt,
    });
    expect(
      await getExecutionTriggerEvent({
        jobId: otherJobId,
        executionId,
        eventRef: 'event-detail',
      }),
    ).toBeUndefined();
    expect(
      await getExecutionTriggerEvent({
        jobId,
        executionId: otherExecutionId,
        eventRef: 'event-detail',
      }),
    ).toBeUndefined();
  });

  test('does not hydrate an oversized canonical event payload on detail reads', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const storedPayloadBytes = WORKFLOW_EXECUTION_TRIGGER_EVENT_PREVIEW_MAX_BYTES + 1;
    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-large',
      receivedAt: new Date('2026-08-31T12:00:00.000Z'),
      payload: {body: 'x'.repeat(storedPayloadBytes)},
      storedPayloadBytes,
    });

    const detail = await getExecutionTriggerEvent({
      jobId,
      executionId,
      eventRef: 'event-large',
    });
    expect(detail?.storedPayloadBytes).toBe(storedPayloadBytes);
    expect(detail?.payload).toBeNull();
  });

  test('reads canonical events for materialized executions and falls back to legacy arrays', async () => {
    const canonicalFixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const canonicalJobId = canonicalFixture.jobIds[0] as string;
    const canonicalExecutionId = canonicalFixture.executionIds[0] as string;
    const canonicalReceivedAt = new Date('2026-08-31T12:00:00.000Z');
    const canonicalReference = {
      project: {id: crypto.randomUUID()},
      repository: 'acme/api',
      ref: 'refs/heads/main',
      commit: 'b'.repeat(40),
      actor: 'octocat',
    };
    await insertConsumedListenerEvent({
      jobId: canonicalJobId,
      executionId: canonicalExecutionId,
      eventRef: 'event-canonical',
      receivedAt: canonicalReceivedAt,
      payload: {action: 'opened'},
      triggerReference: canonicalReference,
    });

    const canonicalContext = await getWorkflowJobExecutionContext({
      jobId: canonicalJobId,
      executionId: canonicalExecutionId,
    });
    expect(canonicalContext?.triggerEvents).toEqual([
      {
        source: 'github',
        event: 'pull_request',
        delivery_id: 'delivery-event-canonical',
        received_at: canonicalReceivedAt.toISOString(),
        project: canonicalReference.project,
        repository: canonicalReference.repository,
        ref: canonicalReference.ref,
        commit: canonicalReference.commit,
        data: {action: 'opened'},
      },
    ]);
    expect(canonicalContext?.triggerEventsBytes).toBeGreaterThan(0);

    const legacyFixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const legacyJobId = legacyFixture.jobIds[0] as string;
    const legacyExecutionId = legacyFixture.executionIds[0] as string;
    const legacyEvent: WorkflowExecutionEvent = {
      source: 'legacy',
      event: 'push',
      delivery_id: 'legacy-delivery',
      received_at: '2026-08-31T12:00:00.000Z',
      project: null,
      repository: null,
      ref: null,
      commit: null,
      data: {legacy: true},
    };
    await db()
      .update(jobExecutions)
      .set({triggerEvents: [legacyEvent]})
      .where(eq(jobExecutions.id, legacyExecutionId));

    const legacyContext = await getWorkflowJobExecutionContext({
      jobId: legacyJobId,
      executionId: legacyExecutionId,
    });
    expect(legacyContext?.triggerEvents).toEqual([legacyEvent]);
    expect(legacyContext?.triggerEventsBytes).toBeGreaterThan(0);
  });

  test('keeps canonical context bounded by normalized event bytes', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    await insertConsumedListenerEvent({
      jobId,
      executionId,
      eventRef: 'event-oversized-context',
      receivedAt: new Date('2026-08-31T12:00:00.000Z'),
      normalizedEventBytes: WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES + 1,
    });

    const context = await getWorkflowJobExecutionContext({jobId, executionId});
    expect(context?.triggerEvents).toBeNull();
    expect(context?.triggerEventsBytes).toBe(WORKFLOW_DIAGNOSTIC_TRIGGER_EVENTS_MAX_BYTES + 1);
  });

  test('pages executions, steps, and attempts with stable composite cursors', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 3,
      attemptsPerStep: 3,
    });
    const jobId = fixture.jobIds[0] as string;
    const executionId = fixture.executionIds[0] as string;
    const stepId = fixture.stepIds[0] as string;

    const executions = await listWorkflowJobExecutionSummaries({jobId, limit: 2});
    expect(executions?.items.map((item) => item.sequence)).toEqual([3, 2]);
    expect(executions?.total).toBe(3);
    expect(executions?.nextCursor).not.toBeNull();

    const executionContinuation = await listWorkflowJobExecutionSummaries({
      jobId,
      limit: 2,
      cursor: executions?.nextCursor ?? undefined,
    });
    expect(executionContinuation?.items.map((item) => item.sequence)).toEqual([1]);
    expect(executionContinuation?.total).toBeUndefined();

    const steps = await listWorkflowExecutionSteps({jobId, executionId, limit: 2});
    expect(steps?.items.map((item) => item.position)).toEqual([0, 1]);
    expect(steps?.total).toBe(3);
    expect(steps?.nextCursor).not.toBeNull();

    const stepContinuation = await listWorkflowExecutionSteps({
      jobId,
      executionId,
      limit: 2,
      cursor: steps?.nextCursor ?? undefined,
    });
    expect(stepContinuation?.items.map((item) => item.position)).toEqual([2]);
    expect(stepContinuation?.total).toBeUndefined();

    const attempts = await listWorkflowStepAttemptSummaries({stepId, limit: 2});
    expect(attempts?.items.map((item) => item.attempt)).toEqual([3, 2]);
    expect(attempts?.total).toBe(3);
    expect(attempts?.nextCursor).not.toBeNull();

    const attemptContinuation = await listWorkflowStepAttemptSummaries({
      stepId,
      limit: 2,
      cursor: attempts?.nextCursor ?? undefined,
    });
    expect(attemptContinuation?.items.map((item) => item.attempt)).toEqual([1]);
    expect(attemptContinuation?.total).toBeUndefined();
  });

  test('does not let newer inserts reappear before a continuation cursor', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 3,
      stepsPerExecution: 1,
      attemptsPerStep: 3,
    });
    const jobId = fixture.jobIds[0] as string;

    const firstExecutionPage = await listWorkflowJobExecutionSummaries({jobId, limit: 1});
    await db().insert(jobExecutions).values({
      jobId,
      sequence: 4,
      status: 'succeeded',
      triggerEvents: [],
      updatedAt: new Date(),
    });

    const nextExecutionPage = await listWorkflowJobExecutionSummaries({
      jobId,
      limit: 1,
      cursor: firstExecutionPage?.nextCursor ?? undefined,
    });
    expect(firstExecutionPage?.items[0]?.sequence).toBe(3);
    expect(nextExecutionPage?.items[0]?.sequence).toBe(2);
  });

  test('returns undefined for mismatched execution and step ancestry', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 2,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });

    await expect(
      listWorkflowExecutionSteps({
        jobId: fixture.jobIds[0] as string,
        executionId: fixture.executionIds[1] as string,
        limit: 10,
      }),
    ).resolves.toBeUndefined();

    await expect(
      getWorkflowJobDetail({
        jobId: fixture.jobIds[0] as string,
        executionId: fixture.executionIds[1] as string,
      }),
    ).resolves.toBeUndefined();

    await expect(
      listWorkflowStepAttemptSummaries({
        stepId: crypto.randomUUID(),
        limit: 10,
      }),
    ).resolves.toBeUndefined();
  });

  test('keeps attempt pagination stable when a newer attempt is inserted', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 1,
      stepsPerExecution: 1,
      attemptsPerStep: 3,
    });
    const stepId = fixture.stepIds[0] as string;
    const executionId = fixture.executionIds[0] as string;

    const firstPage = await listWorkflowStepAttemptSummaries({stepId, limit: 1});
    const [stepAttempt] = await db()
      .select({id: stepAttempts.id})
      .from(stepAttempts)
      .where(eq(stepAttempts.stepId, stepId))
      .limit(1);
    expect(stepAttempt).toBeDefined();
    await db().insert(stepAttempts).values({
      stepId,
      jobExecutionId: executionId,
      attempt: 4,
      executionOrder: 4,
      status: 'succeeded',
      invocations: [],
    });

    const continuation = await listWorkflowStepAttemptSummaries({
      stepId,
      limit: 1,
      cursor: firstPage?.nextCursor ?? undefined,
    });
    expect(firstPage?.items[0]?.attempt).toBe(3);
    expect(continuation?.items[0]?.attempt).toBe(2);
  });

  test('returns an empty selection and empty nested history pages', async () => {
    const fixture = await createHighCardinalityWorkflowRun({
      jobs: 1,
      dependenciesPerJob: 0,
      executionsPerJob: 2,
      stepsPerExecution: 1,
      attemptsPerStep: 1,
    });
    const jobId = fixture.jobIds[0] as string;
    const firstExecutionId = fixture.executionIds[0] as string;
    const secondExecutionId = fixture.executionIds[1] as string;
    const emptyJobId = crypto.randomUUID();
    const emptyStepId = crypto.randomUUID();

    await db().insert(jobs).values({
      id: emptyJobId,
      workflowRunAttemptId: fixture.workflowRunAttemptId,
      key: 'empty-job',
      checkoutPersistCredentials: true,
      checkoutPermissionsContents: 'read',
      dependencies: [],
      position: 10,
    });

    const emptyJobDetail = await getWorkflowJobDetail({jobId: emptyJobId});
    expect(emptyJobDetail?.selectedExecution).toBeNull();

    const explicitDetail = await getWorkflowJobDetail({
      jobId,
      executionId: secondExecutionId,
    });
    expect(explicitDetail?.selectedExecution?.id).toBe(secondExecutionId);
    expect(explicitDetail?.selectedExecution?.sequence).toBe(2);

    await db().insert(steps).values({
      id: emptyStepId,
      jobExecutionId: firstExecutionId,
      key: 'empty-step',
      name: 'Empty step',
      type: 'run',
      config: {},
      position: 10,
    });
    const detailWithEmptyStep = await getWorkflowJobDetail({jobId});
    expect(
      detailWithEmptyStep?.selectedExecution?.steps.items.find((step) => step.id === emptyStepId)
        ?.attempts,
    ).toEqual({items: [], nextCursor: null, total: 0});
  });
});
