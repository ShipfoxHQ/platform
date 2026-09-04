import {
  WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT,
  workflowRunJobExplanationsResponseSchema,
} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  type UseInfiniteQueryOptions,
  useInfiniteQuery,
} from '@tanstack/react-query';
import {useMemo} from 'react';
import type {RunJobExplanation} from '#core/run-annotation.js';
import {type RunJobExplanationPage, toRunJobExplanationPage} from './run-annotation-mapper.js';
import {paginatedWorkflowResourceQueryOptions} from './workflow-resource-query.js';

export const runJobExplanationsQueryKeys = {
  all: ['run-job-explanations'] as const,
  list: (workflowRunId: string, runAttempt?: number | undefined) =>
    [...runJobExplanationsQueryKeys.all, 'list', workflowRunId, runAttempt ?? null] as const,
};

type RunJobExplanationsQueryKey =
  | ReturnType<typeof runJobExplanationsQueryKeys.list>
  | readonly ['run-job-explanations', 'list'];

type RunJobExplanationsQueryOptions = UseInfiniteQueryOptions<
  RunJobExplanationPage,
  Error,
  InfiniteData<RunJobExplanationPage, string | undefined>,
  RunJobExplanationsQueryKey,
  string | undefined
>;

async function listRunJobExplanations({
  workflowRunId,
  runAttempt,
  cursor,
  signal,
}: {
  workflowRunId: string;
  runAttempt: number;
  cursor?: string | undefined;
  signal?: AbortSignal;
}): Promise<RunJobExplanationPage> {
  const params = new URLSearchParams({
    attempt: String(runAttempt),
    limit: String(WORKFLOW_RUN_JOB_EXPLANATIONS_PAGE_LIMIT),
  });
  if (cursor) params.set('cursor', cursor);

  return toRunJobExplanationPage(
    await checkedApiRequest(
      workflowRunJobExplanationsResponseSchema,
      `/workflows/runs/${workflowRunId}/job-explanations?${params.toString()}`,
      {signal},
    ),
  );
}

export interface RunJobExplanationsQueryInput {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  enabled?: boolean | undefined;
  /** Poll while the run attempt is non-terminal, then settle. */
  live?: boolean | undefined;
}

export function runJobExplanationsQueryOptions({
  workflowRunId,
  runAttempt,
  enabled: enabledOption = true,
  live = false,
}: RunJobExplanationsQueryInput): RunJobExplanationsQueryOptions {
  const enabled = Boolean(workflowRunId) && runAttempt !== undefined && enabledOption;

  return paginatedWorkflowResourceQueryOptions({
    queryKey: workflowRunId
      ? runJobExplanationsQueryKeys.list(workflowRunId, runAttempt)
      : ([...runJobExplanationsQueryKeys.all, 'list'] as const),
    enabled,
    live,
    queryFn: ({pageParam, signal}) =>
      listRunJobExplanations({
        workflowRunId: workflowRunId ?? '',
        runAttempt: runAttempt ?? 1,
        cursor: pageParam,
        signal,
      }),
  });
}

export interface RunJobExplanationsQueryResult {
  query: ReturnType<
    typeof useInfiniteQuery<
      RunJobExplanationPage,
      Error,
      InfiniteData<RunJobExplanationPage, string | undefined>,
      RunJobExplanationsQueryKey,
      string | undefined
    >
  >;
  explanations: RunJobExplanation[] | undefined;
}

export function useRunJobExplanationsQuery(
  input: RunJobExplanationsQueryInput,
): RunJobExplanationsQueryResult {
  const query = useInfiniteQuery(runJobExplanationsQueryOptions(input));
  const pages = query.data?.pages;
  const explanations = useMemo(
    () => (pages ? pages.flatMap((page) => page.explanations) : undefined),
    [pages],
  );

  return {query, explanations};
}
