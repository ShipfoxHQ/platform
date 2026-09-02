import {
  WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER,
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
  workflowRunDetailResponseSchema,
  workflowRunLineageHeadResponseSchema,
  workflowRunOverviewJobsResponseSchema,
  workflowRunOverviewResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ApiError, checkedApiRequest, isInvalidApiResponseError} from '@shipfox/client-api';
import {
  type InfiniteData,
  infiniteQueryOptions,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  isWorkflowRunTerminal,
  type WorkflowRunLineageHead,
  type WorkflowRunOverview,
  type WorkflowRunOverviewJobPage,
} from '#core/workflow-run.js';
import {
  toWorkflowRunLineageHead,
  toWorkflowRunOverview,
  toWorkflowRunOverviewFromDetail,
  toWorkflowRunOverviewJobPage,
} from './workflow-run-mapper.js';
import {workflowRunsQueryKeys} from './workflow-runs.js';

export const WORKFLOW_RUN_OVERVIEW_STALE_TIME_MS = 2_000;
export const WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS = 4_000;
export const WORKFLOW_RUN_LINEAGE_HEAD_STALE_TIME_MS = 30_000;

export const workflowRunOverviewQueryKeys = {
  head: workflowRunsQueryKeys.head,
  overview: workflowRunsQueryKeys.overview,
  jobs: workflowRunsQueryKeys.overviewJobs,
};

type WorkflowRunLineageHeadQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.head>
  | readonly ['workflow-runs', 'head'];
type WorkflowRunOverviewQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.overview>
  | readonly ['workflow-runs', 'overview'];
type WorkflowRunOverviewJobsQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.overviewJobs>
  | readonly ['workflow-runs', 'overview-jobs'];
type WorkflowRunLineageHeadQueryOptions = UseQueryOptions<
  WorkflowRunLineageHead,
  Error,
  WorkflowRunLineageHead,
  WorkflowRunLineageHeadQueryKey
>;
type WorkflowRunOverviewQueryOptions = UseQueryOptions<
  WorkflowRunOverview,
  Error,
  WorkflowRunOverview,
  WorkflowRunOverviewQueryKey
>;
type WorkflowRunOverviewJobsQueryOptions = UseInfiniteQueryOptions<
  WorkflowRunOverviewJobPage,
  Error,
  InfiniteData<WorkflowRunOverviewJobPage, string | null>,
  WorkflowRunOverviewJobsQueryKey,
  string | null
>;

export interface WorkflowRunLineageHeadQueryInput {
  workflowRunId: string | undefined;
  initialData?: WorkflowRunLineageHead | undefined;
  enabled?: boolean | undefined;
}

export function workflowRunLineageHeadQueryOptions({
  workflowRunId,
  initialData,
  enabled = true,
}: WorkflowRunLineageHeadQueryInput): WorkflowRunLineageHeadQueryOptions {
  return queryOptions({
    queryKey: workflowRunId
      ? workflowRunsQueryKeys.head(workflowRunId)
      : ([...workflowRunsQueryKeys.all, 'head'] as const),
    enabled: Boolean(workflowRunId) && enabled,
    queryFn: ({signal}) => getWorkflowRunLineageHead(workflowRunId ?? '', signal),
    ...(initialData === undefined ? {} : {initialData, initialDataUpdatedAt: 0}),
    staleTime: WORKFLOW_RUN_LINEAGE_HEAD_STALE_TIME_MS,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: false,
  });
}

export function useWorkflowRunLineageHeadQuery(input: WorkflowRunLineageHeadQueryInput) {
  return useQuery(workflowRunLineageHeadQueryOptions(input));
}

async function getWorkflowRunLineageHead(
  workflowRunId: string,
  signal?: AbortSignal,
): Promise<WorkflowRunLineageHead> {
  try {
    return toWorkflowRunLineageHead(
      await checkedApiRequest(
        workflowRunLineageHeadResponseSchema,
        `/workflows/runs/${workflowRunId}/head`,
        {signal},
      ),
    );
  } catch (error) {
    if (!isLegacyOverviewEndpointError(error)) throw error;
    const detail = await checkedApiRequest(
      workflowRunDetailResponseSchema,
      `/workflows/runs/${workflowRunId}`,
      {
        headers: {[WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER]: 'bridge'},
        signal,
      },
    );
    return {
      currentAttempt: detail.current_attempt,
      latestAttempt: detail.latest_attempt,
      currentStatus: detail.run_attempt.status,
      updatedAt: detail.updated_at,
    };
  }
}

export interface WorkflowRunOverviewQueryInput {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  enabled?: boolean | undefined;
}

export function workflowRunOverviewQueryOptions({
  workflowRunId,
  runAttempt,
  enabled = true,
}: WorkflowRunOverviewQueryInput): WorkflowRunOverviewQueryOptions {
  const queryEnabled = Boolean(workflowRunId) && runAttempt !== undefined && enabled;
  return queryOptions({
    queryKey:
      workflowRunId && runAttempt !== undefined
        ? workflowRunsQueryKeys.overview(workflowRunId, runAttempt)
        : ([...workflowRunsQueryKeys.all, 'overview'] as const),
    enabled: queryEnabled,
    queryFn: ({signal}) => getWorkflowRunOverview(workflowRunId ?? '', runAttempt ?? 0, signal),
    staleTime: (query) =>
      isWorkflowRunTerminal(query.state.data?.runAttempt.status ?? 'pending')
        ? Infinity
        : WORKFLOW_RUN_OVERVIEW_STALE_TIME_MS,
    refetchOnWindowFocus: (query) =>
      !isWorkflowRunTerminal(query.state.data?.runAttempt.status ?? 'pending'),
    refetchInterval: (query) => {
      const status = query.state.data?.runAttempt.status;
      if (!queryEnabled || (status && isWorkflowRunTerminal(status))) return false;
      return WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS;
    },
    refetchIntervalInBackground: false,
  });
}

export function useWorkflowRunOverviewQuery(input: WorkflowRunOverviewQueryInput) {
  return useQuery(workflowRunOverviewQueryOptions(input));
}

async function getWorkflowRunOverview(
  workflowRunId: string,
  runAttempt: number,
  signal?: AbortSignal,
): Promise<WorkflowRunOverview> {
  const params = new URLSearchParams({attempt: String(runAttempt)});
  try {
    return toWorkflowRunOverview(
      await checkedApiRequest(
        workflowRunOverviewResponseSchema,
        `/workflows/runs/${workflowRunId}/overview?${params.toString()}`,
        {signal},
      ),
    );
  } catch (error) {
    // Keep the retained legacy endpoint as a short-lived mixed-deployment bridge. Only an
    // unavailable endpoint or an old-shaped successful payload falls back; operational errors
    // still belong to the overview query.
    if (!isLegacyOverviewEndpointError(error)) throw error;
    return toWorkflowRunOverviewFromDetail(
      await checkedApiRequest(
        workflowRunDetailResponseSchema,
        `/workflows/runs/${workflowRunId}?${params.toString()}`,
        {
          headers: {[WORKFLOW_RUN_DETAIL_REQUEST_KIND_HEADER]: 'bridge'},
          signal,
        },
      ),
    );
  }
}

function isLegacyOverviewEndpointError(error: unknown): boolean {
  return (
    isInvalidApiResponseError(error) ||
    (error instanceof ApiError && (error.status === 404 || error.status === 405))
  );
}

export interface WorkflowRunOverviewJobsQueryInput {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  initialPage?: WorkflowRunOverviewJobPage | undefined;
  enabled?: boolean | undefined;
}

export function workflowRunOverviewJobsInfiniteQueryOptions({
  workflowRunId,
  runAttempt,
  initialPage,
  enabled = true,
}: WorkflowRunOverviewJobsQueryInput): WorkflowRunOverviewJobsQueryOptions {
  const queryEnabled = Boolean(workflowRunId) && runAttempt !== undefined && enabled;
  return infiniteQueryOptions({
    queryKey:
      workflowRunId && runAttempt !== undefined
        ? workflowRunsQueryKeys.overviewJobs(workflowRunId, runAttempt)
        : ([...workflowRunsQueryKeys.all, 'overview-jobs'] as const),
    enabled: queryEnabled,
    initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) =>
      getWorkflowRunOverviewJobs(workflowRunId ?? '', runAttempt ?? 0, pageParam, signal),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    ...(initialPage === undefined
      ? {}
      : {
          initialData: {
            pages: [initialPage],
            pageParams: [null],
          },
        }),
    staleTime: WORKFLOW_RUN_LINEAGE_HEAD_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

export function useWorkflowRunOverviewJobsInfiniteQuery(input: WorkflowRunOverviewJobsQueryInput) {
  return useInfiniteQuery(workflowRunOverviewJobsInfiniteQueryOptions(input));
}

async function getWorkflowRunOverviewJobs(
  workflowRunId: string,
  runAttempt: number,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<WorkflowRunOverviewJobPage> {
  const params = new URLSearchParams({
    attempt: String(runAttempt),
    limit: String(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT),
  });
  if (cursor) params.set('cursor', cursor);
  return toWorkflowRunOverviewJobPage(
    await checkedApiRequest(
      workflowRunOverviewJobsResponseSchema,
      `/workflows/runs/${workflowRunId}/jobs?${params.toString()}`,
      {signal},
    ),
  );
}
