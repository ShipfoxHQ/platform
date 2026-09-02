import {
  workflowRunSelectionQuerySchema,
  workflowRunSelectionResponseSchema,
} from '@shipfox/api-workflows-dto';
import {checkedApiRequest} from '@shipfox/client-api';
import {queryOptions, useQuery} from '@tanstack/react-query';
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

export function workflowRunSelectionQueryOptions({
  workflowRunId,
  runAttempt,
  jobId,
  jobExecutionId,
  stepId,
  stepAttemptId,
  enabled = true,
}: WorkflowRunSelectionQueryInput) {
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

export function isWorkflowRunSelectionQueryInput(
  input: Pick<
    WorkflowRunSelectionQueryInput,
    'jobId' | 'jobExecutionId' | 'stepId' | 'stepAttemptId'
  >,
): boolean {
  return Boolean(input.jobId || input.jobExecutionId || input.stepId || input.stepAttemptId);
}

export function parseWorkflowRunSelectionQuery(
  input: WorkflowRunSelectionQueryInput,
): Pick<WorkflowRunSelectionQueryInput, 'jobId' | 'jobExecutionId' | 'stepId' | 'stepAttemptId'> {
  const result = workflowRunSelectionQuerySchema.safeParse({
    ...(input.runAttempt === undefined ? {} : {attempt: input.runAttempt}),
    ...(input.jobId === undefined ? {} : {job_id: input.jobId}),
    ...(input.jobExecutionId === undefined ? {} : {job_execution_id: input.jobExecutionId}),
    ...(input.stepId === undefined ? {} : {step_id: input.stepId}),
    ...(input.stepAttemptId === undefined ? {} : {step_attempt_id: input.stepAttemptId}),
  });
  if (!result.success) return {};
  return {
    ...(result.data.job_id === undefined ? {} : {jobId: result.data.job_id}),
    ...(result.data.job_execution_id === undefined
      ? {}
      : {jobExecutionId: result.data.job_execution_id}),
    ...(result.data.step_id === undefined ? {} : {stepId: result.data.step_id}),
    ...(result.data.step_attempt_id === undefined
      ? {}
      : {stepAttemptId: result.data.step_attempt_id}),
  };
}
