import type {EvaluationTraceEntry, StepAttempt} from './step-attempt.js';

export type StepErrorReason =
  | 'checkout_failed'
  | 'checkout_auth_failed'
  | 'checkout_unavailable'
  | 'checkout_path_invalid'
  | 'checkout_destination_occupied'
  | 'git_unavailable'
  | 'workspace_prep_failed'
  | 'setup_aborted'
  | 'config_unresolvable'
  | 'output_invalid'
  | 'agent_config_invalid'
  | 'agent_invocation_failed'
  | 'agent_harness_unavailable';
export type AgentConfigIssue =
  | 'step_config_invalid'
  | 'provider_not_configured'
  | 'provider_unsupported'
  | 'model_unavailable'
  | 'credentials_invalid';
export type StepErrorCategory = 'setup' | 'user';
export const STEP_ERROR_REASONS = new Set<StepErrorReason>([
  'checkout_failed',
  'checkout_auth_failed',
  'checkout_unavailable',
  'checkout_path_invalid',
  'checkout_destination_occupied',
  'git_unavailable',
  'workspace_prep_failed',
  'setup_aborted',
  'config_unresolvable',
  'output_invalid',
  'agent_config_invalid',
  'agent_invocation_failed',
  'agent_harness_unavailable',
]);
export const AGENT_CONFIG_ISSUES = new Set<AgentConfigIssue>([
  'step_config_invalid',
  'provider_not_configured',
  'provider_unsupported',
  'model_unavailable',
  'credentials_invalid',
]);

export interface StepSourceLocation {
  startLine: number;
  endLine: number;
}

export interface StepError {
  message: string;
  exitCode: number | null;
  signal: string | undefined;
  reason: StepErrorReason | undefined;
  agentConfigIssue: AgentConfigIssue | undefined;
  category: StepErrorCategory | undefined;
}

export interface AgentStepConfig {
  provider: string | null;
  model: string | null;
  thinking: string | null;
}

export interface Step {
  id: string;
  jobExecutionId: string;
  key: string | null;
  name: string;
  sourceLocation: StepSourceLocation | null;
  status: string;
  statusReason: string | null;
  type: string;
  config: Record<string, unknown>;
  evaluationTrace: EvaluationTraceEntry[] | null;
  agentConfig: AgentStepConfig | null;
  error: StepError | null;
  position: number;
  currentAttempt: number;
  createdAt: string;
  updatedAt: string;
  attempts: StepAttempt[];
}

export function resolveStepAttempt(
  step: Step,
  attemptId: string | undefined,
): StepAttempt | undefined {
  const attemptById = attemptId
    ? step.attempts.find((attempt) => attempt.id === attemptId)
    : undefined;
  if (attemptById) return attemptById;

  const currentAttempt = step.attempts.find((attempt) => attempt.attempt === step.currentAttempt);
  if (currentAttempt) return currentAttempt;

  return step.attempts.reduce<StepAttempt | undefined>((latest, attempt) => {
    if (!latest) return attempt;
    return compareStepAttempts(attempt, latest) > 0 ? attempt : latest;
  }, undefined);
}

export function compareStepAttempts(left: StepAttempt, right: StepAttempt): number {
  return (
    left.attempt - right.attempt ||
    left.executionOrder - right.executionOrder ||
    left.id.localeCompare(right.id)
  );
}
