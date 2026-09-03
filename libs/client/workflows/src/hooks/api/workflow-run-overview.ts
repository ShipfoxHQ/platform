import {
  WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT,
  workflowRunLineageHeadResponseSchema,
  workflowRunOverviewJobsResponseSchema,
  workflowRunOverviewResponseSchema,
  workflowRunSourceResponseSchema,
} from '@shipfox/api-workflows-dto';
import {ApiError, checkedApiRequest, isInvalidApiResponseError} from '@shipfox/client-api';
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import {
  isWorkflowRunTerminal,
  type WorkflowRunDetail,
  type WorkflowRunLineageHead,
  type WorkflowRunOverview,
  type WorkflowRunOverviewJobPage,
  type WorkflowRunSource,
} from '#core/workflow-run.js';
import {
  legacyWorkflowRunOverviewJobsOffset,
  toWorkflowRunLineageHead,
  toWorkflowRunOverview,
  toWorkflowRunOverviewFromRunDetail,
  toWorkflowRunOverviewJobPage,
  toWorkflowRunOverviewJobsPageFromRunDetail,
  toWorkflowRunSource,
} from './workflow-run-mapper.js';
import {workflowRunQueryOptions, workflowRunsQueryKeys} from './workflow-runs.js';

export const WORKFLOW_RUN_OVERVIEW_STALE_TIME_MS = 2_000;
export const WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS = 4_000;
export const WORKFLOW_RUN_LINEAGE_HEAD_STALE_TIME_MS = 30_000;

export const workflowRunOverviewQueryKeys = {
  head: workflowRunsQueryKeys.head,
  overview: workflowRunsQueryKeys.overview,
  jobs: workflowRunsQueryKeys.overviewJobs,
  source: workflowRunsQueryKeys.source,
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
type WorkflowRunSourceQueryKey =
  | ReturnType<typeof workflowRunOverviewQueryKeys.source>
  | readonly ['workflow-runs', 'source'];
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
type WorkflowRunSourceQueryOptions = UseQueryOptions<
  WorkflowRunSource,
  Error,
  WorkflowRunSource,
  WorkflowRunSourceQueryKey
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
    queryFn: ({signal, client}) => getWorkflowRunLineageHead(workflowRunId ?? '', client, signal),
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
  client: QueryClient,
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
    const detail = await getLegacyWorkflowRunDetail(client, workflowRunId, undefined, signal);
    return {
      currentAttempt: detail.currentAttempt,
      latestAttempt: detail.latestAttempt,
      currentStatus: detail.runAttempt.status,
      updatedAt: detail.updatedAt,
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
    queryFn: ({signal, client}) =>
      getWorkflowRunOverview(workflowRunId ?? '', runAttempt ?? 0, client, signal),
    staleTime: (query) =>
      isWorkflowRunTerminal(query.state.data?.runAttempt.status ?? 'pending')
        ? Infinity
        : WORKFLOW_RUN_OVERVIEW_STALE_TIME_MS,
    refetchOnWindowFocus: (query) =>
      !isWorkflowRunTerminal(query.state.data?.runAttempt.status ?? 'pending'),
    refetchInterval: (query) => {
      const status = query.state.data?.runAttempt.status;
      if (
        !queryEnabled ||
        (query.state.error !== null && query.state.data === undefined) ||
        (status && isWorkflowRunTerminal(status))
      ) {
        return false;
      }
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
  client: QueryClient,
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
    return toWorkflowRunOverviewFromRunDetail(
      await getLegacyWorkflowRunDetail(client, workflowRunId, runAttempt, signal),
    );
  }
}

function getLegacyWorkflowRunDetail(
  client: QueryClient,
  workflowRunId: string,
  runAttempt?: number,
  signal?: AbortSignal,
): Promise<WorkflowRunDetail> {
  if (runAttempt !== undefined) {
    const currentDetail = client.getQueryData<WorkflowRunDetail>(
      workflowRunsQueryKeys.detail(workflowRunId),
    );
    if (currentDetail?.runAttempt.attempt === runAttempt) return Promise.resolve(currentDetail);
  }
  return client.fetchQuery(
    workflowRunQueryOptions({
      workflowRunId,
      runAttempt,
      requestKind: 'bridge',
      requestSignal: signal,
    }),
  );
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
  polling?: boolean | undefined;
  enabled?: boolean | undefined;
}

export function workflowRunOverviewJobsInfiniteQueryOptions({
  workflowRunId,
  runAttempt,
  initialPage,
  polling = true,
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
    queryFn: ({pageParam, signal, client}) =>
      getWorkflowRunOverviewJobs(workflowRunId ?? '', runAttempt ?? 0, pageParam, client, signal),
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
    refetchInterval: (query) =>
      polling && query.state.data?.pages.length === 1
        ? WORKFLOW_RUN_OVERVIEW_ACTIVE_POLL_MS
        : false,
  });
}

export function useWorkflowRunOverviewJobsInfiniteQuery(input: WorkflowRunOverviewJobsQueryInput) {
  return useInfiniteQuery(workflowRunOverviewJobsInfiniteQueryOptions(input));
}

async function getWorkflowRunOverviewJobs(
  workflowRunId: string,
  runAttempt: number,
  cursor: string | null,
  client: QueryClient,
  signal?: AbortSignal,
): Promise<WorkflowRunOverviewJobPage> {
  const legacyOffset = legacyWorkflowRunOverviewJobsOffset(cursor);
  if (cursor !== null && legacyOffset !== undefined) {
    const detail = await getLegacyWorkflowRunDetail(client, workflowRunId, runAttempt, signal);
    return toWorkflowRunOverviewJobsPageFromRunDetail(detail, legacyOffset);
  }

  const params = new URLSearchParams({
    attempt: String(runAttempt),
    limit: String(WORKFLOW_RUN_OVERVIEW_LARGE_JOB_PAGE_LIMIT),
  });
  if (cursor) params.set('cursor', cursor);
  try {
    return toWorkflowRunOverviewJobPage(
      await checkedApiRequest(
        workflowRunOverviewJobsResponseSchema,
        `/workflows/runs/${workflowRunId}/jobs?${params.toString()}`,
        {signal},
      ),
    );
  } catch (error) {
    if (!isLegacyOverviewEndpointError(error) || (cursor !== null && legacyOffset === undefined)) {
      throw error;
    }
    const detail = await getLegacyWorkflowRunDetail(client, workflowRunId, runAttempt, signal);
    return toWorkflowRunOverviewJobsPageFromRunDetail(detail, legacyOffset ?? 0);
  }
}

export interface WorkflowRunSourceQueryInput {
  workflowRunId: string | undefined;
  enabled?: boolean | undefined;
}

export function workflowRunSourceQueryOptions({
  workflowRunId,
  enabled = true,
}: WorkflowRunSourceQueryInput): WorkflowRunSourceQueryOptions {
  return queryOptions({
    queryKey: workflowRunId
      ? workflowRunOverviewQueryKeys.source(workflowRunId)
      : ([...workflowRunsQueryKeys.all, 'source'] as const),
    enabled: Boolean(workflowRunId) && enabled,
    queryFn: ({signal}) => getWorkflowRunSource(workflowRunId ?? '', signal),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchInterval: false,
  });
}

export function useWorkflowRunSourceQuery(input: WorkflowRunSourceQueryInput) {
  return useQuery(workflowRunSourceQueryOptions(input));
}

async function getWorkflowRunSource(
  workflowRunId: string,
  signal?: AbortSignal,
): Promise<WorkflowRunSource> {
  return toWorkflowRunSource(
    await checkedApiRequest(
      workflowRunSourceResponseSchema,
      `/workflows/runs/${workflowRunId}/source`,
      {signal},
    ),
  );
}
