import {and, eq, ne, notInArray, sql} from 'drizzle-orm';
import type {JobListenerSubscription} from '#core/entities/job-listener-subscription.js';
import type {TriggerEventOrigin} from '#core/entities/received-event.js';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {db} from './db.js';
import {triggersDecisions} from './schema/decisions.js';
import {triggersReceivedEvents} from './schema/received-events.js';

export interface InsertReceivedEventParams {
  eventRef: string;
  origin: TriggerEventOrigin;
  workspaceId: string;
  provider: string | null;
  source: string;
  event: string;
  deliveryId: string | null;
  connectionId: string | null;
  connectionName: string | null;
  payload: Record<string, unknown> | null;
  receivedAt: Date;
}

// `event_ref` is unique and delivery is at-least-once, so the same event can
// arrive twice; either path returns the row id used to attach decisions.
export async function insertReceivedEvent(params: InsertReceivedEventParams): Promise<string> {
  const [inserted] = await db()
    .insert(triggersReceivedEvents)
    .values({
      eventRef: params.eventRef,
      origin: params.origin,
      workspaceId: params.workspaceId,
      provider: params.provider,
      source: params.source,
      event: params.event,
      deliveryId: params.deliveryId,
      connectionId: params.connectionId,
      connectionName: params.connectionName,
      payload: params.payload,
      receivedAt: params.receivedAt,
    })
    .onConflictDoNothing({target: triggersReceivedEvents.eventRef})
    .returning({id: triggersReceivedEvents.id});
  if (inserted) return inserted.id;

  const [existing] = await db()
    .select({id: triggersReceivedEvents.id})
    .from(triggersReceivedEvents)
    .where(eq(triggersReceivedEvents.eventRef, params.eventRef));
  if (!existing) {
    throw new Error(`received_events row missing after conflict for event_ref ${params.eventRef}`);
  }
  return existing.id;
}

export async function markReceivedEventDiscarded(id: string): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({outcome: 'discarded', matchedCount: 0, processedAt: new Date()})
    .where(
      and(
        eq(triggersReceivedEvents.id, id),
        notInArray(triggersReceivedEvents.outcome, ['routed', 'errored']),
      ),
    );
}

export async function markReceivedEventRouted(id: string, matchedCount: number): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({outcome: 'routed', matchedCount, processedAt: new Date()})
    .where(eq(triggersReceivedEvents.id, id));
}

// No processedAt: `failed` is transient. Under at-least-once dispatch, a late
// failure must not clobber a sibling invocation's terminal outcome.
export async function markReceivedEventFailed(id: string, matchedCount: number): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({outcome: 'failed', matchedCount})
    .where(
      and(
        eq(triggersReceivedEvents.id, id),
        notInArray(triggersReceivedEvents.outcome, ['routed', 'discarded', 'errored']),
      ),
    );
}

// Terminal outcome for a fan-out that produced no new run this pass. The CASE is a
// cross-attempt safety net: under at-least-once delivery a prior attempt may already have
// created a run (its decision row is `triggered`, which is never downgraded), so promote the
// event to `routed` rather than falsely record `errored`. Guarded so it never downgrades a
// terminal success.
export async function markReceivedEventErrored(id: string, matchedCount: number): Promise<void> {
  await db()
    .update(triggersReceivedEvents)
    .set({
      outcome: sql`CASE WHEN EXISTS (
        SELECT 1
        FROM ${triggersDecisions}
        WHERE ${triggersDecisions.receivedEventId} = ${triggersReceivedEvents.id}
          AND ${triggersDecisions.decision} = 'triggered'
      ) THEN 'routed' ELSE 'errored' END`,
      matchedCount,
      processedAt: new Date(),
    })
    .where(
      and(
        eq(triggersReceivedEvents.id, id),
        notInArray(triggersReceivedEvents.outcome, ['routed', 'discarded']),
      ),
    );
}

export interface UpsertTriggeredDecisionParams {
  receivedEventId: string;
  subscription: TriggerSubscription;
  run: {id: string; name: string};
}

export async function upsertTriggeredDecision(
  params: UpsertTriggeredDecisionParams,
): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      receivedEventId: params.receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: params.subscription.id,
      subscriptionName: params.subscription.name,
      workflowDefinitionId: params.subscription.workflowDefinitionId,
      projectId: params.subscription.projectId,
      decision: 'triggered',
      runId: params.run.id,
      runName: params.run.name,
      reason: null,
    })
    .onConflictDoUpdate({
      target: [
        triggersDecisions.receivedEventId,
        triggersDecisions.subscriptionKind,
        triggersDecisions.subscriptionId,
      ],
      set: {decision: 'triggered', runId: params.run.id, runName: params.run.name, reason: null},
    });
}

export interface UpsertFailedDecisionParams {
  receivedEventId: string;
  subscription: TriggerSubscription;
  reason: string;
}

export async function upsertFilterErrorDecision(params: UpsertFailedDecisionParams): Promise<void> {
  await upsertFailedDecision(params, 'filter-error');
}

// A created run is ground truth. A later retry failure must not erase it.
export async function upsertDispatchErrorDecision(
  params: UpsertFailedDecisionParams,
): Promise<void> {
  await upsertFailedDecision(params, 'dispatch-error');
}

async function upsertFailedDecision(
  params: UpsertFailedDecisionParams,
  decision: 'filter-error' | 'dispatch-error',
): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      receivedEventId: params.receivedEventId,
      subscriptionKind: 'trigger',
      subscriptionId: params.subscription.id,
      subscriptionName: params.subscription.name,
      workflowDefinitionId: params.subscription.workflowDefinitionId,
      projectId: params.subscription.projectId,
      decision,
      reason: params.reason,
    })
    .onConflictDoUpdate({
      target: [
        triggersDecisions.receivedEventId,
        triggersDecisions.subscriptionKind,
        triggersDecisions.subscriptionId,
      ],
      set: {decision, reason: params.reason, runId: null, runName: null},
      setWhere: ne(triggersDecisions.decision, 'triggered'),
    });
}

export interface UpsertListenerTriggeredDecisionParams {
  receivedEventId: string;
  subscription: JobListenerSubscription;
}

export async function upsertListenerTriggeredDecision(
  params: UpsertListenerTriggeredDecisionParams,
): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      ...listenerDecisionIdentity(params),
      decision: 'triggered',
      runId: null,
      runName: null,
      reason: null,
    })
    .onConflictDoUpdate({
      target: [
        triggersDecisions.receivedEventId,
        triggersDecisions.subscriptionKind,
        triggersDecisions.subscriptionId,
      ],
      set: {decision: 'triggered', runId: null, runName: null, reason: null},
    });
}

export interface UpsertListenerFailedDecisionParams {
  receivedEventId: string;
  subscription: JobListenerSubscription;
  reason: string;
}

export async function upsertListenerFilterErrorDecision(
  params: UpsertListenerFailedDecisionParams,
): Promise<void> {
  await upsertListenerFailedDecision(params, 'filter-error');
}

export async function upsertListenerDispatchErrorDecision(
  params: UpsertListenerFailedDecisionParams,
): Promise<void> {
  await upsertListenerFailedDecision(params, 'dispatch-error');
}

async function upsertListenerFailedDecision(
  params: UpsertListenerFailedDecisionParams,
  decision: 'filter-error' | 'dispatch-error',
): Promise<void> {
  await db()
    .insert(triggersDecisions)
    .values({
      ...listenerDecisionIdentity(params),
      decision,
      reason: params.reason,
    })
    .onConflictDoUpdate({
      target: [
        triggersDecisions.receivedEventId,
        triggersDecisions.subscriptionKind,
        triggersDecisions.subscriptionId,
      ],
      set: {decision, reason: params.reason, runId: null, runName: null},
      setWhere: ne(triggersDecisions.decision, 'triggered'),
    });
}

function listenerDecisionIdentity(params: {
  receivedEventId: string;
  subscription: JobListenerSubscription;
}) {
  const {subscription} = params;
  return {
    receivedEventId: params.receivedEventId,
    subscriptionKind: 'listener' as const,
    subscriptionId: subscription.id,
    subscriptionName: listenerSubscriptionName(subscription),
    workflowDefinitionId: null,
    projectId: null,
    workflowRunId: subscription.workflowRunId,
    jobId: subscription.jobId,
    matcherKind: subscription.kind,
    matcherOrdinal: subscription.matcherOrdinal,
  };
}

function listenerSubscriptionName(subscription: JobListenerSubscription): string {
  // A NULL event is a source subscription; `*` keeps the audit name unambiguous.
  return `listener ${subscription.kind}[${subscription.matcherOrdinal}] ${subscription.source}/${subscription.event ?? '*'}`;
}

export interface UpsertDevTriggeredDecisionParams {
  receivedEventId: string;
  triggerKey: string;
  workflowDefinitionId: string;
  run: {id: string; name: string};
}

// A dev journal entry has exactly one decision. The unique index
// (received_event_id, subscription_kind, subscription_id) treats NULL
// subscription ids as distinct, so there is no conflict target to upsert on;
// the caller writes the single decision per entry.
export async function upsertDevTriggeredDecision(
  params: UpsertDevTriggeredDecisionParams,
): Promise<void> {
  await db().insert(triggersDecisions).values({
    receivedEventId: params.receivedEventId,
    subscriptionKind: 'dev',
    subscriptionId: null,
    subscriptionName: params.triggerKey,
    workflowDefinitionId: params.workflowDefinitionId,
    projectId: null,
    decision: 'triggered',
    runId: params.run.id,
    runName: params.run.name,
    reason: null,
  });
}

export interface UpsertDevFilterErrorDecisionParams {
  receivedEventId: string;
  triggerKey: string;
  workflowDefinitionId: string;
  reason: string;
}

// Refusals before run creation (filter false or evaluation error on replay).
export async function upsertDevFilterErrorDecision(
  params: UpsertDevFilterErrorDecisionParams,
): Promise<void> {
  await db().insert(triggersDecisions).values({
    receivedEventId: params.receivedEventId,
    subscriptionKind: 'dev',
    subscriptionId: null,
    subscriptionName: params.triggerKey,
    workflowDefinitionId: params.workflowDefinitionId,
    projectId: null,
    decision: 'filter-error',
    runId: null,
    runName: null,
    reason: params.reason,
  });
}
