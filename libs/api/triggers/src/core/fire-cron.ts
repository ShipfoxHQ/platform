import {getTriggerSubscriptionById} from '#db/subscriptions.js';
import {cronFiredCount, cronFireLag} from '#metrics/instance.js';
import {readConfigInputs} from './config.js';
import {TriggerSubscriptionNotCronError, TriggerSubscriptionNotFoundError} from './errors.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';
import {isPermanentStartRunError, type WorkflowsModuleClient} from './workflows-client.js';

export interface FireCronSubscriptionParams {
  workflows: WorkflowsModuleClient;
  subscriptionId: string;
  /**
   * The `next_fire_at` value the schedule held when it was claimed. Anchoring the
   * idempotency key and history `event_ref` on this slot, rather than wall-clock
   * time, makes a retry of the same occurrence a deterministic no-op.
   */
  scheduledSlot: Date;
}

export type FireCronSubscriptionResult =
  | {outcome: 'fired'; run: {id: string; name: string}}
  | {outcome: 'errored'};

/**
 * Fires one cron schedule occurrence. Mirrors `fireManualSubscription`, but is driven
 * by the drain activity rather than an HTTP route, and reports the outcome instead of
 * throwing on a permanent failure so the caller can advance the schedule past a
 * permanently broken definition:
 *
 * - `{outcome: 'fired'}` on success (or an idempotent replay of an already-created run),
 * - `{outcome: 'errored'}` on a permanent `runWorkflow` failure (recorded, schedule advances),
 * - throws on a transient failure so the caller rolls back the advance and retries.
 */
export async function fireCronSubscription(
  params: FireCronSubscriptionParams,
): Promise<FireCronSubscriptionResult> {
  const subscription = await getTriggerSubscriptionById(params.subscriptionId);
  if (!subscription) throw new TriggerSubscriptionNotFoundError(params.subscriptionId);
  if (subscription.source !== 'cron') {
    throw new TriggerSubscriptionNotCronError(params.subscriptionId, subscription.source);
  }

  // Deterministic per-occurrence identity: unique across (subscription, slot), stable
  // across retries. Used for both the run idempotency key and the received-event ref.
  const eventRef = `${subscription.id}:${params.scheduledSlot.toISOString()}`;
  const historyBase = {
    origin: 'cron' as const,
    workspaceId: subscription.workspaceId,
    provider: null,
    source: subscription.source,
    // Cron has no inbound event. Keep the canonical history event for a row
    // that bypassed the projection write-path validation.
    event: subscription.event ?? 'tick',
    replayOfEventId: null,
    deliveryId: null,
    connectionId: null,
    connectionName: null,
    payload: null,
    // The scheduled occurrence is the logical arrival time of the tick event.
    receivedAt: params.scheduledSlot,
    eventRef,
  };

  const inputs = readConfigInputs(subscription);
  let run: {id: string; name: string};
  try {
    run = await params.workflows.startRunFromTrigger({
      workspaceId: subscription.workspaceId,
      projectId: subscription.projectId,
      definitionId: subscription.workflowDefinitionId,
      triggerPayload: {
        provider: 'cron',
        source: 'cron',
        event: 'tick',
        scheduleId: subscription.id,
      },
      ...(inputs === undefined ? {} : {inputs}),
      idempotencyKey: eventRef,
    });
  } catch (error) {
    const failure = await beginTriggerHistory(historyBase);
    await failure.dispatchErrored(subscription, toReason(error));
    if (isPermanentStartRunError(error)) {
      recordFire('errored', params.scheduledSlot);
      await failure.allErrored(1);
      return {outcome: 'errored'};
    }
    // Transient: leave the event non-terminal and re-throw so the caller rolls back
    // the advance and the schedule stays due for the next tick.
    await failure.failed(1);
    throw error;
  }

  const history = await beginTriggerHistory(historyBase);
  await history.triggered(subscription, run);
  recordFire('fired', params.scheduledSlot);
  await history.routed(1);
  return {outcome: 'fired', run};
}

function recordFire(outcome: 'fired' | 'errored', scheduledSlot: Date): void {
  cronFiredCount.add(1, {outcome});
  cronFireLag.record(Math.max(0, Date.now() - scheduledSlot.getTime()));
}
