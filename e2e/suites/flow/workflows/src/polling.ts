import {setTimeout as delay} from 'node:timers/promises';
import type {DefinitionListResponseDto} from '@shipfox/api-definitions-dto';
import type {WorkflowRunListResponseDto} from '@shipfox/api-workflows-dto';
import {type ApiFetch, createApiClient, E2eApiError} from '@shipfox/e2e-core';
import {
  observeRun,
  type WorkflowRunObservation,
  type WorkflowRunObservationSelection,
} from '@shipfox/e2e-observe-workflows';

const OBSERVATION_ATTEMPT_TIMEOUT_MS = 500;
const NO_OBSERVATION_DIAGNOSTIC = 'no bounded workflow observation observed';

function isRetryableObservationError(error: unknown): boolean {
  if (error instanceof E2eApiError) return error.status === 404;
  if (!(error instanceof Error)) return false;
  return error.message.startsWith('Timed out while reading ');
}

type ObservationMatchOptions = {
  apiUrl?: string | undefined;
  fetch?: ApiFetch | undefined;
  token: string;
  runId: string;
  signal?: AbortSignal | undefined;
  selection?: WorkflowRunObservationSelection | undefined;
  matches: (observation: WorkflowRunObservation) => {matched: boolean; diagnostic: string};
};

type ObservationMatchAttempt =
  | {kind: 'matched'; observation: WorkflowRunObservation}
  | {kind: 'unmatched'; diagnostic: string}
  | {kind: 'retry'; diagnostic: string};

async function observeForMatch(params: ObservationMatchOptions): Promise<ObservationMatchAttempt> {
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
    return result.matched
      ? {kind: 'matched', observation}
      : {kind: 'unmatched', diagnostic: result.diagnostic};
  } catch (error) {
    params.signal?.throwIfAborted();
    if (!isRetryableObservationError(error)) throw error;
    return {kind: 'retry', diagnostic: error instanceof Error ? error.message : String(error)};
  }
}

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

export async function waitForRunObservationMatching(
  params: ObservationMatchOptions & {
    timeoutMs: number;
    description: string;
  },
): Promise<WorkflowRunObservation> {
  const deadline = Date.now() + params.timeoutMs;
  let lastDiagnostic = NO_OBSERVATION_DIAGNOSTIC;

  while (Date.now() <= deadline) {
    params.signal?.throwIfAborted();
    const attempt = await observeForMatch(params);
    if (attempt.kind === 'matched') return attempt.observation;
    if (attempt.kind === 'unmatched') lastDiagnostic = attempt.diagnostic;
    if (attempt.kind === 'retry' && lastDiagnostic === NO_OBSERVATION_DIAGNOSTIC) {
      lastDiagnostic = attempt.diagnostic;
    }
    if (Date.now() > deadline) break;
    await delay(250, undefined, {signal: params.signal});
  }

  throw new Error(`Timed out waiting for ${params.description}: ${lastDiagnostic}`);
}
