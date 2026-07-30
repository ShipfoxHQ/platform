import {type Job, WORKFLOW_JOB_STATUSES} from './job.js';
import type {WorkflowRunAttempt, WorkflowRunAttemptSummary} from './workflow-run-attempt.js';

export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';
export type WorkflowRunRerunMode = 'all' | 'failed';
export type WorkflowStatus = WorkflowRunStatus | (typeof WORKFLOW_JOB_STATUSES)[number];
export type WorkflowDisplayStatus = WorkflowStatus | 'listening';

export const WORKFLOW_RUN_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];

export const TERMINAL_WORKFLOW_RUN_STATUSES = [
  'succeeded',
  'failed',
  'cancelled',
] as const satisfies readonly WorkflowRunStatus[];

const WORKFLOW_STATUSES = new Set<WorkflowStatus>([
  ...WORKFLOW_RUN_STATUSES,
  ...WORKFLOW_JOB_STATUSES,
]);
const TERMINAL_WORKFLOW_RUN_STATUS_SET = new Set<WorkflowRunStatus>(TERMINAL_WORKFLOW_RUN_STATUSES);

export interface WorkflowSourceSnapshot {
  content: string;
  format: 'yaml';
}

export interface WorkflowRun {
  id: string;
  projectId: string;
  definitionId: string;
  name: string;
  workflowName: string;
  currentAttempt: number;
  triggerProvider: string | null;
  triggerSource: string;
  triggerEvent: string;
  triggerDisplayLabel: string;
  triggerLabel: string;
  triggerPayload: Record<string, unknown>;
  inputs: Record<string, unknown> | null;
  sourceSnapshot: WorkflowSourceSnapshot | null;
  createdAt: string;
  updatedAt: string;
  shortId: string;
  isTemporary: boolean;
}

export interface WorkflowRunListItem extends WorkflowRun {
  status: WorkflowRunStatus;
  latestAttempt: number;
  runAttempt: WorkflowRunAttemptSummary;
}

export interface WorkflowRunDetail extends WorkflowRun {
  latestAttempt: number;
  runAttempt: WorkflowRunAttempt;
  jobs: Job[];
}

export interface WorkflowRunListPage {
  runs: WorkflowRunListItem[];
  nextCursor: string | null;
  filteredTotalCount: number | null;
}

export interface ManualWorkflowLaunch {
  workflowRunId: string;
}

export function workflowRunDefinitionDisplayName(
  run: Pick<WorkflowRun, 'name' | 'workflowName'>,
): string | undefined {
  return run.workflowName === run.name ? undefined : run.workflowName;
}

export function workflowRunShortId(id: string): string {
  return id.length <= 8 ? id : id.slice(0, 8);
}

export function workflowRunTriggerLabel({
  triggerSource,
  triggerEvent,
}: {
  triggerSource: string;
  triggerEvent: string;
}): string {
  return [triggerSource, triggerEvent].filter(Boolean).join(' · ');
}

export function workflowRunTriggerDisplayLabel({
  triggerSource,
  triggerEvent,
}: {
  triggerSource: string;
  triggerEvent: string;
}): string {
  return triggerEvent || triggerSource;
}

export function isWorkflowRunTerminal(status: WorkflowRunStatus): boolean {
  return TERMINAL_WORKFLOW_RUN_STATUS_SET.has(status);
}

export function isWorkflowStatus(status: string): status is WorkflowStatus {
  return WORKFLOW_STATUSES.has(status as WorkflowStatus);
}
