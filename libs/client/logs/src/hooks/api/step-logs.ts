import {readLogsResponseSchema} from '@shipfox/api-logs-dto';
import {ApiError, checkedApiRequest} from '@shipfox/client-api';
import {useQuery, useQueryClient} from '@tanstack/react-query';
import {useCallback, useRef} from 'react';
import {
  mergeLogRead,
  STEP_LOG_LIVE_REFETCH_MS,
  type StepLogSnapshot,
  stepLogRefetchInterval,
} from '#core/log-read.js';
import {parseLogNdjson, toLogRead} from './log-mapper.js';

export const stepLogsQueryKeys = {
  all: ['step-logs'] as const,
  detail: (stepId: string, attempt: number) =>
    [...stepLogsQueryKeys.all, 'detail', stepId, attempt] as const,
};

interface ReadStepAttemptLogsPageParams {
  stepId: string;
  attempt: number;
  cursor: number;
  signal?: AbortSignal;
}

export async function readStepAttemptLogsPage({
  stepId,
  attempt,
  cursor,
  signal,
}: ReadStepAttemptLogsPageParams) {
  const params = new URLSearchParams({cursor: String(cursor)});
  const response = await checkedApiRequest(
    readLogsResponseSchema,
    `/steps/${encodeURIComponent(stepId)}/attempts/${attempt}/logs?${params.toString()}`,
    {signal},
  );
  return toLogRead(response);
}

class StepLogObjectFetchError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Could not load compacted logs (${status})`);
    this.name = 'StepLogObjectFetchError';
    this.status = status;
  }
}

async function readPresignedLogObject(url: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(url, signal ? {signal} : undefined);
  if (!response.ok) throw new StepLogObjectFetchError(response.status);
  return await response.text();
}

export function isMissingStepLogStreamError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'not-found';
}

export interface UseStepAttemptLogsQueryOptions {
  retryMissingStream?: boolean;
  missingStreamRetryCount?: number | undefined;
  missingStreamRetryDelayMs?: number | undefined;
  initialErrorRetryCount?: number;
  initialErrorRetryDelayMs?: number;
}

/**
 * Narrow React Query wrapper for step logs. Its query function can read the prior
 * snapshot imperatively, but bounded missing-stream retries need a ref that resets
 * when the step, attempt, or retry budget changes. Keep that lifecycle state here
 * rather than exporting query options that could accidentally share it between views.
 */
export function useStepAttemptLogsQuery(
  stepId: string | undefined,
  attempt: number | undefined,
  options: UseStepAttemptLogsQueryOptions = {},
) {
  const queryClient = useQueryClient();
  const missingStreamFailureCountRef = useRef(0);
  const missingStreamScopeRef = useRef<string | null>(null);
  const manualRefetchRef = useRef(false);
  const enabled = Boolean(stepId && attempt && Number.isInteger(attempt) && attempt > 0);
  const queryKey =
    enabled && stepId && attempt
      ? stepLogsQueryKeys.detail(stepId, attempt)
      : [...stepLogsQueryKeys.all, 'detail'];
  const missingStreamScope =
    enabled && stepId && attempt
      ? `${stepId}:${attempt}:${options.missingStreamRetryCount ?? 'unbounded'}`
      : null;
  if (missingStreamScopeRef.current !== missingStreamScope) {
    missingStreamScopeRef.current = missingStreamScope;
    missingStreamFailureCountRef.current = 0;
  }
  const initialErrorRetryCount = options.initialErrorRetryCount ?? 0;
  const initialErrorRetryDelayMs = options.initialErrorRetryDelayMs ?? STEP_LOG_LIVE_REFETCH_MS;
  const missingStreamRetryDelayMs = options.missingStreamRetryDelayMs ?? STEP_LOG_LIVE_REFETCH_MS;

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async ({signal}) => {
      const previous = queryClient.getQueryData<StepLogSnapshot>(queryKey);
      const manualRefetch = manualRefetchRef.current;
      manualRefetchRef.current = false;
      let response: Awaited<ReturnType<typeof readStepAttemptLogsPage>>;
      try {
        response = await readStepAttemptLogsPage({
          stepId: stepId ?? '',
          attempt: attempt ?? 0,
          cursor: previous?.nextCursor ?? 0,
          signal,
        });
      } catch (error) {
        if (
          options.retryMissingStream &&
          previous === undefined &&
          isMissingStepLogStreamError(error) &&
          !manualRefetch
        ) {
          const retryCount = options.missingStreamRetryCount;
          if (retryCount === undefined) throw error;
          if (missingStreamFailureCountRef.current >= retryCount) {
            return emptyCompleteLogSnapshot();
          }
          missingStreamFailureCountRef.current += 1;
        }
        throw error;
      }

      missingStreamFailureCountRef.current = 0;

      if (response.mode === 'presigned') {
        const ndjson = await readPresignedLogObject(response.url, signal);
        return mergeLogRead(previous, {
          mode: 'presigned',
          response,
          records: parseLogNdjson(ndjson),
        });
      }

      return mergeLogRead(previous, {
        mode: 'inline',
        response,
        records: parseLogNdjson(response.ndjson),
      });
    },
    retry: (failureCount, error) => {
      if (initialErrorRetryCount <= 0) return false;
      if (queryClient.getQueryData<StepLogSnapshot>(queryKey) !== undefined) return false;
      if (options.retryMissingStream && isMissingStepLogStreamError(error)) return false;
      return failureCount < initialErrorRetryCount;
    },
    retryDelay: initialErrorRetryDelayMs,
    refetchInterval: (query) => {
      if (
        options.retryMissingStream &&
        query.state.data === undefined &&
        isMissingStepLogStreamError(query.state.error)
      ) {
        return missingStreamRetryDelayMs;
      }

      return stepLogRefetchInterval(query.state.data, query.state.status === 'error');
    },
    refetchIntervalInBackground: false,
    refetchOnMount: (query) => !query.state.data?.complete,
    refetchOnWindowFocus: (query) => !query.state.data?.complete,
    refetchOnReconnect: (query) => !query.state.data?.complete,
  });

  const refetchLogs = useCallback(() => {
    // React Query reuses an in-flight request when it has no cached data. Only
    // mark a refetch as manual when this call can start a new request; otherwise
    // the marker would be consumed by the next automatic poll.
    if (!query.isFetching || query.data !== undefined) {
      manualRefetchRef.current = true;
    }
    return query.refetch();
  }, [query.data, query.isFetching, query.refetch]);

  return {...query, refetchLogs};
}

function emptyCompleteLogSnapshot(): StepLogSnapshot {
  return {
    records: [],
    nextCursor: 0,
    source: 'inline',
    state: 'closed',
    complete: true,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
  };
}
