import type {
  AgentIntegrationMcpServerConfigDto,
  MaterializedAgentIntegrationConfigDto,
} from '@shipfox/api-agent-dto';
import type {
  EvaluationTraceEntry,
  EvaluationTraceLimitEntry,
  ResolvedField,
  WorkflowExpression,
} from '@shipfox/expression';
import type {Harness} from '@shipfox/workflow-document';
import type {InterpolationUnresolvableField} from '../errors.js';

export type StepStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';

export const STEP_TYPES = ['setup', 'run', 'agent', 'checkout', 'tool'] as const;

export type StepType = (typeof STEP_TYPES)[number];

export const STEP_STATUS_REASONS = [
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
] as const;

export type StepStatusReason = (typeof STEP_STATUS_REASONS)[number];

const STEP_STATUS_REASON_SET = new Set<StepStatusReason>(STEP_STATUS_REASONS);

export function toStepStatusReason(value: string | null): StepStatusReason | null {
  if (value === null) return null;
  return STEP_STATUS_REASON_SET.has(value as StepStatusReason) ? (value as StepStatusReason) : null;
}

export type StepAttemptLogOutcome = 'drained' | 'abandoned';

// A step_attempts row exists only once an attempt is dispatched, so it is never
// 'pending' or 'skipped'.
export type StepAttemptStatus = Exclude<StepStatus, 'pending' | 'skipped'>;

export interface StepSourceLocation {
  startLine: number;
  endLine: number;
}

/**
 * Trace entry after a resolver-local expression trace is attached to workflow
 * storage.
 *
 * Step config traces are stored on step attempts with the resolved attempt
 * config; job-level traces are stored on the job or job-execution row whose
 * value/status they explain. Keep `field` as the authored field path that
 * produced the trace, not as a step-only enum.
 */
export type PersistedEvaluationTraceEntry =
  | (EvaluationTraceEntry & {
      readonly field: string;
      readonly envKey?: string;
    })
  | EvaluationTraceLimitEntry;

export interface StepConfigEvaluationTraceEntry extends EvaluationTraceEntry {
  readonly field: InterpolationUnresolvableField;
  readonly envKey?: string;
}

export interface StepConfigDispatchPlan {
  working_directory?: ResolvedField;
  run?: ResolvedField;
  env?: Readonly<Record<string, ResolvedField>>;
  checkout?: {
    project?: ResolvedField;
    connection?: ResolvedField;
    repository?: ResolvedField;
    ref?: ResolvedField;
    path?: ResolvedField;
  };
  agent?: {
    prompt?: ResolvedField;
    model?: ResolvedField;
    provider?: ResolvedField;
    harness?: Harness;
    thinking?: ResolvedField;
    session?: {
      key: ResolvedField;
      mode: 'resume' | 'fork';
    };
    tools?: readonly string[];
    integrations?: readonly MaterializedAgentIntegrationConfigDto[];
    mcpServers?: readonly AgentIntegrationMcpServerConfigDto[];
  };
  trace?: readonly (StepConfigEvaluationTraceEntry | EvaluationTraceLimitEntry)[];
}

export interface Step {
  id: string;
  jobExecutionId: string;
  key: string | null;
  name: string;
  sourceLocation: StepSourceLocation | null;
  status: StepStatus;
  statusReason: StepStatusReason | null;
  evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  type: StepType;
  config: Record<string, unknown>;
  condition: WorkflowExpression | null;
  configPlan: StepConfigDispatchPlan | null;
  authoredConfig: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  position: number;
  version: number;
  // Execution-attempt identity for the current projection: which attempt the
  // status/output/error above reflect. Distinct from `version` (the optimistic
  // row counter). Starts at 1 and is bumped when a step is rewound.
  currentAttempt: number;
  createdAt: Date;
  updatedAt: Date;
}

// Append-only execution history: one row per dispatched attempt of a step. The
// current projection lives on `Step`; this is the audit trail and the
// idempotency anchor (unique on (stepId, attempt)).
export interface StepAttempt {
  id: string;
  stepId: string;
  attempt: number;
  executionOrder: number;
  status: StepAttemptStatus;
  config: Record<string, unknown> | null;
  evaluationTrace: readonly PersistedEvaluationTraceEntry[] | null;
  output: Record<string, unknown> | null;
  response: string | null;
  error: Record<string, unknown> | null;
  exitCode: number | null;
  gateResult: Record<string, unknown> | null;
  restartFeedback: string | null;
  logOutcome: StepAttemptLogOutcome | null;
  startedAt: Date;
  finishedAt: Date | null;
  createdAt: Date;
}
