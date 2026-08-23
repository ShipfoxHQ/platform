import {eq} from 'drizzle-orm';
import type {JobListenerSubscription} from '#core/entities/job-listener-subscription.js';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {db} from './db.js';
import {
  type InsertReceivedEventParams,
  insertReceivedEvent,
  markReceivedEventDiscarded,
  markReceivedEventErrored,
  markReceivedEventFailed,
  markReceivedEventRouted,
  upsertDevFilterErrorDecision,
  upsertDevTriggeredDecision,
  upsertDispatchErrorDecision,
  upsertFilterErrorDecision,
  upsertListenerDispatchErrorDecision,
  upsertListenerFilterErrorDecision,
  upsertListenerTriggeredDecision,
  upsertTriggeredDecision,
} from './event-history.js';
import {triggersDecisions} from './schema/decisions.js';
import {triggersReceivedEvents} from './schema/received-events.js';

function buildEventParams(
  overrides: Partial<InsertReceivedEventParams> = {},
): InsertReceivedEventParams {
  return {
    eventRef: crypto.randomUUID(),
    origin: 'integration',
    workspaceId: crypto.randomUUID(),
    provider: 'github',
    source: 'github',
    event: 'push',
    deliveryId: null,
    connectionId: null,
    connectionName: null,
    payload: null,
    receivedAt: new Date(),
    ...overrides,
  };
}

function buildSubscription(overrides: Partial<TriggerSubscription> = {}): TriggerSubscription {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowDefinitionId: crypto.randomUUID(),
    name: 'trigger',
    source: 'github',
    event: 'push',
    config: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildListenerSubscription(
  overrides: Partial<JobListenerSubscription> = {},
): JobListenerSubscription {
  return {
    id: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    jobId: crypto.randomUUID(),
    kind: 'on',
    matcherOrdinal: 0,
    source: 'github',
    event: 'push',
    config: {},
    createdAt: new Date(),
    ...overrides,
  };
}

function decisionsFor(receivedEventId: string) {
  return db()
    .select()
    .from(triggersDecisions)
    .where(eq(triggersDecisions.receivedEventId, receivedEventId));
}

describe('insertReceivedEvent', () => {
  it('inserts a received event and returns its id', async () => {
    const params = buildEventParams();

    const id = await insertReceivedEvent(params);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.eventRef).toBe(params.eventRef);
    expect(row?.provider).toBe('github');
    expect(row?.outcome).toBe('received');
    expect(row?.matchedCount).toBe(0);
  });

  it('returns the existing id on event_ref conflict (replay)', async () => {
    const params = buildEventParams();

    const first = await insertReceivedEvent(params);
    const second = await insertReceivedEvent(params);

    expect(second).toBe(first);
    const rows = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.eventRef, params.eventRef));
    expect(rows).toHaveLength(1);
  });
});

describe('received-event outcome transitions', () => {
  it('marks an event routed with matched_count and processed_at', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventRouted(id, 3);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.matchedCount).toBe(3);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('marks an event discarded with matched_count 0', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventDiscarded(id);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('discarded');
    expect(row?.matchedCount).toBe(0);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('does not downgrade a routed event to discarded', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventRouted(id, 1);

    await markReceivedEventDiscarded(id);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.matchedCount).toBe(1);
  });

  it('marks an event failed without setting processed_at (transient, retried)', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventFailed(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('failed');
    expect(row?.matchedCount).toBe(2);
    expect(row?.processedAt).toBeNull();
  });

  it('does not downgrade a routed event to failed (terminal success wins under a stale failed write)', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventRouted(id, 2);

    await markReceivedEventFailed(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('marks an event errored with processed_at when no run was created', async () => {
    const id = await insertReceivedEvent(buildEventParams());

    await markReceivedEventErrored(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('errored');
    expect(row?.matchedCount).toBe(2);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('promotes to routed instead of errored when a triggered decision exists (cross-attempt run)', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await upsertTriggeredDecision({
      receivedEventId: id,
      subscription: buildSubscription(),
      run: {id: crypto.randomUUID(), name: 'Build and test'},
    });

    await markReceivedEventErrored(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
    expect(row?.matchedCount).toBe(2);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('does not downgrade a routed event to errored', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventRouted(id, 1);

    await markReceivedEventErrored(id, 1);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('routed');
  });

  it('does not downgrade an errored event to failed (a late transient write loses)', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventErrored(id, 1);

    await markReceivedEventFailed(id, 1);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('errored');
    expect(row?.processedAt).toBeInstanceOf(Date);
  });

  it('promotes a transient failed event to errored on the all-permanent replay', async () => {
    const id = await insertReceivedEvent(buildEventParams());
    await markReceivedEventFailed(id, 2);

    await markReceivedEventErrored(id, 2);

    const [row] = await db()
      .select()
      .from(triggersReceivedEvents)
      .where(eq(triggersReceivedEvents.id, id));
    expect(row?.outcome).toBe('errored');
    expect(row?.matchedCount).toBe(2);
    expect(row?.processedAt).toBeInstanceOf(Date);
  });
});

describe('dev decision inserts', () => {
  it('records a dev triggered decision with a null subscription id', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const workflowDefinitionId = crypto.randomUUID();
    const run = {id: crypto.randomUUID(), name: 'Dev run'};

    await upsertDevTriggeredDecision({
      receivedEventId,
      triggerKey: 'on_issue',
      workflowDefinitionId,
      run,
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_issue',
      workflowDefinitionId,
      projectId: null,
      decision: 'triggered',
      runId: run.id,
      runName: run.name,
      reason: null,
    });
  });

  it('records a dev filter-error decision with the reason and no run', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const workflowDefinitionId = crypto.randomUUID();

    await upsertDevFilterErrorDecision({
      receivedEventId,
      triggerKey: 'on_push',
      workflowDefinitionId,
      reason: 'filter is false',
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subscriptionKind: 'dev',
      subscriptionId: null,
      subscriptionName: 'on_push',
      workflowDefinitionId,
      projectId: null,
      decision: 'filter-error',
      runId: null,
      runName: null,
      reason: 'filter is false',
    });
  });

  it('converges repeated dev triggered writes to one decision', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const workflowDefinitionId = crypto.randomUUID();
    const firstRun = {id: crypto.randomUUID(), name: 'First dev run'};
    const secondRun = {id: crypto.randomUUID(), name: 'Second dev run'};

    await upsertDevTriggeredDecision({
      receivedEventId,
      triggerKey: 'on_issue',
      workflowDefinitionId,
      run: firstRun,
    });
    await upsertDevTriggeredDecision({
      receivedEventId,
      triggerKey: 'on_issue',
      workflowDefinitionId,
      run: secondRun,
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: 'triggered',
      runId: secondRun.id,
      runName: secondRun.name,
    });
  });

  it('does not downgrade a dev triggered decision on a filter-error replay', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const workflowDefinitionId = crypto.randomUUID();
    const run = {id: crypto.randomUUID(), name: 'Dev run'};

    await upsertDevTriggeredDecision({
      receivedEventId,
      triggerKey: 'on_issue',
      workflowDefinitionId,
      run,
    });
    await upsertDevFilterErrorDecision({
      receivedEventId,
      triggerKey: 'on_issue',
      workflowDefinitionId,
      reason: 'late filter failure',
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      decision: 'triggered',
      runId: run.id,
      runName: run.name,
      reason: null,
    });
  });
});

describe('decision upserts', () => {
  it('is idempotent on (received_event_id, subscription_id)', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const renamedSubscription = buildSubscription({...subscription, name: 'renamed trigger'});
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    await upsertTriggeredDecision({receivedEventId, subscription, run});
    await upsertTriggeredDecision({receivedEventId, subscription: renamedSubscription, run});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscriptionKind).toBe('trigger');
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.subscriptionName).toBe(subscription.name);
    expect(rows[0]?.runId).toBe(run.id);
    expect(rows[0]?.runName).toBe(run.name);
  });

  it('flips a dispatch-error decision to triggered on a successful retry', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const renamedSubscription = buildSubscription({...subscription, name: 'renamed trigger'});
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    await upsertDispatchErrorDecision({receivedEventId, subscription, reason: 'boom'});
    await upsertTriggeredDecision({receivedEventId, subscription: renamedSubscription, run});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscriptionKind).toBe('trigger');
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.subscriptionName).toBe(subscription.name);
    expect(rows[0]?.runId).toBe(run.id);
    expect(rows[0]?.reason).toBeNull();
  });

  it('never downgrades an existing triggered decision to dispatch-error', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const renamedSubscription = buildSubscription({...subscription, name: 'renamed trigger'});
    const run = {id: crypto.randomUUID(), name: 'Build and test'};

    await upsertTriggeredDecision({receivedEventId, subscription, run});
    await upsertDispatchErrorDecision({
      receivedEventId,
      subscription: renamedSubscription,
      reason: 'definition deleted',
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscriptionKind).toBe('trigger');
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.subscriptionName).toBe(subscription.name);
    expect(rows[0]?.runId).toBe(run.id);
    expect(rows[0]?.reason).toBeNull();
  });

  it('preserves the original subscription name on dispatch-error replay', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();
    const renamedSubscription = buildSubscription({...subscription, name: 'renamed trigger'});

    await upsertDispatchErrorDecision({receivedEventId, subscription, reason: 'boom'});
    await upsertDispatchErrorDecision({
      receivedEventId,
      subscription: renamedSubscription,
      reason: 'still broken',
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscriptionKind).toBe('trigger');
    expect(rows[0]?.decision).toBe('dispatch-error');
    expect(rows[0]?.subscriptionName).toBe(subscription.name);
    expect(rows[0]?.reason).toBe('still broken');
  });

  it('records a filter-error decision', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildSubscription();

    await upsertFilterErrorDecision({
      receivedEventId,
      subscription,
      reason: 'Trigger filter evaluation failed',
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscriptionKind).toBe('trigger');
    expect(rows[0]?.decision).toBe('filter-error');
    expect(rows[0]?.reason).toBe('Trigger filter evaluation failed');
  });

  it('records a listener triggered decision with matcher identity', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildListenerSubscription({kind: 'until', matcherOrdinal: 2});

    await upsertListenerTriggeredDecision({receivedEventId, subscription});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      subscriptionKind: 'listener',
      subscriptionId: subscription.id,
      subscriptionName: 'listener until[2] github/push',
      workflowDefinitionId: null,
      projectId: null,
      workflowRunId: subscription.workflowRunId,
      jobId: subscription.jobId,
      matcherKind: 'until',
      matcherOrdinal: 2,
      decision: 'triggered',
      reason: null,
    });
  });

  it('names a NULL-event listener as a source wildcard', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildListenerSubscription({event: null});

    await upsertListenerTriggeredDecision({receivedEventId, subscription});

    const rows = await decisionsFor(receivedEventId);
    expect(rows[0]?.subscriptionName).toBe('listener on[0] github/*');
  });

  it('flips a listener dispatch-error decision to triggered on a successful retry', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildListenerSubscription();

    await upsertListenerDispatchErrorDecision({receivedEventId, subscription, reason: 'boom'});
    await upsertListenerTriggeredDecision({receivedEventId, subscription});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.reason).toBeNull();
  });

  it('never downgrades an existing listener triggered decision to dispatch-error', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildListenerSubscription();

    await upsertListenerTriggeredDecision({receivedEventId, subscription});
    await upsertListenerDispatchErrorDecision({receivedEventId, subscription, reason: 'boom'});

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.decision).toBe('triggered');
    expect(rows[0]?.reason).toBeNull();
  });

  it('records a listener filter-error decision', async () => {
    const receivedEventId = await insertReceivedEvent(buildEventParams());
    const subscription = buildListenerSubscription();

    await upsertListenerFilterErrorDecision({
      receivedEventId,
      subscription,
      reason: 'Listener filter evaluation failed',
    });

    const rows = await decisionsFor(receivedEventId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subscriptionKind).toBe('listener');
    expect(rows[0]?.decision).toBe('filter-error');
    expect(rows[0]?.reason).toBe('Listener filter evaluation failed');
  });
});
