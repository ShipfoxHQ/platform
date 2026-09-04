import type {WebhookConnectionDto} from '@shipfox/api-integration-webhook-dto';
import type {
  JobStatusDto,
  ListenerStatusDto,
  ResolutionReasonDto,
} from '@shipfox/api-workflows-dto';
import {type createApiClient, pollUntil, requestJson} from '@shipfox/e2e-core';
import type {
  WorkflowExecutionObservation,
  WorkflowJobObservation,
  WorkflowRunObservation,
} from '@shipfox/e2e-observe-workflows';
import {observeRun} from '@shipfox/e2e-observe-workflows';
import {waitForRunObservationMatching} from './polling.js';
import {postWebhookDelivery} from './webhook.js';

export interface ListenerPredicateResult {
  matched: boolean;
  diagnostic: string;
}

export function findListenerJob(
  observation: WorkflowRunObservation,
  jobKey: string,
): WorkflowJobObservation | undefined {
  return observation.jobs.find((job) => job.key === jobKey && job.mode === 'listening');
}

export function listenerExecutionCountMatches(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  count: number;
}): ListenerPredicateResult {
  const job = findListenerJob(params.observation, params.jobKey);
  if (!job) {
    return {
      matched: false,
      diagnostic: `listener job ${params.jobKey} missing`,
    };
  }
  const actual = job.execution_count;
  return {
    matched: actual === params.count,
    diagnostic: `listener job ${params.jobKey} executionCount=${actual}, expected=${params.count}`,
  };
}

export function listenerStatusMatches(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  listenerStatus: ListenerStatusDto;
}): ListenerPredicateResult {
  const job = findListenerJob(params.observation, params.jobKey);
  if (!job) return {matched: false, diagnostic: `listener job ${params.jobKey} missing`};
  return {
    matched: job.listener_status === params.listenerStatus,
    diagnostic: `listener job ${params.jobKey} listenerStatus=${job.listener_status}, expected=${params.listenerStatus}`,
  };
}

export function listenerResolutionMatches(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  status: JobStatusDto;
  reason: ResolutionReasonDto;
}): ListenerPredicateResult {
  const job = findListenerJob(params.observation, params.jobKey);
  if (!job) return {matched: false, diagnostic: `listener job ${params.jobKey} missing`};
  const statusMatches = job.status === params.status;
  const listenerStatusMatches = job.listener_status === 'resolved';
  return {
    matched: statusMatches && listenerStatusMatches,
    diagnostic: `listener job ${params.jobKey} status=${job.status}, listenerStatus=${job.listener_status}, expected=${params.status}/resolved (resolution reason ${params.reason} is not exposed by bounded overview)`,
  };
}

export function listenerExecutionStatusMatches(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  sequence: number;
  status: WorkflowExecutionObservation['status'];
}): ListenerPredicateResult {
  const execution = findListenerExecutionBySequence(params);
  if (!execution) {
    return {
      matched: false,
      diagnostic: `listener job ${params.jobKey} execution ${params.sequence} missing`,
    };
  }
  return {
    matched: execution.status === params.status,
    diagnostic: `listener job ${params.jobKey} execution ${params.sequence} status=${execution.status}, expected=${params.status}`,
  };
}

export function listenerDeliveryObserved(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  deliveryId: string;
}): ListenerPredicateResult {
  const execution = findListenerExecutionByDeliveryId(params);
  if (execution) {
    return {
      matched: true,
      diagnostic: `listener job ${params.jobKey} observed delivery ${params.deliveryId} in execution ${execution.sequence}`,
    };
  }
  const job = findListenerJob(params.observation, params.jobKey);
  if (!job) return {matched: false, diagnostic: `listener job ${params.jobKey} missing`};
  const observed = job.executions.flatMap((candidate) =>
    candidate.trigger_events.map((event) => event.delivery_id),
  );
  return {
    matched: false,
    diagnostic: `listener job ${params.jobKey} did not observe delivery ${params.deliveryId}; observed=[${observed.join(', ')}]`,
  };
}

export function batchedListenerExecutionMatches(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  sequence: number;
  deliveryIds: string[];
}): ListenerPredicateResult {
  const execution = findListenerExecutionBySequence(params);
  if (!execution) {
    return {
      matched: false,
      diagnostic: `listener job ${params.jobKey} execution ${params.sequence} missing`,
    };
  }
  const observed = new Set(execution.trigger_events.map((event) => event.delivery_id));
  const missing = params.deliveryIds.filter((deliveryId) => !observed.has(deliveryId));
  return {
    matched: missing.length === 0 && execution.trigger_events.length === params.deliveryIds.length,
    diagnostic: `listener job ${params.jobKey} execution ${params.sequence} observed=[${[
      ...observed,
    ].join(', ')}], expected=[${params.deliveryIds.join(', ')}]`,
  };
}

export function findListenerExecutionByDeliveryId(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  deliveryId: string;
}): WorkflowExecutionObservation | undefined {
  const job = findListenerJob(params.observation, params.jobKey);
  return job?.executions.find((execution) =>
    execution.trigger_events.some((event) => event.delivery_id === params.deliveryId),
  );
}

export function findListenerExecutionByDeliveryIds(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  deliveryIds: string[];
}): {deliveryId: string; execution: WorkflowExecutionObservation} | undefined {
  const expected = new Set(params.deliveryIds);
  const job = findListenerJob(params.observation, params.jobKey);
  for (const execution of job?.executions ?? []) {
    const event = execution.trigger_events.find((candidate) => expected.has(candidate.delivery_id));
    if (event) return {deliveryId: event.delivery_id, execution};
  }
  return undefined;
}

export function findListenerExecutionBySequence(params: {
  observation: WorkflowRunObservation;
  jobKey: string;
  sequence: number;
}): WorkflowExecutionObservation | undefined {
  return findListenerJob(params.observation, params.jobKey)?.executions.find(
    (execution) => execution.sequence === params.sequence,
  );
}

export async function waitForListenerExecution(params: {
  token: string;
  runId: string;
  jobKey: string;
  sequence: number;
  status?: WorkflowExecutionObservation['status'] | undefined;
  timeoutMs: number;
}): Promise<WorkflowRunObservation> {
  return await waitForRunObservationMatching({
    token: params.token,
    runId: params.runId,
    timeoutMs: params.timeoutMs,
    description: `listener job ${params.jobKey} execution ${params.sequence}`,
    selection: {
      jobs: [{jobKey: params.jobKey, executionSequences: [params.sequence]}],
    },
    matches: (observation) => {
      if (params.status !== undefined) {
        return listenerExecutionStatusMatches({
          observation,
          jobKey: params.jobKey,
          sequence: params.sequence,
          status: params.status,
        });
      }
      return {
        matched:
          findListenerExecutionBySequence({
            observation,
            jobKey: params.jobKey,
            sequence: params.sequence,
          }) !== undefined,
        diagnostic: `listener job ${params.jobKey} execution ${params.sequence} missing`,
      };
    },
  });
}

export async function waitForListenerStatus(params: {
  token: string;
  runId: string;
  jobKey: string;
  listenerStatus: ListenerStatusDto;
  timeoutMs: number;
}): Promise<WorkflowRunObservation> {
  let diagnostic = `listener job ${params.jobKey} missing`;
  return await pollUntil(
    {
      timeoutMs: params.timeoutMs,
      intervalMs: 250,
      maxIntervalMs: 250,
      describe: () =>
        `listener job ${params.jobKey} status ${params.listenerStatus}: ${diagnostic}`,
    },
    async () => {
      const observation = await observeRun({
        runId: params.runId,
        selection: {jobs: [{jobKey: params.jobKey}]},
        token: params.token,
      });
      const status = listenerStatusMatches({...params, observation});
      diagnostic = status.diagnostic;
      if (!status.matched) return null;

      const job = findListenerJob(observation, params.jobKey);
      if (!job) return null;
      const readiness = await requestJson<{ready: boolean}>(
        'get',
        `/__e2e/triggers/listeners/${encodeURIComponent(job.id)}/readiness`,
        {},
      );
      diagnostic = readiness.ready
        ? `${status.diagnostic}, trigger subscriptions ready`
        : `${status.diagnostic}, trigger subscriptions pending`;
      return readiness.ready ? observation : null;
    },
  );
}

export async function waitForListenerResolution(params: {
  token: string;
  runId: string;
  jobKey: string;
  status: JobStatusDto;
  reason: ResolutionReasonDto;
  timeoutMs: number;
}): Promise<WorkflowRunObservation> {
  return await waitForRunObservationMatching({
    token: params.token,
    runId: params.runId,
    timeoutMs: params.timeoutMs,
    description: `listener job ${params.jobKey} resolution ${params.reason}`,
    selection: {jobs: [{jobKey: params.jobKey}]},
    matches: (observation) => listenerResolutionMatches({...params, observation}),
  });
}

export async function sendWebhookDeliveryUntilObserved(params: {
  client: ReturnType<typeof createApiClient>;
  connection: WebhookConnectionDto;
  runId: string;
  token: string;
  jobKey: string;
  deliveryIdPrefix: string;
  maxAttempts?: number | undefined;
  attemptTimeoutMs?: number | undefined;
  body: (attempt: number, deliveryId: string) => unknown;
}): Promise<{deliveryId: string; deliveryIds: string[]; observation: WorkflowRunObservation}> {
  const maxAttempts = params.maxAttempts ?? 8;
  const attemptTimeoutMs = params.attemptTimeoutMs ?? 5_000;
  const deliveryIds: string[] = [];
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const deliveryId = `${params.deliveryIdPrefix}-${attempt}`;
    deliveryIds.push(deliveryId);
    await postWebhookDelivery({
      client: params.client,
      connection: params.connection,
      deliveryId,
      webhook: {body: params.body(attempt, deliveryId)},
    });

    try {
      const observation = await waitForRunObservationMatching({
        token: params.token,
        runId: params.runId,
        timeoutMs: attemptTimeoutMs,
        description: `listener delivery ${deliveryId}`,
        selection: {
          jobs: [
            {
              jobKey: params.jobKey,
              executionSequences: 'all',
              includeContext: true,
              executionMatches: (execution) =>
                execution.trigger_events.some((event) => deliveryIds.includes(event.delivery_id)),
            },
          ],
        },
        matches: (candidate) => {
          const match = findListenerExecutionByDeliveryIds({
            observation: candidate,
            jobKey: params.jobKey,
            deliveryIds,
          });
          if (match) {
            return {
              matched: true,
              diagnostic: `listener job ${params.jobKey} observed delivery ${match.deliveryId} in execution ${match.execution.sequence}`,
            };
          }
          const observed = findListenerJob(candidate, params.jobKey)?.executions.flatMap(
            (execution) => execution.trigger_events.map((event) => event.delivery_id),
          );
          return {
            matched: false,
            diagnostic: `listener job ${params.jobKey} did not observe deliveries [${deliveryIds.join(', ')}]; observed=[${observed?.join(', ') ?? ''}]`,
          };
        },
      });
      const match = findListenerExecutionByDeliveryIds({
        observation,
        jobKey: params.jobKey,
        deliveryIds,
      });
      if (!match) throw new Error(`Observed listener delivery match disappeared for ${deliveryId}`);
      return {deliveryId: match.deliveryId, deliveryIds, observation};
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Listener delivery was not observed after ${maxAttempts} attempts`);
}
