import {findMatchingSubscriptions} from '#db/subscriptions.js';
import {
  eventOutcomeCount,
  eventReceivedCount,
  subscriptionTriggeredCount,
} from '#metrics/instance.js';
import {evaluateTriggerFilter, readConfigInputs} from './config.js';
import {TriggerReferenceResolutionError} from './errors.js';
import {beginTriggerHistory, toReason} from './record-trigger-history.js';
import {routeEventToJobListeners} from './route-event-to-job-listeners.js';
import {
  isPermanentStartRunError,
  startRunDiagnostic,
  type WorkflowsModuleClient,
} from './workflows-client.js';

export interface DispatchIntegrationEventParams {
  workflows: WorkflowsModuleClient;
  eventRef: string;
  workspaceId: string;
  provider: string;
  source: string;
  event: string;
  deliveryId: string;
  connectionId: string;
  connectionName: string | null;
  payload: unknown;
  receivedAt: Date;
}

// Source-agnostic dispatcher: any inbound integration event fans out to every
// workspace subscription registered for its (source, event) and to every listening
// job subscribed to it, passing the raw payload through untouched. The module knows
// nothing about github, gitlab, etc.
//
// Continue-on-error: every matched subscription and listener is attempted so one broken
// subscription cannot starve its siblings. A permanent admission failure (deleted definition,
// project mismatch, suspended workspace) is recorded and skipped; a transient one is recorded
// and re-thrown so the outbox
// replays the whole event and converges (succeeded siblings dedup on the idempotency key). The
// event reaches a terminal outcome only when no transient error remains: `routed` if any run
// was created or any listening job accepted a delivery, `discarded` if nothing matched, otherwise
// `errored`.
// History is best-effort; the thrown transient error, not the recorded outcome, drives the retry.
export async function dispatchIntegrationEvent(
  params: DispatchIntegrationEventParams,
): Promise<void> {
  eventReceivedCount.add(1, {provider: params.provider});

  const history = await beginTriggerHistory({
    eventRef: params.eventRef,
    origin: 'integration',
    workspaceId: params.workspaceId,
    provider: params.provider,
    source: params.source,
    event: params.event,
    replayOfEventId: null,
    deliveryId: params.deliveryId,
    connectionId: params.connectionId,
    connectionName: params.connectionName,
    payload: (params.payload ?? null) as Record<string, unknown> | null,
    receivedAt: params.receivedAt,
  });

  let subscriptions: Awaited<ReturnType<typeof findMatchingSubscriptions>>;
  try {
    subscriptions = await findMatchingSubscriptions({
      workspaceId: params.workspaceId,
      source: params.source,
      event: params.event,
    });
  } catch (error) {
    await history.processingFailed(0, {version: 1, code: 'subscription-load-failed'});
    throw error;
  }

  const dispatch = await dispatchMatchingSubscriptions(params, subscriptions, history);

  let listenerResult: Awaited<ReturnType<typeof routeEventToJobListeners>>;
  try {
    listenerResult = await routeEventToJobListeners({
      workflows: params.workflows,
      history,
      eventRef: params.eventRef,
      workspaceId: params.workspaceId,
      connectionId: params.connectionId,
      provider: params.provider,
      source: params.source,
      event: params.event,
      deliveryId: params.deliveryId,
      payload: params.payload,
      receivedAt: params.receivedAt,
    });
  } catch (error) {
    await history.processingFailed(dispatch.triggerEngagedCount, {
      version: 1,
      code:
        error instanceof TriggerReferenceResolutionError
          ? 'trigger-reference-resolution-failed'
          : 'listener-routing-failed',
    });
    throw error;
  }

  if (listenerResult.transientErrored && !dispatch.sawTransientError) {
    dispatch.sawTransientError = true;
    dispatch.firstTransientError = listenerResult.transientError;
  }

  const totalMatchedCount = dispatch.triggerEngagedCount + listenerResult.engagedCount;

  if (dispatch.sawTransientError) {
    eventOutcomeCount.add(1, {provider: params.provider, outcome: 'failed'});
    await history.failed(totalMatchedCount);
    throw dispatch.firstTransientError;
  }

  if (dispatch.triggeredCount > 0 || listenerResult.acceptedJobCount > 0) {
    eventOutcomeCount.add(1, {provider: params.provider, outcome: 'routed'});
    await history.routed(totalMatchedCount);
    return;
  }

  if (totalMatchedCount === 0) {
    eventOutcomeCount.add(1, {provider: params.provider, outcome: 'discarded'});
    await history.discarded();
    return;
  }

  eventOutcomeCount.add(1, {provider: params.provider, outcome: 'errored'});
  await history.allErrored(totalMatchedCount);
}

interface SubscriptionDispatchState {
  triggeredCount: number;
  triggerEngagedCount: number;
  sawTransientError: boolean;
  firstTransientError: unknown;
}

async function dispatchMatchingSubscriptions(
  params: DispatchIntegrationEventParams,
  subscriptions: Awaited<ReturnType<typeof findMatchingSubscriptions>>,
  history: Awaited<ReturnType<typeof beginTriggerHistory>>,
): Promise<SubscriptionDispatchState> {
  const state: SubscriptionDispatchState = {
    triggeredCount: 0,
    triggerEngagedCount: 0,
    sawTransientError: false,
    firstTransientError: undefined,
  };
  for (const subscription of subscriptions) {
    const filterResult = evaluateTriggerFilter({
      subscription,
      source: params.source,
      event: params.event,
      payload: params.payload,
    });
    if (filterResult.kind === 'filtered') continue;
    state.triggerEngagedCount += 1;
    if (filterResult.kind === 'filter-error') {
      await history.filterErrored(subscription, filterResult.reason, filterResult.diagnostic);
      continue;
    }
    await dispatchMatchingSubscription(params, subscription, history, state);
  }
  return state;
}

async function dispatchMatchingSubscription(
  params: DispatchIntegrationEventParams,
  subscription: Awaited<ReturnType<typeof findMatchingSubscriptions>>[number],
  history: Awaited<ReturnType<typeof beginTriggerHistory>>,
  state: SubscriptionDispatchState,
): Promise<void> {
  const inputs = readConfigInputs(subscription);
  try {
    const run = await params.workflows.startRunFromTrigger({
      workspaceId: subscription.workspaceId,
      projectId: subscription.projectId,
      definitionId: subscription.workflowDefinitionId,
      triggerConnectionId: params.connectionId,
      triggerPayload: {
        provider: params.provider,
        source: params.source,
        event: params.event,
        deliveryId: params.deliveryId,
        data: params.payload,
      },
      ...(inputs === undefined ? {} : {inputs}),
      idempotencyKey: `${subscription.id}:${params.eventRef}`,
    });
    await history.triggered(subscription, run);
    state.triggeredCount += 1;
    subscriptionTriggeredCount.add(1, {provider: params.provider});
  } catch (error) {
    await history.dispatchErrored(subscription, toReason(error), startRunDiagnostic(error));
    // A thrown undefined value is still a transient failure and must drive the replay.
    if (!isPermanentStartRunError(error) && !state.sawTransientError) {
      state.sawTransientError = true;
      state.firstTransientError = error;
    }
  }
}
