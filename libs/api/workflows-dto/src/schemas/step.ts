import {z} from 'zod';

// Machine-readable cause of a step failure, for DB troubleshooting. The runner
// reports it and the server stores it as-is. The `checkout_*`, `git_unavailable`,
// `workspace_prep_failed`, and `setup_aborted` values cover setup-phase failures.
// For agent steps the cause is split three ways: `agent_config_invalid` is a user-fixable
// configuration error and carries an `agent_config_issue`; `agent_invocation_failed`
// covers a provider/API failure once the configuration is valid; and
// `agent_harness_unavailable` means the runner could not start its harness, so the model
// was never called. The latter carries no `agent_config_issue`, because every issue code
// names a user-fixable cause. (Aborts are never reported: the step loop stops before reporting.)
export const stepErrorReasonSchema = z.enum([
  'checkout_failed',
  'checkout_auth_failed',
  'checkout_unavailable',
  'git_unavailable',
  'workspace_prep_failed',
  'setup_aborted',
  'config_unresolvable',
  'output_invalid',
  'agent_config_invalid',
  'agent_invocation_failed',
  'agent_harness_unavailable',
]);

export type StepErrorReasonDto = z.infer<typeof stepErrorReasonSchema>;

export const agentConfigIssueSchema = z.enum([
  'step_config_invalid',
  'provider_not_configured',
  'provider_unsupported',
  'model_unavailable',
  'credentials_invalid',
]);

export type AgentConfigIssueDto = z.infer<typeof agentConfigIssueSchema>;

// Whether a failure is infrastructure (`setup`) or user-code (`user`). Server-derived
// from the step's type on the read path; the runner never sends it.
export const stepErrorCategorySchema = z.enum(['setup', 'user']);

export type StepErrorCategoryDto = z.infer<typeof stepErrorCategorySchema>;

export const STEP_ERROR_MESSAGE_MAX_LENGTH = 2048;

export const stepErrorDtoSchema = z
  .object({
    message: z.string().max(STEP_ERROR_MESSAGE_MAX_LENGTH),
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
  type: z.string(),
  config: z.record(z.string(), z.unknown()),
  error: stepErrorDtoSchema,
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
      source: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('failed'),
      passed: z.literal(false),
      source: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('uncheckable'),
      passed: z.literal(false),
      uncheckable: z.literal(true),
      reason: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('evaluation_error'),
      reason: z.string(),
      exit_code: z.number().int().nullable(),
    }),
    z.object({
      kind: z.literal('unknown'),
      data: z.record(z.string(), z.unknown()),
    }),
  ])
  .nullable();

export type StepGateResultDto = z.infer<typeof stepGateResultDtoSchema>;

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
  started_at: z.string(),
  finished_at: z.string().nullable(),
});

export type StepAttemptDto = z.infer<typeof stepAttemptDtoSchema>;
