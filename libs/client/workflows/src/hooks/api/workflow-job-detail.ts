import {
  WORKFLOW_JOB_EXECUTION_PAGE_LIMIT,
  WORKFLOW_JOB_STEP_PAGE_LIMIT,
  WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT,
  workflowExecutionStepsResponseSchema,
  workflowJobDetailResponseSchema,
  workflowJobExecutionSummariesResponseSchema,
  workflowStepAttemptSummariesResponseSchema,
} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';
import {
  isTerminalJobExecutionStatus,
  isTerminalJobStatus,
  type WorkflowExecutionStepsPage,
  type WorkflowJobDetail,
  type WorkflowJobExecutionPage,
  type WorkflowJobStepAttemptSummary,
  type WorkflowStepAttemptPage,
} from '#core/workflow-run.js';
import {
  toWorkflowExecutionStepsPage,
  toWorkflowJobDetail,
  toWorkflowJobExecutionPage,
  toWorkflowStepAttemptPage,
} from './workflow-job-detail-mapper.js';

export const WORKFLOW_JOB_DETAIL_ACTIVE_POLL_MS = 4_000;
export const WORKFLOW_JOB_DETAIL_STALE_TIME_MS = 2_000;
export const WORKFLOW_JOB_EXECUTIONS_STALE_TIME_MS = 30_000;
export const WORKFLOW_STEP_ATTEMPTS_STALE_TIME_MS = 30_000;

/** Query ownership mirrors the server resources, so a job change cannot evict a run shell. */
export const workflowJobQueryKeys = {
  all: ['workflow-jobs'] as const,
  detail: (jobId: string, executionId?: string | undefined) =>
    [...workflowJobQueryKeys.all, 'detail', jobId, executionId ?? null] as const,
  executions: (jobId: string) => [...workflowJobQueryKeys.all, 'executions', jobId] as const,
  executionSteps: (executionId: string) => ['workflow-executions', 'steps', executionId] as const,
  stepAttempts: (stepId: string) => ['workflow-steps', 'attempts', stepId] as const,
};

// These names make the public boundary discoverable without forcing callers to know the
// implementation's shorter key name. Keep all aliases pointed at the same key factory.
export const workflowJobDetailQueryKeys = workflowJobQueryKeys;
export const workflowJobsQueryKeys = workflowJobQueryKeys;

type WorkflowJobDetailQueryKey =
  | ReturnType<typeof workflowJobQueryKeys.detail>
  | readonly ['workflow-jobs', 'detail'];
type WorkflowJobExecutionsQueryKey =
  | ReturnType<typeof workflowJobQueryKeys.executions>
  | readonly ['workflow-jobs', 'executions'];
type WorkflowExecutionStepsQueryKey =
  | ReturnType<typeof workflowJobQueryKeys.executionSteps>
  | readonly ['workflow-executions', 'steps'];
type WorkflowStepAttemptsQueryKey =
  | ReturnType<typeof workflowJobQueryKeys.stepAttempts>
  | readonly ['workflow-steps', 'attempts'];

type WorkflowJobDetailQueryOptions = UseQueryOptions<
  WorkflowJobDetail,
  Error,
  WorkflowJobDetail,
  WorkflowJobDetailQueryKey
>;
type WorkflowJobExecutionsInfiniteQueryOptions = UseInfiniteQueryOptions<
  WorkflowJobExecutionPage,
  Error,
  InfiniteData<WorkflowJobExecutionPage, string | null>,
  WorkflowJobExecutionsQueryKey,
  string | null
>;
type WorkflowExecutionStepsInfiniteQueryOptions = UseInfiniteQueryOptions<
  WorkflowExecutionStepsPage,
  Error,
  InfiniteData<WorkflowExecutionStepsPage, string | null>,
  WorkflowExecutionStepsQueryKey,
  string | null
>;
type WorkflowStepAttemptsInfiniteQueryOptions = UseInfiniteQueryOptions<
  WorkflowStepAttemptPage,
  Error,
  InfiniteData<WorkflowStepAttemptPage, string | null>,
  WorkflowStepAttemptsQueryKey,
  string | null
>;

export interface WorkflowJobDetailQueryInput {
  jobId: string | undefined;
  /** An explicit execution pins the detail to historical identity. */
  executionId?: string | undefined;
  /** Compatibility spelling for callers that use the URL/API vocabulary. */
  jobExecutionId?: string | undefined;
  enabled?: boolean | undefined;
}

export function workflowJobDetailQueryOptions({
  jobId,
  executionId,
  jobExecutionId,
  enabled = true,
}: WorkflowJobDetailQueryInput): WorkflowJobDetailQueryOptions {
  const selectedExecutionId = executionId ?? jobExecutionId;
  const queryEnabled = Boolean(jobId) && enabled;

  return queryOptions({
    queryKey: jobId
      ? workflowJobQueryKeys.detail(jobId, selectedExecutionId)
      : (['workflow-jobs', 'detail'] as const),
    enabled: queryEnabled,
    queryFn: ({signal}) =>
      getWorkflowJobDetail({
        jobId: jobId ?? '',
        executionId: selectedExecutionId,
        signal,
      }),
    staleTime: (query) =>
      workflowJobDetailIsLive(query.state.data) ? WORKFLOW_JOB_DETAIL_STALE_TIME_MS : Infinity,
    refetchOnWindowFocus: (query) => workflowJobDetailIsLive(query.state.data),
    refetchInterval: (query) => {
      if (!queryEnabled || (query.state.error !== null && query.state.data === undefined)) {
        return false;
      }
      return workflowJobDetailIsLive(query.state.data) ? WORKFLOW_JOB_DETAIL_ACTIVE_POLL_MS : false;
    },
    refetchIntervalInBackground: false,
  });
}

export function useWorkflowJobDetailQuery(input: WorkflowJobDetailQueryInput) {
  return useQuery(workflowJobDetailQueryOptions(input));
}

interface DefaultJobResourceSnapshot {
  jobId: string;
  defaultExecutionId: string | undefined;
  executionCount: number | '100+';
}

export interface WorkflowJobResourceInvalidationInput {
  detail: WorkflowJobDetail | undefined;
  pinnedExecutionId?: string | undefined;
}

/** Refresh only the selected job resources when an unpinned overview changes identity. */
export function useWorkflowJobResourceInvalidation({
  detail,
  pinnedExecutionId,
}: WorkflowJobResourceInvalidationInput): void {
  const queryClient = useQueryClient();
  const previousDefaultExecution = useRef<DefaultJobResourceSnapshot | undefined>(undefined);

  useEffect(() => {
    if (pinnedExecutionId !== undefined || !detail) {
      previousDefaultExecution.current = undefined;
      return;
    }

    const next = {
      jobId: detail.job.id,
      defaultExecutionId: detail.job.defaultExecution?.id,
      executionCount: detail.job.executionCount,
    } satisfies DefaultJobResourceSnapshot;
    const previous = previousDefaultExecution.current;
    previousDefaultExecution.current = next;
    if (!previous || previous.jobId !== next.jobId) return;
    if (
      previous.defaultExecutionId === next.defaultExecutionId &&
      previous.executionCount === next.executionCount
    ) {
      return;
    }
    void invalidateWorkflowJobResources(queryClient, {jobId: next.jobId});
  }, [detail, pinnedExecutionId, queryClient]);
}

export interface WorkflowJobExecutionsQueryInput {
  jobId: string | undefined;
  enabled?: boolean | undefined;
}

export function workflowJobExecutionsInfiniteQueryOptions({
  jobId,
  enabled = true,
}: WorkflowJobExecutionsQueryInput): WorkflowJobExecutionsInfiniteQueryOptions {
  const queryEnabled = Boolean(jobId) && enabled;
  return infiniteQueryOptions({
    queryKey: jobId
      ? workflowJobQueryKeys.executions(jobId)
      : (['workflow-jobs', 'executions'] as const),
    enabled: queryEnabled,
    initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) =>
      getWorkflowJobExecutions({jobId: jobId ?? '', cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: WORKFLOW_JOB_EXECUTIONS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

export function useWorkflowJobExecutionsInfiniteQuery(input: WorkflowJobExecutionsQueryInput) {
  return useInfiniteQuery(workflowJobExecutionsInfiniteQueryOptions(input));
}

export interface WorkflowExecutionStepsQueryInput {
  jobId: string | undefined;
  executionId: string | undefined;
  /** Step pages are live only while their execution is active. */
  polling?: boolean | undefined;
  enabled?: boolean | undefined;
}

export function workflowExecutionStepsInfiniteQueryOptions({
  jobId,
  executionId,
  polling = true,
  enabled = true,
}: WorkflowExecutionStepsQueryInput): WorkflowExecutionStepsInfiniteQueryOptions {
  const queryEnabled = Boolean(jobId) && Boolean(executionId) && enabled;
  return infiniteQueryOptions({
    queryKey: executionId
      ? workflowJobQueryKeys.executionSteps(executionId)
      : (['workflow-executions', 'steps'] as const),
    enabled: queryEnabled,
    initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) =>
      getWorkflowExecutionSteps({
        jobId: jobId ?? '',
        executionId: executionId ?? '',
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      polling && query.state.data?.pages.length === 1 ? WORKFLOW_JOB_DETAIL_ACTIVE_POLL_MS : false,
    refetchIntervalInBackground: false,
  });
}

export function useWorkflowExecutionStepsInfiniteQuery(input: WorkflowExecutionStepsQueryInput) {
  return useInfiniteQuery(workflowExecutionStepsInfiniteQueryOptions(input));
}

// The singular name is useful at call sites that model a step's attempts rather than the
// endpoint's response collection.
export const workflowExecutionStepAttemptsInfiniteQueryOptions =
  workflowStepAttemptsInfiniteQueryOptions;

export interface WorkflowStepAttemptsQueryInput {
  stepId: string | undefined;
  enabled?: boolean | undefined;
}

export function workflowStepAttemptsInfiniteQueryOptions({
  stepId,
  enabled = true,
}: WorkflowStepAttemptsQueryInput): WorkflowStepAttemptsInfiniteQueryOptions {
  const queryEnabled = Boolean(stepId) && enabled;
  return infiniteQueryOptions({
    queryKey: stepId
      ? workflowJobQueryKeys.stepAttempts(stepId)
      : (['workflow-steps', 'attempts'] as const),
    enabled: queryEnabled,
    initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) =>
      getWorkflowStepAttempts({stepId: stepId ?? '', cursor: pageParam, signal}),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: WORKFLOW_STEP_ATTEMPTS_STALE_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: false,
  });
}

export function useWorkflowStepAttemptsInfiniteQuery(input: WorkflowStepAttemptsQueryInput) {
  return useInfiniteQuery(workflowStepAttemptsInfiniteQueryOptions(input));
}

export async function invalidateWorkflowJobResources(
  queryClient: QueryClient,
  {
    jobId,
    executionId,
  }: {
    jobId: string;
    executionId?: string | undefined;
  },
): Promise<void> {
  const detailKey = executionId
    ? workflowJobQueryKeys.detail(jobId, executionId)
    : ([...workflowJobQueryKeys.all, 'detail', jobId] as const);
  await Promise.all([
    queryClient.invalidateQueries({queryKey: detailKey}),
    queryClient.invalidateQueries({queryKey: workflowJobQueryKeys.executions(jobId)}),
  ]);
}

async function getWorkflowJobDetail({
  jobId,
  executionId,
  signal,
}: {
  jobId: string;
  executionId: string | undefined;
  signal?: AbortSignal;
}): Promise<WorkflowJobDetail> {
  const params = new URLSearchParams();
  if (executionId) params.set('execution_id', executionId);
  const query = params.toString();
  const path = `/workflows/runs/jobs/${jobId}${query ? `?${query}` : ''}`;
  return toWorkflowJobDetail(
    await checkedApiRequest(workflowJobDetailResponseSchema, path, {signal}),
  );
}

async function getWorkflowJobExecutions({
  jobId,
  cursor,
  signal,
}: {
  jobId: string;
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<WorkflowJobExecutionPage> {
  const params = new URLSearchParams({limit: String(WORKFLOW_JOB_EXECUTION_PAGE_LIMIT)});
  if (cursor) params.set('cursor', cursor);
  return toWorkflowJobExecutionPage(
    await checkedApiRequest(
      workflowJobExecutionSummariesResponseSchema,
      `/workflows/runs/jobs/${jobId}/executions?${params.toString()}`,
      {signal},
    ),
  );
}

async function getWorkflowExecutionSteps({
  jobId,
  executionId,
  cursor,
  signal,
}: {
  jobId: string;
  executionId: string;
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<WorkflowExecutionStepsPage> {
  const params = new URLSearchParams({limit: String(WORKFLOW_JOB_STEP_PAGE_LIMIT)});
  if (cursor) params.set('cursor', cursor);
  return toWorkflowExecutionStepsPage(
    await checkedApiRequest(
      workflowExecutionStepsResponseSchema,
      `/workflows/runs/jobs/${jobId}/executions/${executionId}/steps?${params.toString()}`,
      {signal},
    ),
    executionId,
  );
}

async function getWorkflowStepAttempts({
  stepId,
  cursor,
  signal,
}: {
  stepId: string;
  cursor: string | null;
  signal?: AbortSignal;
}): Promise<WorkflowStepAttemptPage> {
  const params = new URLSearchParams({limit: String(WORKFLOW_STEP_ATTEMPT_PAGE_LIMIT)});
  if (cursor) params.set('cursor', cursor);
  return toWorkflowStepAttemptPage(
    await checkedApiRequest(
      workflowStepAttemptSummariesResponseSchema,
      `/workflows/runs/steps/${stepId}/attempts?${params.toString()}`,
      {signal},
    ),
    stepId,
  );
}

function workflowJobDetailIsLive(detail: WorkflowJobDetail | undefined): boolean {
  if (!detail) return true;
  if (detail.job.mode === 'listening' && detail.job.listenerStatus === 'listening') return true;
  if (detail.selectedExecution) {
    return !isTerminalJobExecutionStatus(detail.selectedExecution.status);
  }
  return !isTerminalJobStatus(detail.job.status);
}

export function flattenWorkflowJobExecutionPages(
  data: InfiniteData<WorkflowJobExecutionPage, string | null> | undefined,
) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function flattenWorkflowExecutionStepsPages(
  data: InfiniteData<WorkflowExecutionStepsPage, string | null> | undefined,
) {
  return data?.pages.flatMap((page) => page.items) ?? [];
}

export function flattenWorkflowStepAttemptPages(
  data: InfiniteData<WorkflowStepAttemptPage, string | null> | undefined,
): WorkflowJobStepAttemptSummary[] {
  return data?.pages.flatMap((page) => page.items) ?? [];
}
