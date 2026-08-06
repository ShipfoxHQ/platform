import {
  type AnnotationStyleDto,
  annotationSummaryResponseSchema,
  readAnnotationsResponseSchema,
} from '@shipfox/annotations-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {
  infiniteQueryOptions,
  queryOptions,
  useInfiniteQuery,
  useQuery,
} from '@tanstack/react-query';
import type {RunAnnotationSummary} from '#core/run-annotation.js';

const ANNOTATIONS_PAGE_SIZE = 100;
const ANNOTATIONS_REFRESH_INTERVAL_MS = 5_000;

export interface WorkflowRunAnnotation {
  id: string;
  jobId: string;
  jobExecutionId: string;
  originStepId: string;
  originStepAttempt: number;
  context: string;
  style: AnnotationStyleDto;
  sequence: number;
  body: string;
}

export interface WorkflowRunAnnotationsPage {
  annotations: WorkflowRunAnnotation[];
  hasMore: boolean;
  nextCursor: string | null;
}

export const workflowRunAnnotationsQueryKeys = {
  all: ['workflow-run-annotations'] as const,
  list: (workflowRunId: string, attempt: number, jobExecutionId?: string) =>
    [
      ...workflowRunAnnotationsQueryKeys.all,
      'list',
      workflowRunId,
      attempt,
      jobExecutionId ?? null,
    ] as const,
  summary: (workflowRunId: string, attempt: number, jobExecutionId?: string) =>
    [
      ...workflowRunAnnotationsQueryKeys.all,
      'summary',
      workflowRunId,
      attempt,
      jobExecutionId ?? null,
    ] as const,
};

function annotationParams({
  workflowRunId,
  attempt,
  jobExecutionId,
  cursor,
}: {
  workflowRunId: string;
  attempt: number;
  jobExecutionId?: string | undefined;
  cursor?: string | null | undefined;
}): URLSearchParams {
  const params = new URLSearchParams({
    workflow_run_id: workflowRunId,
    attempt: String(attempt),
    limit: String(ANNOTATIONS_PAGE_SIZE),
  });
  if (jobExecutionId) params.set('job_execution_id', jobExecutionId);
  if (cursor) params.set('cursor', cursor);
  return params;
}

async function getWorkflowRunAnnotationsPage({
  workflowRunId,
  attempt,
  jobExecutionId,
  cursor,
  signal,
}: {
  workflowRunId: string;
  attempt: number;
  jobExecutionId?: string | undefined;
  cursor?: string | null | undefined;
  signal?: AbortSignal;
}): Promise<WorkflowRunAnnotationsPage> {
  const response = await checkedApiRequest(
    readAnnotationsResponseSchema,
    `/annotations?${annotationParams({workflowRunId, attempt, jobExecutionId, cursor}).toString()}`,
    {signal},
  );
  return {
    annotations: response.annotations.map(toWorkflowRunAnnotation),
    hasMore: response.has_more,
    nextCursor: response.next_cursor,
  };
}

async function getWorkflowRunAnnotationSummary({
  workflowRunId,
  attempt,
  jobExecutionId,
  signal,
}: {
  workflowRunId: string;
  attempt: number;
  jobExecutionId?: string | undefined;
  signal?: AbortSignal;
}): Promise<RunAnnotationSummary> {
  const params = annotationParams({workflowRunId, attempt, jobExecutionId});
  params.delete('limit');
  const response = await checkedApiRequest(
    annotationSummaryResponseSchema,
    `/annotations/summary?${params.toString()}`,
    {signal},
  );
  return {
    total: response.total,
    error: response.error,
    warning: response.warning,
    info: response.info,
    success: response.success,
    truncated: false,
    stepCounts: response.step_counts.map((step) => ({
      stepId: step.origin_step_id,
      attempt: step.origin_step_attempt,
      total: step.total,
    })),
  };
}

export function workflowRunAnnotationsQueryOptions(
  workflowRunId: string | undefined,
  attempt: number | undefined,
  jobExecutionId?: string | undefined,
  options?: {enabled?: boolean | undefined; polling?: boolean | undefined},
) {
  const enabled = Boolean(workflowRunId) && attempt !== undefined && (options?.enabled ?? true);
  const polling = options?.polling ?? true;
  return infiniteQueryOptions({
    queryKey:
      workflowRunId && attempt !== undefined
        ? workflowRunAnnotationsQueryKeys.list(workflowRunId, attempt, jobExecutionId)
        : ([...workflowRunAnnotationsQueryKeys.all, 'list'] as const),
    enabled,
    initialPageParam: null as string | null,
    queryFn: ({pageParam, signal}) =>
      getWorkflowRunAnnotationsPage({
        workflowRunId: workflowRunId ?? '',
        attempt: attempt ?? 0,
        ...(jobExecutionId ? {jobExecutionId} : {}),
        cursor: pageParam,
        signal,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    staleTime: 2_000,
    refetchInterval:
      enabled && polling
        ? (query) => {
            const pages = query.state.data?.pages;
            return pages && pages.length > 1 ? false : ANNOTATIONS_REFRESH_INTERVAL_MS;
          }
        : false,
  });
}

export function useWorkflowRunAnnotationsQuery(
  workflowRunId: string | undefined,
  attempt: number | undefined,
  jobExecutionId?: string | undefined,
  options?: {enabled?: boolean | undefined; polling?: boolean | undefined},
) {
  return useInfiniteQuery(
    workflowRunAnnotationsQueryOptions(workflowRunId, attempt, jobExecutionId, options),
  );
}

export function workflowRunAnnotationSummaryQueryOptions(
  workflowRunId: string | undefined,
  attempt: number | undefined,
  jobExecutionId?: string | undefined,
  options?: {enabled?: boolean | undefined; polling?: boolean | undefined},
) {
  const enabled = Boolean(workflowRunId) && attempt !== undefined && (options?.enabled ?? true);
  const polling = options?.polling ?? true;
  return queryOptions({
    queryKey:
      workflowRunId && attempt !== undefined
        ? workflowRunAnnotationsQueryKeys.summary(workflowRunId, attempt, jobExecutionId)
        : ([...workflowRunAnnotationsQueryKeys.all, 'summary'] as const),
    enabled,
    queryFn: ({signal}) =>
      getWorkflowRunAnnotationSummary({
        workflowRunId: workflowRunId ?? '',
        attempt: attempt ?? 0,
        ...(jobExecutionId ? {jobExecutionId} : {}),
        signal,
      }),
    staleTime: 2_000,
    refetchInterval: enabled && polling ? ANNOTATIONS_REFRESH_INTERVAL_MS : false,
  });
}

export function useWorkflowRunAnnotationSummaryQuery(
  workflowRunId: string | undefined,
  attempt: number | undefined,
  jobExecutionId?: string | undefined,
  options?: {enabled?: boolean | undefined; polling?: boolean | undefined},
) {
  return useQuery(
    workflowRunAnnotationSummaryQueryOptions(workflowRunId, attempt, jobExecutionId, options),
  );
}

export function flattenWorkflowRunAnnotations(
  data: {pages: readonly WorkflowRunAnnotationsPage[]} | undefined,
): WorkflowRunAnnotation[] {
  return data?.pages.flatMap((page) => page.annotations) ?? [];
}

function toWorkflowRunAnnotation(
  annotation: Awaited<
    ReturnType<typeof readAnnotationsResponseSchema.parse>
  >['annotations'][number],
): WorkflowRunAnnotation {
  return {
    id: annotation.id,
    jobId: annotation.job_id,
    jobExecutionId: annotation.job_execution_id,
    originStepId: annotation.origin_step_id,
    originStepAttempt: annotation.origin_step_attempt,
    context: annotation.context,
    style: annotation.style,
    sequence: annotation.sequence,
    body: annotation.body,
  };
}
