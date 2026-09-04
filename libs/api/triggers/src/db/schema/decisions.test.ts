import {eq} from 'drizzle-orm';
import {getTableConfig} from 'drizzle-orm/pg-core';
import {db} from '../db.js';
import {
  type TriggerDecisionDb,
  type TriggerDecisionInsertDb,
  toTriggerDecision,
  triggersDecisions,
} from './decisions.js';
import {triggersReceivedEvents} from './received-events.js';

describe('toTriggerDecision', () => {
  test('maps a fully populated row to the domain entity', () => {
    const row: TriggerDecisionDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionKind: 'trigger',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '019e98ab-b90f-7265-b13c-8b441c991383',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991384',
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'triggered',
      runId: '019e98ab-b90f-7265-b13c-8b441c991385',
      runName: 'Build and test',
      reason: null,
      diagnostic: null,
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    };

    const result = toTriggerDecision(row);

    expect(result).toEqual({
      id: row.id,
      receivedEventId: row.receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: row.subscriptionId,
      subscriptionName: 'Deploy production',
      workflowDefinitionId: row.workflowDefinitionId,
      projectId: row.projectId,
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'triggered',
      runId: row.runId,
      runName: 'Build and test',
      reason: null,
      diagnostic: null,
      createdAt: row.createdAt,
    });
  });

  test('passes through null run_id, run_name, and a populated reason', () => {
    const row: TriggerDecisionDb = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionKind: 'trigger',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '019e98ab-b90f-7265-b13c-8b441c991383',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991384',
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'dispatch-error',
      runId: null,
      runName: null,
      reason: 'runWorkflow threw',
      diagnostic: null,
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    };

    const result = toTriggerDecision(row);

    expect(result.decision).toBe('dispatch-error');
    expect(result.runId).toBeNull();
    expect(result.runName).toBeNull();
    expect(result.reason).toBe('runWorkflow threw');
  });

  test('maps legacy errored rows to dispatch-error', () => {
    const row = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionKind: 'trigger',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'Deploy production',
      workflowDefinitionId: '019e98ab-b90f-7265-b13c-8b441c991383',
      projectId: '019e98ab-b90f-7265-b13c-8b441c991384',
      workflowRunId: null,
      jobId: null,
      matcherKind: null,
      matcherOrdinal: null,
      decision: 'errored',
      runId: null,
      runName: null,
      reason: 'runWorkflow threw',
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    } as unknown as TriggerDecisionDb;

    const result = toTriggerDecision(row);

    expect(result.decision).toBe('dispatch-error');
  });

  test('maps rejected rows to the rejected outcome', () => {
    const row = {
      id: '019e98ab-6656-7ca1-b9ad-1ca4442c479d',
      receivedEventId: '019e98ab-b90f-7265-b13c-8b441c991381',
      subscriptionKind: 'listener',
      subscriptionId: '019e98ab-b90f-7265-b13c-8b441c991382',
      subscriptionName: 'listener on[0] github/push',
      workflowDefinitionId: null,
      projectId: null,
      workflowRunId: '019e98ab-b90f-7265-b13c-8b441c991383',
      jobId: '019e98ab-b90f-7265-b13c-8b441c991384',
      matcherKind: 'on',
      matcherOrdinal: 0,
      decision: 'rejected',
      runId: null,
      runName: null,
      reason: 'payload-too-large',
      createdAt: new Date('2026-06-09T10:00:02.000Z'),
    } as unknown as TriggerDecisionDb;

    expect(toTriggerDecision(row).decision).toBe('rejected');
  });
});

describe('triggers_decisions schema', () => {
  async function insertEvent(): Promise<string> {
    const [event] = await db()
      .insert(triggersReceivedEvents)
      .values({
        eventRef: crypto.randomUUID(),
        origin: 'integration',
        workspaceId: crypto.randomUUID(),
        source: 'github',
        event: 'push',
        receivedAt: new Date(),
      })
      .returning();
    if (!event) throw new Error('insert returned no rows');
    return event.id;
  }

  test('applies defaults and maps an inserted row', async () => {
    const receivedEventId = await insertEvent();
    const values: TriggerDecisionInsertDb = {
      receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    };

    const [inserted] = await db()
      .insert(triggersDecisions)
      .values(values)
      .returning({id: triggersDecisions.id});
    if (!inserted) throw new Error('insert returned no rows');
    const [row] = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.id, inserted.id));
    if (!row) throw new Error('select returned no rows');
    const result = toTriggerDecision(row);

    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.runId).toBeNull();
    expect(row.runName).toBeNull();
    expect(row.reason).toBeNull();
    expect(result).toMatchObject({
      receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: values.subscriptionId,
      subscriptionName: 'Deploy production',
      workflowDefinitionId: values.workflowDefinitionId,
      projectId: values.projectId,
      decision: 'triggered',
    });
  });

  test('cascades decision deletes when the parent event is removed', async () => {
    const receivedEventId = await insertEvent();
    await db().insert(triggersDecisions).values({
      receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    });

    await db().delete(triggersReceivedEvents).where(eq(triggersReceivedEvents.id, receivedEventId));

    const rows = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.receivedEventId, receivedEventId));
    expect(rows).toHaveLength(0);
  });

  test('rejects a duplicate (received_event_id, subscription_kind, subscription_id)', async () => {
    const receivedEventId = await insertEvent();
    const values: TriggerDecisionInsertDb = {
      receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: crypto.randomUUID(),
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    };
    await db().insert(triggersDecisions).values(values);

    const duplicate = db().insert(triggersDecisions).values(values);

    await expect(duplicate).rejects.toThrow();
  });

  test('stores a dev decision with a null subscription id', async () => {
    const receivedEventId = await insertEvent();
    const [inserted] = await db()
      .insert(triggersDecisions)
      .values({
        receivedEventId,
        subscriptionKind: 'dev',
        subscriptionId: null,
        subscriptionName: 'on_issue',
        workflowDefinitionId: crypto.randomUUID(),
        decision: 'triggered',
        runId: crypto.randomUUID(),
        runName: 'Dev run',
      })
      .returning({id: triggersDecisions.id});
    if (!inserted) throw new Error('insert returned no rows');
    const [row] = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.id, inserted.id));
    if (!row) throw new Error('select returned no rows');

    expect(row.subscriptionKind).toBe('dev');
    expect(row.subscriptionId).toBeNull();
    expect(row.subscriptionName).toBe('on_issue');
    expect(row.runId).not.toBeNull();
    expect(row.runName).toBe('Dev run');
    expect(toTriggerDecision(row)).toMatchObject({
      subscriptionKind: 'dev',
      subscriptionId: null,
      decision: 'triggered',
    });
  });

  test('the dev decision index rejects a second decision for the same event', async () => {
    const receivedEventId = await insertEvent();
    await db().insert(triggersDecisions).values({
      receivedEventId,
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_issue',
      workflowDefinitionId: crypto.randomUUID(),
      decision: 'triggered',
      runId: crypto.randomUUID(),
      runName: 'Dev run',
    });
    await expect(
      db().insert(triggersDecisions).values({
        receivedEventId,
        subscriptionKind: 'dev',
        subscriptionId: null,
        subscriptionName: 'on_issue',
        workflowDefinitionId: crypto.randomUUID(),
        decision: 'filter-error',
        reason: 'filter is false',
      }),
    ).rejects.toThrow();
  });

  test('enforces subscription ids by decision kind', async () => {
    const receivedEventId = await insertEvent();

    await expect(
      db().insert(triggersDecisions).values({
        receivedEventId,
        subscriptionKind: 'trigger',
        subscriptionId: null,
        subscriptionName: 'Deploy production',
        workflowDefinitionId: crypto.randomUUID(),
        projectId: crypto.randomUUID(),
        decision: 'triggered',
      }),
    ).rejects.toThrow();

    await expect(
      db().insert(triggersDecisions).values({
        receivedEventId,
        subscriptionKind: 'dev',
        subscriptionId: crypto.randomUUID(),
        subscriptionName: 'on_issue',
        workflowDefinitionId: crypto.randomUUID(),
        decision: 'triggered',
      }),
    ).rejects.toThrow();
  });

  test('allows trigger and listener decisions with the same subscription id', async () => {
    const receivedEventId = await insertEvent();
    const subscriptionId = crypto.randomUUID();
    await db().insert(triggersDecisions).values({
      receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId,
      subscriptionName: 'Deploy production',
      workflowDefinitionId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      decision: 'triggered',
    });

    await db().insert(triggersDecisions).values({
      receivedEventId,
      subscriptionKind: 'listener',
      subscriptionId,
      subscriptionName: 'listener on[0] github/push',
      workflowRunId: crypto.randomUUID(),
      jobId: crypto.randomUUID(),
      matcherKind: 'on',
      matcherOrdinal: 0,
      decision: 'triggered',
    });

    const rows = await db()
      .select()
      .from(triggersDecisions)
      .where(eq(triggersDecisions.receivedEventId, receivedEventId));
    expect(rows).toHaveLength(2);
  });

  test('declares a database check for valid subscription kinds', () => {
    const checkNames = getTableConfig(triggersDecisions).checks.map((check) => check.name);

    expect(checkNames).toEqual(
      expect.arrayContaining([
        'triggers_decisions_subscription_kind_ck',
        'triggers_decisions_subscription_id_ck',
      ]),
    );
  });

  test('maps listener identity fields', async () => {
    const receivedEventId = await insertEvent();
    const workflowRunId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const [row] = await db()
      .insert(triggersDecisions)
      .values({
        receivedEventId,
        subscriptionKind: 'listener',
        subscriptionId: crypto.randomUUID(),
        subscriptionName: 'listener until[1] github/pull_request.closed',
        workflowRunId,
        jobId,
        matcherKind: 'until',
        matcherOrdinal: 1,
        decision: 'dispatch-error',
        reason: 'workflow db down',
      })
      .returning();
    if (!row) throw new Error('insert returned no rows');

    const result = toTriggerDecision(row);

    expect(result).toMatchObject({
      subscriptionKind: 'listener',
      workflowDefinitionId: null,
      projectId: null,
      workflowRunId,
      jobId,
      matcherKind: 'until',
      matcherOrdinal: 1,
      decision: 'dispatch-error',
      reason: 'workflow db down',
    });
  });
});
