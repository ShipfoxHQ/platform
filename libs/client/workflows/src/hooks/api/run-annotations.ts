import {
  type AnnotationDto,
  READ_ANNOTATIONS_MAX_LIMIT,
  type ReadAnnotationsResponseDto,
} from '@shipfox/annotations-dto';
import {apiRequest} from '@shipfox/client-api';
import {useQuery} from '@tanstack/react-query';
import {useRef} from 'react';
import {
  RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS,
  type RunAnnotation,
  runAnnotationsRefetchInterval,
  toRunAnnotation,
} from '#core/run-annotation.js';
import {isWorkflowRunTerminal, type WorkflowRunStatus} from '#core/workflow-run.js';

const MAX_ANNOTATION_PAGE_REQUESTS = 100;

export const runAnnotationsQueryKeys = {
  all: ['run-annotations'] as const,
  detail: (workflowRunId: string, runAttempt: number | undefined) =>
    [...runAnnotationsQueryKeys.all, 'detail', workflowRunId, runAttempt ?? null] as const,
};

export async function getRunAnnotationsDtos({
  workflowRunId,
  runAttempt,
  signal,
}: {
  workflowRunId: string;
  runAttempt: number;
  signal?: AbortSignal;
}): Promise<AnnotationDto[]> {
  const annotations: AnnotationDto[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_ANNOTATION_PAGE_REQUESTS; page += 1) {
    const params = new URLSearchParams({
      workflow_run_id: workflowRunId,
      attempt: String(runAttempt),
      limit: String(READ_ANNOTATIONS_MAX_LIMIT),
    });
    if (cursor) params.set('cursor', cursor);

    const response = await apiRequest<ReadAnnotationsResponseDto>(
      `/annotations?${params.toString()}`,
      {signal},
    );
    annotations.push(...response.annotations);

    const nextCursor = response.next_cursor;
    if (!response.has_more || !nextCursor || seenCursors.has(nextCursor)) break;
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return annotations;
}

export function useRunAnnotationsQuery({
  workflowRunId,
  runAttempt,
  runStatus,
}: {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  runStatus: WorkflowRunStatus | undefined;
}) {
  const enabled = Boolean(workflowRunId && runAttempt);
  const graceLeftRef = useRef(RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS);
  const scopeRef = useRef<string | null>(null);
  const scope = enabled && workflowRunId && runAttempt ? `${workflowRunId}:${runAttempt}` : null;

  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    graceLeftRef.current = RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS;
  }

  if (!runStatus || !isWorkflowRunTerminal(runStatus)) {
    graceLeftRef.current = RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS;
  }

  return useQuery({
    queryKey:
      enabled && workflowRunId
        ? runAnnotationsQueryKeys.detail(workflowRunId, runAttempt)
        : [...runAnnotationsQueryKeys.all, 'detail'],
    enabled,
    queryFn: async ({signal}) => {
      const isTerminalFetch = Boolean(runStatus && isWorkflowRunTerminal(runStatus));
      try {
        return await getRunAnnotationsDtos({
          workflowRunId: workflowRunId ?? '',
          runAttempt: runAttempt ?? 0,
          signal,
        });
      } finally {
        if (isTerminalFetch) {
          graceLeftRef.current = Math.max(0, graceLeftRef.current - 1);
        }
      }
    },
    select: (annotations): RunAnnotation[] => annotations.map(toRunAnnotation),
    staleTime: 2_000,
    refetchInterval: () =>
      runAnnotationsRefetchInterval({
        runStatus,
        graceLeft: graceLeftRef.current,
      }),
    refetchIntervalInBackground: false,
  });
}
