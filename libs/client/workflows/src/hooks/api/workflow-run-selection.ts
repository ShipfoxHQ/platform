import {workflowRunSelectionResponseSchema} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, type UseQueryOptions, useQuery} from '@tanstack/react-query';
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
        ? workflowRunsQueryKeys.selection(workflowRunId, identity, runAttempt)
        : ([...workflowRunsQueryKeys.all, 'selection'] as const),
    enabled: queryEnabled,
    queryFn: ({signal}) =>
      getWorkflowRunSelection(
        workflowRunId ?? '',
        {runAttempt, jobId, jobExecutionId, stepId, stepAttemptId},
        signal,
      ),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

export function useWorkflowRunSelectionQuery(input: WorkflowRunSelectionQueryInput) {
  return useQuery(workflowRunSelectionQueryOptions(input));
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
