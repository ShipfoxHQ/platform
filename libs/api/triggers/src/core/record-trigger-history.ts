import {
  triggerDecisionDiagnosticSchema,
  triggerEventProcessingDiagnosticSchema,
} from '@shipfox/api-triggers-dto/inter-module';
import {workflowsInterModuleContract} from '@shipfox/api-workflows-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {reportError} from '@shipfox/node-error-monitoring';
import {logger} from '@shipfox/node-opentelemetry';
import type {
  TriggerDecisionDiagnostic,
  TriggerEventProcessingDiagnostic,
} from '#core/entities/diagnostic.js';
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
  upsertDevFilteredDecision,
  upsertDevTriggeredDecision,
  upsertDispatchErrorDecision,
  upsertFilterErrorDecision,
  upsertListenerDeliveryRejectedDecision,
  upsertListenerDispatchErrorDecision,
  upsertListenerFilterErrorDecision,
  upsertListenerTriggeredDecision,
  upsertTriggeredDecision,
} from '#db/event-history.js';
import {diagnosticCount} from '#metrics/instance.js';

const MAX_REASON_LENGTH = 2000;

// A bounded, deterministic reason string safe to persist: error messages can be
// long or carry untrusted data, so cap the length and never serialize the object.
export function toReason(error: unknown): string {
  let message: string;
  try {
    message = admissionReason(error) ?? (error instanceof Error ? error.message : String(error));
  } catch {
    message = '[unprintable thrown value]';
  }
  return message.slice(0, MAX_REASON_LENGTH);
}

function admissionReason(error: unknown): string | undefined {
  const methods = [
    workflowsInterModuleContract.methods.startRunFromTrigger,
    workflowsInterModuleContract.methods.startDevRun,
    workflowsInterModuleContract.methods.deliverEventToJobListener,
  ] as const;
  for (const method of methods) {
    if (!isInterModuleKnownError(method, error) || error.code !== 'admission-denied') continue;
    return error.details.reason;
  }
  return undefined;
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
  devFiltered(triggerKey: string, workflowDefinitionId: string): Promise<void>;
  devFilterErrored(
    triggerKey: string,
    workflowDefinitionId: string,
    reason: string,
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  devDispatchErrored(
    triggerKey: string,
    workflowDefinitionId: string,
    reason: string,
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  filterErrored(
    subscription: TriggerSubscription,
    reason: string,
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  dispatchErrored(
    subscription: TriggerSubscription,
    reason: string,
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  listenerTriggered(subscription: JobListenerSubscription): Promise<void>;
  listenerFilterErrored(
    subscription: JobListenerSubscription,
    reason: string,
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  listenerDispatchErrored(
    subscription: JobListenerSubscription,
    reason: string,
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  listenerDeliveryRejected(
    subscription: JobListenerSubscription,
    reason: 'payload-too-large',
    diagnostic: TriggerDecisionDiagnostic,
  ): Promise<void>;
  discarded(): Promise<void>;
  routed(matchedCount: number): Promise<void>;
  failed(matchedCount: number): Promise<void>;
  processingFailed(
    matchedCount: number,
    diagnostic: TriggerEventProcessingDiagnostic,
  ): Promise<void>;
  allErrored(matchedCount: number): Promise<void>;
}

export interface BeginTriggerHistoryParams {
  eventRef: string;
  origin: TriggerEventOrigin;
  workspaceId: string;
  provider: string | null;
  source: string;
  event: string;
  /** Source event this entry replays (dev runs only). */
  replayOfEventId: string | null;
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

  const recordDecisionDiagnostic = (
    label: string,
    diagnostic: TriggerDecisionDiagnostic,
    write: (receivedEventId: string, diagnostic: TriggerDecisionDiagnostic) => Promise<unknown>,
    subscriptionId?: string,
  ): Promise<void> =>
    recordDiagnostic(
      label,
      diagnostic,
      (value) => validateDecisionDiagnostic(value),
      (code) => diagnosticCount.add(1, {scope: 'decision', code}),
      write,
      subscriptionId,
    );

  const recordProcessingDiagnostic = (
    label: string,
    diagnostic: TriggerEventProcessingDiagnostic,
    write: (
      receivedEventId: string,
      diagnostic: TriggerEventProcessingDiagnostic,
    ) => Promise<unknown>,
  ): Promise<void> =>
    recordDiagnostic(
      label,
      diagnostic,
      (value) => validateProcessingDiagnostic(value),
      (code) => diagnosticCount.add(1, {scope: 'event', code}),
      write,
    );

  async function recordDiagnostic<
    T extends TriggerDecisionDiagnostic | TriggerEventProcessingDiagnostic,
  >(
    label: string,
    diagnostic: T,
    validate: (diagnostic: T) => T,
    count: (code: T['code']) => void,
    write: (receivedEventId: string, diagnostic: T) => Promise<unknown>,
    subscriptionId?: string,
  ): Promise<void> {
    const checkedDiagnostic = await safe(
      params.eventRef,
      `${label}-diagnostic`,
      () => {
        const checked = validate(diagnostic);
        count(checked.code);
        return Promise.resolve(checked);
      },
      subscriptionId,
    );
    if (checkedDiagnostic === undefined) return;
    await record(label, (id) => write(id, checkedDiagnostic), subscriptionId);
  }

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
    devFiltered: (triggerKey, workflowDefinitionId) =>
      record('dev-filtered-decision', (id) =>
        upsertDevFilteredDecision({receivedEventId: id, triggerKey, workflowDefinitionId}),
      ),
    devFilterErrored: (triggerKey, workflowDefinitionId, reason, diagnostic) =>
      recordDecisionDiagnostic('dev-filter-error-decision', diagnostic, (id, checkedDiagnostic) =>
        upsertDevFilterErrorDecision({
          receivedEventId: id,
          triggerKey,
          workflowDefinitionId,
          reason,
          diagnostic: checkedDiagnostic,
        }),
      ),
    devDispatchErrored: (triggerKey, workflowDefinitionId, reason, diagnostic) =>
      recordDecisionDiagnostic('dev-dispatch-error-decision', diagnostic, (id, checkedDiagnostic) =>
        upsertDevDispatchErrorDecision({
          receivedEventId: id,
          triggerKey,
          workflowDefinitionId,
          reason,
          diagnostic: checkedDiagnostic,
        }),
      ),
    filterErrored: (subscription, reason, diagnostic) =>
      recordDecisionDiagnostic(
        'filter-error-decision',
        diagnostic,
        (id, checkedDiagnostic) =>
          upsertFilterErrorDecision({
            receivedEventId: id,
            subscription,
            reason,
            diagnostic: checkedDiagnostic,
          }),
        subscription.id,
      ),
    dispatchErrored: (subscription, reason, diagnostic) =>
      recordDecisionDiagnostic(
        'dispatch-error-decision',
        diagnostic,
        (id, checkedDiagnostic) =>
          upsertDispatchErrorDecision({
            receivedEventId: id,
            subscription,
            reason,
            diagnostic: checkedDiagnostic,
          }),
        subscription.id,
      ),
    listenerTriggered: (subscription) =>
      record(
        'listener-triggered-decision',
        (id) => upsertListenerTriggeredDecision({receivedEventId: id, subscription}),
        subscription.id,
      ),
    listenerFilterErrored: (subscription, reason, diagnostic) =>
      recordDecisionDiagnostic(
        'listener-filter-error-decision',
        diagnostic,
        (id, checkedDiagnostic) =>
          upsertListenerFilterErrorDecision({
            receivedEventId: id,
            subscription,
            reason,
            diagnostic: checkedDiagnostic,
          }),
        subscription.id,
      ),
    listenerDispatchErrored: (subscription, reason, diagnostic) =>
      recordDecisionDiagnostic(
        'listener-dispatch-error-decision',
        diagnostic,
        (id, checkedDiagnostic) =>
          upsertListenerDispatchErrorDecision({
            receivedEventId: id,
            subscription,
            reason,
            diagnostic: checkedDiagnostic,
          }),
        subscription.id,
      ),
    listenerDeliveryRejected: (subscription, reason, diagnostic) =>
      recordDecisionDiagnostic(
        'listener-rejected-decision',
        diagnostic,
        (id, checkedDiagnostic) =>
          upsertListenerDeliveryRejectedDecision({
            receivedEventId: id,
            subscription,
            reason,
            diagnostic: checkedDiagnostic,
          }),
        subscription.id,
      ),
    discarded: () => record('discard-event', (id) => markReceivedEventDiscarded(id)),
    routed: (matchedCount) =>
      record('route-event', (id) => markReceivedEventRouted(id, matchedCount)),
    failed: (matchedCount) =>
      record('fail-event', (id) => markReceivedEventFailed(id, matchedCount)),
    processingFailed: (matchedCount, diagnostic) =>
      recordProcessingDiagnostic('fail-event-processing', diagnostic, (id, checkedDiagnostic) =>
        markReceivedEventFailed(id, matchedCount, checkedDiagnostic),
      ),
    allErrored: (matchedCount) =>
      record('all-errored-event', (id) => markReceivedEventErrored(id, matchedCount)),
  };
}

function validateDecisionDiagnostic(
  diagnostic: TriggerDecisionDiagnostic,
): TriggerDecisionDiagnostic {
  triggerDecisionDiagnosticSchema.parse(diagnostic);
  return diagnostic;
}

function validateProcessingDiagnostic(
  diagnostic: TriggerEventProcessingDiagnostic,
): TriggerEventProcessingDiagnostic {
  triggerEventProcessingDiagnosticSchema.parse(diagnostic);
  return diagnostic;
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
