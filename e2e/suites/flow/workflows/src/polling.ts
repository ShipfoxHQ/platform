import {setTimeout as delay} from 'node:timers/promises';
import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import type {WorkflowRunListResponseDto} from '@shipfox/api-workflows-dto';
import {type ApiFetch, createApiClient} from '@shipfox/e2e-core';
import {
  observeRun,
  type WorkflowRunObservation,
  type WorkflowRunObservationSelection,
} from '@shipfox/e2e-observe-workflows';

const OBSERVATION_ATTEMPT_TIMEOUT_MS = 500;

export interface PollingOptions {
  fetch?: ApiFetch | undefined;
  projectId: string;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  token: string;
}

export async function waitForDefinitionSyncTerminal(
  options: PollingOptions,
): Promise<DefinitionListResponseDto> {
  const client = createApiClient({fetch: options.fetch, token: options.token});
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse: DefinitionListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<DefinitionListResponseDto>(
      'get',
      `/definitions?${params}`,
      {signal: options.signal},
    );

    const status = lastResponse.sync?.status;
    if (status === 'failed' || status === 'succeeded') return lastResponse;

    await delay(250, undefined, {signal: options.signal});
  }

  const status = lastResponse?.sync?.status ?? 'null';
  throw new Error(`Timed out waiting for definition sync to settle: syncStatus=${status}`);
}

export async function waitForNoWorkflowRuns(
  options: PollingOptions,
): Promise<WorkflowRunListResponseDto> {
  const client = createApiClient({fetch: options.fetch, token: options.token});
  const deadline = Date.now() + options.timeoutMs;
  let lastResponse: WorkflowRunListResponseDto | null = null;

  while (Date.now() <= deadline) {
    options.signal?.throwIfAborted();
    const params = new URLSearchParams({project_id: options.projectId, limit: '100'});
    lastResponse = await client.requestJson<WorkflowRunListResponseDto>(
      'get',
      `/workflows/runs?${params}`,
      {signal: options.signal},
    );
    if (lastResponse.runs.length > 0) return lastResponse;

    await delay(250, undefined, {signal: options.signal});
  }

  return lastResponse ?? {runs: [], next_cursor: null, filtered_total_count: null};
}

export async function waitForRunObservationMatching(params: {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
  runId: string;
  signal?: AbortSignal | undefined;
  timeoutMs: number;
  description: string;
  selection?: WorkflowRunObservationSelection | undefined;
  matches: (observation: WorkflowRunObservation) => {matched: boolean; diagnostic: string};
}): Promise<WorkflowRunObservation> {
  const deadline = Date.now() + params.timeoutMs;
  let lastDiagnostic = 'no bounded workflow observation observed';

  while (Date.now() <= deadline) {
    params.signal?.throwIfAborted();
    try {
      const observation = await observeRun({
        apiUrl: params.apiUrl,
        fetch: params.fetch,
        runId: params.runId,
        selection: params.selection,
        signal: params.signal,
        timeoutMs: OBSERVATION_ATTEMPT_TIMEOUT_MS,
        token: params.token,
      });
      const result = params.matches(observation);
      if (result.matched) return observation;
      lastDiagnostic = result.diagnostic;
    } catch (error) {
      params.signal?.throwIfAborted();
      if (lastDiagnostic === 'no bounded workflow observation observed') {
        lastDiagnostic = error instanceof Error ? error.message : String(error);
      }
    }
    if (Date.now() > deadline) break;
    await delay(250, undefined, {signal: params.signal});
  }

  throw new Error(`Timed out waiting for ${params.description}: ${lastDiagnostic}`);
}
