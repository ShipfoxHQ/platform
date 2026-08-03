import {projectWorkflowPredicateContext} from '@shipfox/expression';
import {logger} from '@shipfox/node-opentelemetry';
import {findMatchingJobListenerSubscriptions} from '#db/job-listener-subscriptions.js';
import {evaluateStoredFilter, type StoredFilterEvaluation} from './config.js';
import type {JobListenerSubscription} from './entities/job-listener-subscription.js';
import {type TriggerHistoryRecorder, toReason} from './record-trigger-history.js';
import {
  isPermanentDeliverEventToJobListenerError,
  type WorkflowsModuleClient,
} from './workflows-client.js';

export interface RouteEventToJobListenersParams {
  workflows: WorkflowsModuleClient;
  history: TriggerHistoryRecorder;
  eventRef: string;
  workspaceId: string;
  connectionId: string;
  provider: string;
  source: string;
  event: string;
  deliveryId: string;
  payload: unknown;
  receivedAt: Date;
}

export interface RouteEventToJobListenersResult {
  /**
   * Listener outcomes that should contribute to received_event.matched_count:
   * filter errors, accepted deliveries, and dispatch errors. Stale skipped jobs
   * are intentionally excluded because they did not produce an auditable decision.
   */
  engagedCount: number;
  /**
   * Jobs with an effective matcher after source/event/filter checks, including
   * stale skipped jobs.
   */
  matchedJobCount: number;
  acceptedJobCount: number;
  deliveredCount: number;
  transientErrored: boolean;
  transientError: unknown;
}

export async function routeEventToJobListeners(
  params: RouteEventToJobListenersParams,
): Promise<RouteEventToJobListenersResult> {
  const subscriptions = await findMatchingJobListenerSubscriptions({
    workspaceId: params.workspaceId,
    source: params.source,
    event: params.event,
  });

  let filterErrorCount = 0;
  const effectiveMatchByJobId = new Map<string, JobListenerSubscription>();
  for (const subscription of subscriptions) {
    const filterResult = evaluateListenerFilter({subscription, payload: params.payload});
    if (filterResult.kind === 'filtered') continue;
    if (filterResult.kind === 'filter-error') {
      filterErrorCount += 1;
      await params.history.listenerFilterErrored(subscription, filterResult.reason);
      continue;
    }

    const previous = effectiveMatchByJobId.get(subscription.jobId);
    if (!previous || shouldReplaceEffectiveMatcher(previous, subscription)) {
      effectiveMatchByJobId.set(subscription.jobId, subscription);
    }
  }

  const fireDeliveryNeeded = [...effectiveMatchByJobId.values()].some(
    (subscription) => listenerDisposition(subscription) === 'fire',
  );
  const triggerReference = fireDeliveryNeeded
    ? await params.workflows.resolveWorkflowRunTriggerReference({
        workspaceId: params.workspaceId,
        triggerConnectionId: params.connectionId,
        triggerPayload: {
          provider: params.provider,
          source: params.source,
          event: params.event,
          deliveryId: params.deliveryId,
          data: params.payload,
        },
      })
    : null;

  let acceptedJobCount = 0;
  let deliveredCount = 0;
  let sawTransientError = false;
  let dispatchErrorCount = 0;
  let firstTransientError: unknown;

  for (const subscription of effectiveMatchByJobId.values()) {
    const disposition = listenerDisposition(subscription);
    try {
      const result = await params.workflows.deliverEventToJobListener({
        jobId: subscription.jobId,
        disposition,
        eventRef: params.eventRef,
        deliveryId: params.deliveryId,
        source: params.source,
        event: params.event,
        provider: params.provider,
        triggerConnectionId: params.connectionId,
        triggerReference,
        payload: params.payload,
        receivedAt: params.receivedAt.toISOString(),
      });
      if (!result.skipped) {
        acceptedJobCount += 1;
        await params.history.listenerTriggered(subscription);
      }
      if (result.buffered) deliveredCount += 1;
    } catch (error) {
      dispatchErrorCount += 1;
      await params.history.listenerDispatchErrored(subscription, toReason(error));
      if (!isPermanentDeliverEventToJobListenerError(error) && !sawTransientError) {
        sawTransientError = true;
        firstTransientError = error;
      }
    }
  }

  return {
    engagedCount: filterErrorCount + acceptedJobCount + dispatchErrorCount,
    matchedJobCount: effectiveMatchByJobId.size,
    acceptedJobCount,
    deliveredCount,
    transientErrored: sawTransientError,
    transientError: sawTransientError ? firstTransientError : undefined,
  };
}

interface EvaluateListenerFilterParams {
  subscription: JobListenerSubscription;
  payload: unknown;
}

function evaluateListenerFilter(params: EvaluateListenerFilterParams): StoredFilterEvaluation {
  const filter = params.subscription.config.filter;
  if (filter === null || filter === undefined) return {kind: 'matched'};
  if (typeof filter !== 'string' || filter.trim() === '') {
    return evaluateStoredFilter({
      value: filter,
      context: projectWorkflowPredicateContext(
        params.subscription.kind === 'on' ? 'listener.on' : 'listener.until',
        {event: params.payload},
      ),
      invalidReason: 'Listener subscription filter must be a non-empty string when set',
      evaluationFailedReason: 'Listener filter evaluation failed',
    });
  }

  const snapshot = readFilterSnapshot(params.subscription);
  if (snapshot.kind === 'invalid') return snapshot.result;

  return evaluateStoredFilter({
    value: filter,
    context: projectWorkflowPredicateContext(
      params.subscription.kind === 'on' ? 'listener.on' : 'listener.until',
      {...snapshot.value, event: params.payload},
    ),
    invalidReason: 'Listener subscription filter must be a non-empty string when set',
    evaluationFailedReason: 'Listener filter evaluation failed',
  });
}

function readFilterSnapshot(
  subscription: JobListenerSubscription,
):
  | {kind: 'valid'; value: Record<string, unknown>}
  | {kind: 'invalid'; result: Extract<StoredFilterEvaluation, {kind: 'filter-error'}>} {
  const value = subscription.config.filter_snapshot;
  if (value === undefined) return {kind: 'valid', value: {}};
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return {kind: 'valid', value: value as Record<string, unknown>};
  }
  return {
    kind: 'invalid',
    result: {
      kind: 'filter-error',
      reason: 'Listener filter snapshot must be an object when set',
    },
  };
}

function listenerDisposition(subscription: JobListenerSubscription): 'fire' | 'resolve' {
  return subscription.kind === 'until' ? 'resolve' : 'fire';
}

function listenerMatcherSortKey(subscription: JobListenerSubscription): string {
  const kindRank = subscription.kind === 'until' ? '0' : '1';
  return `${kindRank}:${subscription.matcherOrdinal.toString().padStart(10, '0')}`;
}

function shouldReplaceEffectiveMatcher(
  previous: JobListenerSubscription,
  candidate: JobListenerSubscription,
): boolean {
  const previousKey = listenerMatcherSortKey(previous);
  const candidateKey = listenerMatcherSortKey(candidate);
  if (candidateKey !== previousKey) return candidateKey < previousKey;

  logger().warn(
    {
      jobId: candidate.jobId,
      keptSubscriptionId: previous.id,
      candidateSubscriptionId: candidate.id,
      matcherKind: candidate.kind,
      matcherOrdinal: candidate.matcherOrdinal,
    },
    'duplicate job listener matcher key encountered; choosing deterministic subscription id order',
  );
  return candidate.id < previous.id;
}
