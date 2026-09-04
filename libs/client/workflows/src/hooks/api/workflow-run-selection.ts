import {workflowRunSelectionResponseSchema} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery, useQueryClient} from '@tanstack/react-query';
import {useEffect, useRef} from 'react';
import type {WorkflowRunSelectionResolution} from '#core/workflow-run.js';
import {toWorkflowRunSelectionResolution} from './workflow-run-mapper.js';
import {workflowRunsQueryKeys} from './workflow-runs.js';

export interface WorkflowRunSelectionQueryInput {
  workflowRunId: string | undefined;
  runAttempt?: number | undefined;
  jobId?: string | undefined;
  jobExecutionId?: string | undefined;
  stepId?: string | undefined;
  stepAttemptId?: string | undefined;
  enabled?: boolean | undefined;
}

type WorkflowRunSelectionQueryKey =
  | ReturnType<typeof workflowRunsQueryKeys.selection>
  | readonly ['workflow-runs', 'selection'];
type WorkflowRunSelectionQueryOptions = UseQueryOptions<
  WorkflowRunSelectionResolution,
  Error,
  WorkflowRunSelectionResolution,
  WorkflowRunSelectionQueryKey
>;

export function workflowRunSelectionQueryOptions({
  workflowRunId,
  runAttempt,
  jobId,
  jobExecutionId,
  stepId,
  stepAttemptId,
  enabled = true,
}: WorkflowRunSelectionQueryInput): WorkflowRunSelectionQueryOptions {
  const hasIdentity = Boolean(jobId || jobExecutionId || stepId || stepAttemptId);
  const queryEnabled = Boolean(workflowRunId) && hasIdentity && enabled;
  const identity = {jobId, jobExecutionId, stepId, stepAttemptId};
  return queryOptions({
    queryKey:
      workflowRunId && hasIdentity
        ? workflowRunsQueryKeys.selection(workflowRunId, identity)
        : ([...workflowRunsQueryKeys.all, 'selection'] as const),
    enabled: queryEnabled,
    queryFn: ({signal}) =>
      getWorkflowRunSelection(
        workflowRunId ?? '',
        {runAttempt, jobId, jobExecutionId, stepId, stepAttemptId},
        signal,
      ),
    staleTime: Infinity,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useWorkflowRunSelectionQuery(input: WorkflowRunSelectionQueryInput) {
  const query = useQuery(workflowRunSelectionQueryOptions(input));
  const queryClient = useQueryClient();
  const queryEnabled =
    Boolean(input.workflowRunId) &&
    Boolean(input.jobId || input.jobExecutionId || input.stepId || input.stepAttemptId) &&
    input.enabled !== false;
  const attemptMismatch = selectionAttemptMismatch(input.runAttempt, query.data);
  const selectionRequestKey = JSON.stringify([
    input.workflowRunId,
    input.jobId,
    input.jobExecutionId,
    input.stepId,
    input.stepAttemptId,
  ]);
  const refetchedSelection = useRef<{requestKey: string; runAttempt: number} | undefined>(
    undefined,
  );

  useEffect(() => {
    if (input.runAttempt === undefined) {
      refetchedSelection.current = undefined;
      return;
    }
    if (
      !queryEnabled ||
      !attemptMismatch ||
      query.isFetching ||
      (refetchedSelection.current?.requestKey === selectionRequestKey &&
        refetchedSelection.current.runAttempt === input.runAttempt)
    ) {
      return;
    }
    refetchedSelection.current = {requestKey: selectionRequestKey, runAttempt: input.runAttempt};
    void query.refetch();
  }, [
    attemptMismatch,
    input.runAttempt,
    queryEnabled,
    query.isFetching,
    query.refetch,
    selectionRequestKey,
  ]);

  useEffect(() => {
    if (!input.workflowRunId || !query.data || attemptMismatch) return;
    const canonicalIdentity = workflowRunSelectionIdentityFromResolution(query.data);
    if (
      selectionIdentitiesMatch(
        {
          jobId: input.jobId,
          jobExecutionId: input.jobExecutionId,
          stepId: input.stepId,
          stepAttemptId: input.stepAttemptId,
        },
        canonicalIdentity,
      )
    ) {
      return;
    }
    queryClient.setQueryData(
      workflowRunsQueryKeys.selection(input.workflowRunId, canonicalIdentity),
      query.data,
    );
  }, [
    attemptMismatch,
    input.jobExecutionId,
    input.jobId,
    input.stepAttemptId,
    input.stepId,
    input.workflowRunId,
    query.data,
    queryClient,
  ]);

  if (!attemptMismatch) return query;
  return {
    ...query,
    data: undefined,
    isLoading: !query.isError,
    isPending: !query.isError,
  };
}

function selectionAttemptMismatch(
  runAttempt: number | undefined,
  resolution: WorkflowRunSelectionResolution | undefined,
): boolean {
  return (
    runAttempt !== undefined &&
    resolution !== undefined &&
    resolution.workflowRunAttempt !== runAttempt
  );
}

type WorkflowRunSelectionIdentity = Pick<
  WorkflowRunSelectionQueryInput,
  'jobId' | 'jobExecutionId' | 'stepId' | 'stepAttemptId'
>;

function workflowRunSelectionIdentityFromResolution(
  resolution: WorkflowRunSelectionResolution,
): WorkflowRunSelectionIdentity {
  return {
    ...(resolution.jobId ? {jobId: resolution.jobId} : {}),
    ...(resolution.jobExecutionId ? {jobExecutionId: resolution.jobExecutionId} : {}),
    ...(resolution.stepId ? {stepId: resolution.stepId} : {}),
    ...(resolution.stepAttemptId ? {stepAttemptId: resolution.stepAttemptId} : {}),
  };
}

function selectionIdentitiesMatch(
  left: WorkflowRunSelectionIdentity,
  right: WorkflowRunSelectionIdentity,
): boolean {
  return (
    left.jobId === right.jobId &&
    left.jobExecutionId === right.jobExecutionId &&
    left.stepId === right.stepId &&
    left.stepAttemptId === right.stepAttemptId
  );
}

async function getWorkflowRunSelection(
  workflowRunId: string,
  identity: Omit<WorkflowRunSelectionQueryInput, 'workflowRunId' | 'enabled'>,
  signal?: AbortSignal,
): Promise<WorkflowRunSelectionResolution> {
  const params = new URLSearchParams();
  if (identity.runAttempt !== undefined) params.set('attempt', String(identity.runAttempt));
  if (identity.jobId) params.set('job_id', identity.jobId);
  if (identity.jobExecutionId) params.set('job_execution_id', identity.jobExecutionId);
  if (identity.stepId) params.set('step_id', identity.stepId);
  if (identity.stepAttemptId) params.set('step_attempt_id', identity.stepAttemptId);

  return toWorkflowRunSelectionResolution(
    await checkedApiRequest(
      workflowRunSelectionResponseSchema,
      `/workflows/runs/${workflowRunId}/selection?${params.toString()}`,
      {signal},
    ),
  );
}
