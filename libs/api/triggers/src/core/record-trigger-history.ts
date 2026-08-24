import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {JobListenerSubscription} from '#core/entities/job-listener-subscription.js';
import type {TriggerEventOrigin} from '#core/entities/received-event.js';
import type {TriggerSubscription} from '#core/entities/subscription.js';
import {
  insertReceivedEvent,
  markReceivedEventDiscarded,
  markReceivedEventErrored,
  markReceivedEventFailed,
  markReceivedEventRouted,
  upsertDevDispatchErrorDecision,
  upsertDevFilterErrorDecision,
  upsertDevTriggeredDecision,
  upsertDispatchErrorDecision,
  upsertFilterErrorDecision,
  upsertListenerDispatchErrorDecision,
  upsertListenerFilterErrorDecision,
  upsertListenerTriggeredDecision,
  upsertTriggeredDecision,
} from '#db/event-history.js';

const MAX_REASON_LENGTH = 2000;

// A bounded, deterministic reason string safe to persist: error messages can be
// long or carry untrusted data, so cap the length and never serialize the object.
export function toReason(error: unknown): string {
  let message: string;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    message = '[unprintable thrown value]';
  }
  return message.slice(0, MAX_REASON_LENGTH);
}

export interface TriggerRun {
  id: string;
  name: string;
}

export interface TriggerHistoryRecorder {
  triggered(subscription: TriggerSubscription, run: TriggerRun): Promise<void>;
  // Dev journal entries carry no subscription row: subscription_name is the
  // trigger key and workflow_definition_id the workflow lineage id.
  devTriggered(triggerKey: string, workflowDefinitionId: string, run: TriggerRun): Promise<void>;
  devFilterErrored(triggerKey: string, workflowDefinitionId: string, reason: string): Promise<void>;
  devDispatchErrored(
    triggerKey: string,
    workflowDefinitionId: string,
    reason: string,
  ): Promise<void>;
  filterErrored(subscription: TriggerSubscription, reason: string): Promise<void>;
  dispatchErrored(subscription: TriggerSubscription, reason: string): Promise<void>;
  listenerTriggered(subscription: JobListenerSubscription): Promise<void>;
  listenerFilterErrored(subscription: JobListenerSubscription, reason: string): Promise<void>;
  listenerDispatchErrored(subscription: JobListenerSubscription, reason: string): Promise<void>;
  discarded(): Promise<void>;
  routed(matchedCount: number): Promise<void>;
  failed(matchedCount: number): Promise<void>;
  allErrored(matchedCount: number): Promise<void>;
}

export interface BeginTriggerHistoryParams {
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

// History writes are best-effort and log stable ids only, never payloads or tokens.
// If the parent insert fails there is no row to attach to, so later calls no-op.
export async function beginTriggerHistory(
  params: BeginTriggerHistoryParams,
): Promise<TriggerHistoryRecorder> {
  const receivedEventId = await safe(params.eventRef, 'insert-received-event', () =>
    insertReceivedEvent(params),
  );

  const record = async (
    label: string,
    write: (receivedEventId: string) => Promise<unknown>,
    subscriptionId?: string,
  ): Promise<void> => {
    if (receivedEventId === undefined) return;
    await safe(params.eventRef, label, () => write(receivedEventId), subscriptionId);
  };

  return {
    triggered: (subscription, run) =>
      record(
        'triggered-decision',
        (id) => upsertTriggeredDecision({receivedEventId: id, subscription, run}),
        subscription.id,
      ),
    devTriggered: (triggerKey, workflowDefinitionId, run) =>
      record('dev-triggered-decision', (id) =>
        upsertDevTriggeredDecision({receivedEventId: id, triggerKey, workflowDefinitionId, run}),
      ),
    devFilterErrored: (triggerKey, workflowDefinitionId, reason) =>
      record('dev-filter-error-decision', (id) =>
        upsertDevFilterErrorDecision({
          receivedEventId: id,
          triggerKey,
          workflowDefinitionId,
          reason,
        }),
      ),
    devDispatchErrored: (triggerKey, workflowDefinitionId, reason) =>
      record('dev-dispatch-error-decision', (id) =>
        upsertDevDispatchErrorDecision({
          receivedEventId: id,
          triggerKey,
          workflowDefinitionId,
          reason,
        }),
      ),
    filterErrored: (subscription, reason) =>
      record(
        'filter-error-decision',
        (id) => upsertFilterErrorDecision({receivedEventId: id, subscription, reason}),
        subscription.id,
      ),
    dispatchErrored: (subscription, reason) =>
      record(
        'dispatch-error-decision',
        (id) => upsertDispatchErrorDecision({receivedEventId: id, subscription, reason}),
        subscription.id,
      ),
    listenerTriggered: (subscription) =>
      record(
        'listener-triggered-decision',
        (id) => upsertListenerTriggeredDecision({receivedEventId: id, subscription}),
        subscription.id,
      ),
    listenerFilterErrored: (subscription, reason) =>
      record(
        'listener-filter-error-decision',
        (id) => upsertListenerFilterErrorDecision({receivedEventId: id, subscription, reason}),
        subscription.id,
      ),
    listenerDispatchErrored: (subscription, reason) =>
      record(
        'listener-dispatch-error-decision',
        (id) => upsertListenerDispatchErrorDecision({receivedEventId: id, subscription, reason}),
        subscription.id,
      ),
    discarded: () => record('discard-event', (id) => markReceivedEventDiscarded(id)),
    routed: (matchedCount) =>
      record('route-event', (id) => markReceivedEventRouted(id, matchedCount)),
    failed: (matchedCount) =>
      record('fail-event', (id) => markReceivedEventFailed(id, matchedCount)),
    allErrored: (matchedCount) =>
      record('all-errored-event', (id) => markReceivedEventErrored(id, matchedCount)),
  };
}

async function safe<T>(
  eventRef: string,
  label: string,
  fn: () => Promise<T>,
  subscriptionId?: string,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    logger().warn(
      {err: error, label, eventRef, ...(subscriptionId ? {subscriptionId} : {})},
      'trigger history write failed; ignored (best-effort)',
    );
    reportError(error, {
      boundary: 'triggers.history',
      operation: label,
      extra: {eventRef, subscriptionId},
    });
    return undefined;
  }
}
