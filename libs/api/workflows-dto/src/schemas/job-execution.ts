import {z} from 'zod';
import {logOutcomeSchema} from './log-outcome.js';
import {stepDtoSchema, stepErrorDtoSchema} from './step.js';

export const STEP_RESPONSE_MAX_LENGTH = 8 * 1024;

/**
 * The job to progress is identified by the caller's lease-token claims, never by
 * the request. An unknown job is a 404, not a `done`.
 */
export const nextStepResponseSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('step'),
    step: stepDtoSchema,
    attempt: z
      .number()
      .int()
      .positive()
      .describe(
        'Attempt number for this step dispatch. Echo it back when reporting the step result so stale reports from older attempts can be ignored.',
      ),
    lease_token: z
      .string()
      .min(1)
      .describe(
        'Job-lease token re-scoped to this dispatched step attempt. The runner presents it as its lease for log-append authorization and carries it on later step requests.',
      ),
  }),
  z.object({
    kind: z.literal('done'),
    status: z
      .enum(['succeeded', 'failed'])
      .describe('Terminal status of the job when no step remains to run.'),
  }),
]);

export type NextStepResponseDto = z.infer<typeof nextStepResponseSchema>;

export const checkoutResultSchema = z
  .object({
    repository: z.string().min(1),
    ref: z.string().min(1),
    commit: z.string().min(1),
    path: z.string().min(1),
  })
  .describe('Resolved repository checkout details reported by the runner.');
export type CheckoutResultDto = z.infer<typeof checkoutResultSchema>;

export const reportStepBodySchema = z
  .object({
    status: z.enum(['succeeded', 'failed']).describe('Final status reported for the step attempt.'),
    error: stepErrorDtoSchema
      .optional()
      .describe('Failure details. Required when status is failed.'),
    attempt: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        'Attempt number echoed from next-step. Older runners may omit it; when present, it protects the workflow from stale reports.',
      ),
    exit_code: z
      .number()
      .int()
      .nullable()
      .optional()
      .describe(
        'Process exit code for the step attempt. Persisted as the canonical attempt exit code and used by gate evaluation.',
      ),
    output: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional()
      .describe(
        'Structured output captured for attempt history. Large textual logs are stored separately.',
      ),
    checkout: checkoutResultSchema
      .optional()
      .describe('Resolved repository checkout details captured for attempt history.'),
    response: z
      .string()
      .max(STEP_RESPONSE_MAX_LENGTH)
      .optional()
      .describe('Capped final assistant response for agent step attempts. Omitted for run steps.'),
    log_outcome: logOutcomeSchema.describe(
      'Whether the runner drained all locally spooled logs before reporting, or abandoned the log stream for backend closure.',
    ),
  })
  .refine((body) => (body.status === 'succeeded' ? body.error == null : body.error != null), {
    message: 'succeeded steps must not include an error and failed steps must include one',
  });

export type ReportStepBodyDto = z.infer<typeof reportStepBodySchema>;

export const reportStepResponseSchema = z.object({
  ok: z.boolean().describe('Whether the step report was accepted.'),
  cancel: z
    .boolean()
    .describe(
      'Whether the runner should stop working on the job because it finished without full success.',
    ),
});

export type ReportStepResponseDto = z.infer<typeof reportStepResponseSchema>;
