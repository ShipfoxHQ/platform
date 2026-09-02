import {type AgentSessionDescriptorDto, agentSessionDescriptorSchema} from '@shipfox/api-agent-dto';
import {z} from 'zod';
import {evaluationTraceSchema} from './evaluation-trace.js';

export const STEP_STATUS_REASONS = [
  'default_gate_rejected',
  'condition_rejected',
  'condition_errored',
] as const;

export const stepStatusReasonSchema = z.enum(STEP_STATUS_REASONS);

export type StepStatusReasonDto = z.infer<typeof stepStatusReasonSchema>;

// Machine-readable cause of a step failure, for DB troubleshooting. The runner
// reports it and the server stores it as-is. The `checkout_*`, `git_unavailable`,
// `workspace_prep_failed`, and `setup_aborted` values cover checkout/setup failures.
// For agent steps the cause is split into configuration, invocation, harness-startup, and
// dispatch-time session-claim failures. `agent_config_invalid` is a user-fixable configuration
// error and carries an `agent_config_issue`; the other reasons carry no issue code because
// they describe the provider call, harness startup, or session claim. Aborts stop the loop
// unless a session commit has completed, in which case the committed attempt is reported.
export const stepErrorReasonSchema = z.enum([
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
  'agent_session_key_invalid',
  'agent_session_held',
  'agent_session_harness_mismatch',
  'agent_session_unavailable',
  'tool_error',
  'tool_config_invalid',
  'invocation_interrupted',
]);

export type StepErrorReasonDto = z.infer<typeof stepErrorReasonSchema>;

const SETUP_ERROR_REASONS = new Set<StepErrorReasonDto>([
  'checkout_failed',
  'checkout_auth_failed',
  'checkout_unavailable',
  'checkout_path_invalid',
  'checkout_destination_occupied',
  'git_unavailable',
  'workspace_prep_failed',
  'setup_aborted',
]);

export function deriveStepErrorCategory(
  stepType: string,
  reason: StepErrorReasonDto | undefined,
): StepErrorCategoryDto {
  return stepType === 'setup' ||
    stepType === 'checkout' ||
    (reason !== undefined && SETUP_ERROR_REASONS.has(reason))
    ? 'setup'
    : 'user';
}

// Keep the dispatch payload on the same descriptor contract as the Agent
// module. The workflows name is retained as the public payload vocabulary.
export const agentStepSessionDescriptorSchema = agentSessionDescriptorSchema;
export type AgentStepSessionDescriptorDto = AgentSessionDescriptorDto;

// This is the internal shape persisted while a dispatch is waiting for the Agent module to
// resolve a session descriptor. Keep it strict so a resolved descriptor cannot be mistaken for
// an authored intent on a later dispatch.
export const agentStepSessionIntentSchema = z
  .object({
    key: z.string(),
    mode: z.enum(['resume', 'fork']),
  })
  .strict();
export type AgentStepSessionIntentDto = z.infer<typeof agentStepSessionIntentSchema>;

export const agentConfigIssueSchema = z.enum([
  'step_config_invalid',
  'provider_not_configured',
  'provider_unsupported',
  'model_unavailable',
  'credentials_invalid',
]);

export type AgentConfigIssueDto = z.infer<typeof agentConfigIssueSchema>;

// Whether a failure is infrastructure (`setup`) or user-code (`user`). Server-derived
// from the step's type and reason on the read path; the runner never sends it.
export const stepErrorCategorySchema = z.enum(['setup', 'user']);

export type StepErrorCategoryDto = z.infer<typeof stepErrorCategorySchema>;

export const STEP_ERROR_MESSAGE_MAX_LENGTH = 2048;

export const stepErrorDtoSchema = z
  .object({
    message: z.string().max(STEP_ERROR_MESSAGE_MAX_LENGTH),
    code: z.string().min(1).optional(),
    managed_provider_id: z.string().min(1).optional(),
    exit_code: z.number().int().nullable().optional(),
    signal: z.string().optional(),
    reason: stepErrorReasonSchema.optional(),
    field: z.string().optional(),
    source: z.string().optional(),
    agent_config_issue: agentConfigIssueSchema.optional(),
    category: stepErrorCategorySchema.optional(),
  })
  .refine(
    (error) => error.agent_config_issue === undefined || error.reason === 'agent_config_invalid',
    {
      message: 'agent_config_issue requires reason to be agent_config_invalid',
      path: ['agent_config_issue'],
    },
  )
  .nullable();

export type StepErrorDto = z.infer<typeof stepErrorDtoSchema>;

export const stepSourceLocationSchema = z
  .object({
    start_line: z.number().int().positive(),
    end_line: z.number().int().positive(),
  })
  .refine((value) => value.end_line >= value.start_line, {
    message: 'end_line must be greater than or equal to start_line',
    path: ['end_line'],
  });

export type StepSourceLocationDto = z.infer<typeof stepSourceLocationSchema>;

export const stepDtoSchema = z.object({
  id: z.string().uuid(),
  job_execution_id: z.string().uuid(),
  key: z.string().nullable(),
  name: z.string(),
  source_location: stepSourceLocationSchema.nullable(),
  status: z.string(),
  status_reason: stepStatusReasonSchema.nullable(),
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  evaluation_trace: evaluationTraceSchema.nullable(),
  error: stepErrorDtoSchema,
  // Optional for mixed-version readers: older servers do not emit the additive session field.
  session: agentStepSessionDescriptorSchema.nullable().optional(),
  position: z.number(),
  // Execution-attempt identity of the current projection (>1 after a restart).
  current_attempt: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
});

export type StepDto = z.infer<typeof stepDtoSchema>;

export const stepGateResultDtoSchema = z
  .discriminatedUnion('kind', [
    z.object({
      kind: z.literal('none'),
    }),
    z.object({
      kind: z.literal('not_evaluated'),
    }),
    z.object({
      kind: z.literal('passed'),
      passed: z.literal(true),
      source: z.string().max(STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('failed'),
      passed: z.literal(false),
      source: z.string().max(STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('uncheckable'),
      passed: z.literal(false),
      uncheckable: z.literal(true),
      reason: z.string().max(STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('evaluation_error'),
      reason: z.string().max(STEP_ERROR_MESSAGE_MAX_LENGTH),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('unknown'),
      data: z.record(z.string(), z.unknown()),
    }),
  ])
  .nullable();

export type StepGateResultDto = z.infer<typeof stepGateResultDtoSchema>;

export const stepAttemptInvocationSchema = z.object({
  call_index: z.number().int().nonnegative(),
  started_at: z.string(),
  finished_at: z.string().optional(),
  outcome: z.string().optional(),
  error_code: z.string().optional(),
  duration_ms: z.number().int().nonnegative().optional(),
  next_due_at: z.string().optional(),
});

export type StepAttemptInvocationDto = z.infer<typeof stepAttemptInvocationSchema>;

// One execution attempt of a step (the durable history behind the current
// projection). Surfaced in run details so a restarted step's attempts are visible.
export const stepAttemptDtoSchema = z.object({
  id: z.string().uuid(),
  step_id: z.string().uuid(),
  attempt: z.number().int().positive(),
  execution_order: z.number().int().positive(),
  status: z.string(),
  exit_code: z.number().int().nullable(),
  // `output` and `error` are opaque audit blobs: the raw jsonb persisted for the
  // attempt, NOT snake_case-normalized (their nested keys may be camelCase, e.g.
  // `error.exitCode`). Consume the top-level snake_case `exit_code` for the
  // numeric code; treat these as display/debug payloads.
  output: z.record(z.string(), z.unknown()).nullable(),
  outputs: z.record(z.string(), z.unknown()).nullable(),
  response: z.string().nullable(),
  error: z.record(z.string(), z.unknown()).nullable(),
  // `unknown.data` is the raw jsonb gate payload for legacy or unrecognized
  // rows; nested keys are not snake_case-normalized.
  gate_result: stepGateResultDtoSchema,
  restart_feedback: z.string().nullable(),
  invocations: z.array(stepAttemptInvocationSchema).default([]),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export type StepAttemptDto = z.infer<typeof stepAttemptDtoSchema>;

export const stepAttemptDetailDtoSchema = stepAttemptDtoSchema.extend({
  config: z.record(z.string(), z.unknown()).nullable(),
  evaluation_trace: evaluationTraceSchema.nullable(),
});

export type StepAttemptDetailDto = z.infer<typeof stepAttemptDetailDtoSchema>;
