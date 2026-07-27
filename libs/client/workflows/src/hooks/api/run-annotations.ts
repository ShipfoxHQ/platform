import {READ_ANNOTATIONS_MAX_LIMIT, readAnnotationsResponseSchema} from '@shipfox/annotations-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
import {useRef} from 'react';
import {
  RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS,
  type RunAnnotation,
  runAnnotationsRefetchInterval,
} from '#core/run-annotation.js';
import {isWorkflowRunTerminal, type WorkflowRunStatus} from '#core/workflow-run.js';
import {toRunAnnotation} from './run-annotation-mapper.js';

const MAX_ANNOTATION_PAGE_REQUESTS = 100;

export const runAnnotationsQueryKeys = {
  all: ['run-annotations'] as const,
  detail: (workflowRunId: string, runAttempt: number | undefined) =>
    [...runAnnotationsQueryKeys.all, 'detail', workflowRunId, runAttempt ?? null] as const,
};

type RunAnnotationsQueryKey =
  | ReturnType<typeof runAnnotationsQueryKeys.detail>
  | readonly ['run-annotations', 'detail'];
type RunAnnotationsQueryOptions = UseQueryOptions<
  RunAnnotation[],
  Error,
  RunAnnotation[],
  RunAnnotationsQueryKey
>;

export interface RunAnnotationsPollingState {
  terminalGracePollsLeft: number;
}

export async function getRunAnnotations({
  workflowRunId,
  runAttempt,
  signal,
}: {
  workflowRunId: string;
  runAttempt: number;
  signal?: AbortSignal;
}): Promise<RunAnnotation[]> {
  const annotations: RunAnnotation[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;

  for (let page = 0; page < MAX_ANNOTATION_PAGE_REQUESTS; page += 1) {
    const params = new URLSearchParams({
      workflow_run_id: workflowRunId,
      attempt: String(runAttempt),
      limit: String(READ_ANNOTATIONS_MAX_LIMIT),
    });
    if (cursor) params.set('cursor', cursor);

    const response = await checkedApiRequest(
      readAnnotationsResponseSchema,
      `/annotations?${params.toString()}`,
      {signal},
    );
    annotations.push(...response.annotations.map(toRunAnnotation));

    const nextCursor = response.next_cursor;
    if (!response.has_more || !nextCursor || seenCursors.has(nextCursor)) break;
    if (page === MAX_ANNOTATION_PAGE_REQUESTS - 1) {
      throw new Error('Annotation pagination exceeded the maximum page budget.');
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return annotations;
}

export function runAnnotationsQueryOptions({
  workflowRunId,
  runAttempt,
  runStatus,
  pollingState,
}: {
  workflowRunId: string | undefined;
  runAttempt: number | undefined;
  runStatus: WorkflowRunStatus | undefined;
  pollingState: RunAnnotationsPollingState;
}): RunAnnotationsQueryOptions {
  const enabled = Boolean(workflowRunId && runAttempt);

  return queryOptions({
    queryKey:
      enabled && workflowRunId
        ? runAnnotationsQueryKeys.detail(workflowRunId, runAttempt)
        : ([...runAnnotationsQueryKeys.all, 'detail'] as const),
    enabled,
    queryFn: async ({signal}) => {
      const isTerminalFetch = Boolean(runStatus && isWorkflowRunTerminal(runStatus));
      try {
        return await getRunAnnotations({
          workflowRunId: workflowRunId ?? '',
          runAttempt: runAttempt ?? 0,
          signal,
        });
      } finally {
        if (isTerminalFetch) {
          pollingState.terminalGracePollsLeft = Math.max(
            0,
            pollingState.terminalGracePollsLeft - 1,
          );
        }
      }
    },
    staleTime: 2_000,
    refetchInterval: () =>
      runAnnotationsRefetchInterval({
        runStatus,
        graceLeft: pollingState.terminalGracePollsLeft,
      }),
    refetchIntervalInBackground: false,
  });
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
  const pollingStateRef = useRef<RunAnnotationsPollingState>({
    terminalGracePollsLeft: RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS,
  });
  const scopeRef = useRef<string | null>(null);
  const scope = enabled && workflowRunId && runAttempt ? `${workflowRunId}:${runAttempt}` : null;

  if (scopeRef.current !== scope) {
    scopeRef.current = scope;
    pollingStateRef.current.terminalGracePollsLeft = RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS;
  }

  if (!runStatus || !isWorkflowRunTerminal(runStatus)) {
    pollingStateRef.current.terminalGracePollsLeft = RUN_ANNOTATIONS_TERMINAL_GRACE_POLLS;
  }

  return useQuery(
    runAnnotationsQueryOptions({
      workflowRunId,
      runAttempt,
      runStatus,
      pollingState: pollingStateRef.current,
    }),
  );
}
