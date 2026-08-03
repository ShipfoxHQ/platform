import type {WorkflowRunListStatusFilter} from '#components/workflow-run-list/types.js';
import type {WorkflowRunSelectionInput} from '#core/workflow-run-url-state.js';

export interface WorkflowRunsSearch extends WorkflowRunSelectionInput {
  search?: string;
  status?: WorkflowRunListStatusFilter;
}

export function validateWorkflowRunsSearch(input: Record<string, unknown>): WorkflowRunsSearch {
  const search = string(input.search);
  const status = input.status === 'failed' || input.status === 'running' ? input.status : 'all';
  const runAttempt = positiveInteger(input.runAttempt);
  return {
    ...(search ? {search} : {}),
    ...(status === 'all' ? {} : {status}),
    ...(string(input.job) ? {jobId: string(input.job)} : {}),
    ...(string(input.jobExecution) ? {jobExecutionId: string(input.jobExecution)} : {}),
    ...(string(input.step) ? {stepId: string(input.step)} : {}),
    ...(string(input.stepAttempt) ? {stepAttemptId: string(input.stepAttempt)} : {}),
    ...(runAttempt ? {runAttempt} : {}),
  };
}

export function workflowRunSearchParams(
  search: WorkflowRunsSearch,
  selection: WorkflowRunSelectionInput = search,
) {
  return {
    ...(search.search ? {search: search.search} : {}),
    ...(search.status && search.status !== 'all' ? {status: search.status} : {}),
    ...(selection.jobId ? {job: selection.jobId} : {}),
    ...(selection.jobExecutionId ? {jobExecution: selection.jobExecutionId} : {}),
    ...(selection.stepId ? {step: selection.stepId} : {}),
    ...(selection.stepAttemptId ? {stepAttempt: selection.stepAttemptId} : {}),
    ...(selection.runAttempt ? {runAttempt: String(selection.runAttempt)} : {}),
  };
}

export function workflowRouteParams(input: Record<string, unknown>): {
  workspaceSlug: string;
  projectSlug: string;
  workflowRunId?: string;
} {
  const workspaceSlug = string(input.workspaceSlug);
  const projectSlug = string(input.projectSlug);
  if (!workspaceSlug || !projectSlug)
    throw new Error('Workflow route is missing required path parameters.');
  const workflowRunId = string(input.workflowRunId);
  return workflowRunId ? {workspaceSlug, projectSlug, workflowRunId} : {workspaceSlug, projectSlug};
}

function string(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isInteger(number) && number > 0 ? number : undefined;
}
