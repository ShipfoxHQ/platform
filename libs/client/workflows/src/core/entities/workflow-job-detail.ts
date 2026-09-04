import type {WorkflowExecutionEvent} from './job-execution.js';
import type {StepError, StepSourceLocation} from './step.js';
import type {EvaluationTraceEntry, StepGateResult} from './step-attempt.js';
import type {WorkflowDiagnosticUnavailableField} from './workflow-diagnostics.js';
import type {
  BoundedExecutionCount,
  WorkflowRunOverviewExecution,
  WorkflowRunOverviewJob,
} from './workflow-run-overview.js';

export type {
  WorkflowDiagnosticField,
  WorkflowDiagnosticUnavailableField,
  WorkflowDiagnosticUnavailableReason,
  WorkflowPayloadField,
} from './workflow-diagnostics.js';
export {
  isWorkflowConfigurationPayloadField,
  workflowPayloadFieldLabel,
} from './workflow-diagnostics.js';

/** A bounded page returned by one of the selected-job cursor endpoints. */
export interface WorkflowJobPage<T> {
  items: T[];
  nextCursor: string | null;
  total?: number | BoundedExecutionCount | undefined;
}

/** The compact attempt projection embedded in a selected-job step page. */
export interface WorkflowJobStepAttemptSummary {
  id: string;
  /** The step id is supplied by the endpoint path, not repeated in its payload. */
  stepId: string;
  /** The execution id is supplied by the steps endpoint path, not repeated in its payload. */
  jobExecutionId?: string | undefined;
  attempt: number;
  executionOrder: number;
  status: string;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
  error: StepError | null;
  gateResult: StepGateResult;
}

/** A step summary. Detailed configuration and diagnostics are separate lazy reads. */
export interface WorkflowJobStepSummary {
  id: string;
  /** The execution id is supplied by the steps endpoint path. */
  jobExecutionId: string;
  key: string | null;
  name: string;
  type: string;
  position: number;
  status: string;
  statusReason: string | null;
  sourceLocation: StepSourceLocation | null;
  currentAttempt: number;
  error: StepError | null;
  attempts: WorkflowJobPage<WorkflowJobStepAttemptSummary>;
}

/** One selected execution with its embedded first step page. */
export interface WorkflowJobExecutionDetail extends WorkflowRunOverviewExecution {
  jobId: string;
  hasContext: boolean;
  steps: WorkflowJobPage<WorkflowJobStepSummary>;
}

/** Context is fetched only when the selected execution's context sheet opens. */
export interface WorkflowJobExecutionContext {
  workflowRunId: string;
  workflowRunAttempt: number;
  jobId: string;
  jobExecutionId: string;
  jobRunner: string[] | null;
  executionRunner: string[] | null;
  jobOutputs: Record<string, unknown> | null;
  executionOutputs: Record<string, unknown> | null;
  triggerEvents: WorkflowExecutionEvent[];
  jobEvaluationTrace: EvaluationTraceEntry[] | null;
  executionEvaluationTrace: EvaluationTraceEntry[] | null;
  condition: string | null;
  oversizedFields: WorkflowDiagnosticUnavailableField[];
}

export type WorkflowJobExecutionSummary = WorkflowRunOverviewExecution;
export type WorkflowJobExecutionPage = WorkflowJobPage<WorkflowJobExecutionSummary>;
export type WorkflowExecutionStepsPage = WorkflowJobPage<WorkflowJobStepSummary>;
export type WorkflowStepAttemptPage = WorkflowJobPage<WorkflowJobStepAttemptSummary>;

/** The selected-job response deliberately keeps the run shell and job overview compact. */
export interface WorkflowJobDetail {
  workflowRunId: string;
  workflowRunAttempt: number;
  job: WorkflowRunOverviewJob;
  selectedExecution: WorkflowJobExecutionDetail | null;
}
