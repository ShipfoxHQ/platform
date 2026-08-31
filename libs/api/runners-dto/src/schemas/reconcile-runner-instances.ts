import {z} from 'zod';
import {providerRunnerStateSchema} from './report-runner-instances.js';

export const MAX_RECONCILE_OBSERVED_RUNNERS = 5000;
export const MAX_OBSERVED_PROVIDER_RUNNER_ID_LENGTH = 255;
export const MAX_TERMINATION_CANDIDATES = 100;
export const RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER =
  'x-shipfox-reconcile-intended-reservation';
export const RECONCILE_RUNNER_INSTANCES_INTENDED_RESERVATION_HEADER_VALUE = '1';

export const providerTerminationCandidateReasonSchema = z.enum([
  'registration-deadline',
  'provider-health-failed',
]);

/** A provider observation that the backend must recheck before issuing authorization. */
export const providerTerminationCandidateSchema = z
  .object({
    provider_runner_id: z.string().min(1).max(MAX_OBSERVED_PROVIDER_RUNNER_ID_LENGTH),
    reason: providerTerminationCandidateReasonSchema,
    observed_at: z.string().datetime(),
  })
  .strict();

export const reconcileRunnerInstancesBodySchema = z
  .object({
    observed_provider_runner_ids: z
      .array(z.string().min(1).max(MAX_OBSERVED_PROVIDER_RUNNER_ID_LENGTH))
      .max(MAX_RECONCILE_OBSERVED_RUNNERS),
    termination_candidates: z
      .array(providerTerminationCandidateSchema)
      .max(MAX_TERMINATION_CANDIDATES)
      .optional(),
  })
  .strict()
  .refine(
    (body) =>
      new Set(body.observed_provider_runner_ids).size === body.observed_provider_runner_ids.length,
    {
      message: 'observed_provider_runner_ids values must be unique',
      path: ['observed_provider_runner_ids'],
    },
  )
  .refine(
    (body) =>
      new Set(body.termination_candidates?.map((candidate) => candidate.provider_runner_id))
        .size === (body.termination_candidates?.length ?? 0),
    {
      message: 'termination_candidates provider_runner_id values must be unique',
      path: ['termination_candidates'],
    },
  );

export const runnerJobStopReasonSchema = z.enum(['run_cancelled', 'timed_out']);
export type RunnerJobStopReasonDto = z.infer<typeof runnerJobStopReasonSchema>;

export const reconcileDesiredIntentSchema = z.enum(['keep', 'terminate']);
export const terminationReasonSchema = z.enum([
  'registration-deadline',
  'activation-timeout',
  'runner-unresponsive',
  'lease-expired',
  'session-exhausted',
  'stopping-timeout',
  'provider-health-failed',
  'job-cancelled',
  'job-timeout',
  'terminal-state',
]);
export type TerminationReasonDto = z.infer<typeof terminationReasonSchema>;

export const reconciledBoundJobSchema = z
  .object({
    job_id: z.string().uuid(),
    workflow_run_attempt_id: z.string().uuid(),
    last_heartbeat_at: z.string().datetime(),
    cancellation_requested_at: z.string().datetime().nullable(),
    // Optional for compatibility with older runner API responses.
    cancellation_reason: runnerJobStopReasonSchema.nullable().optional(),
  })
  .strict();

export const reconciledRunnerInstanceSchema = z
  .object({
    provider_runner_id: z.string(),
    state: providerRunnerStateSchema.nullable(),
    intended_reservation_id: z.string().uuid().nullable().optional(),
    reservation_id: z.string().uuid().nullable(),
    runner_session_id: z.string().uuid().nullable(),
    // Optional so older API versions can still be consumed by provisioners.
    stopping_at: z.string().datetime().optional(),
    bound_job: reconciledBoundJobSchema.nullable(),
    desired_intent: reconcileDesiredIntentSchema,
    // Keep unknown fields so provisioners can receive additive response fields.
    termination_reason: terminationReasonSchema.nullable().optional(),
  })
  .passthrough();

export const reconcileRunnerInstancesResponseSchema = z
  .object({
    runners: z.array(reconciledRunnerInstanceSchema),
    terminated_absent_provider_runner_ids: z.array(z.string()),
  })
  .strict();

export type ProviderTerminationCandidateDto = z.infer<typeof providerTerminationCandidateSchema>;
export type ProviderTerminationCandidateReasonDto = z.infer<
  typeof providerTerminationCandidateReasonSchema
>;
export type ReconcileRunnerInstancesBodyDto = z.infer<typeof reconcileRunnerInstancesBodySchema>;
export type ReconcileDesiredIntentDto = z.infer<typeof reconcileDesiredIntentSchema>;
export type ReconciledBoundJobDto = z.infer<typeof reconciledBoundJobSchema>;
export type ReconciledRunnerInstanceDto = z.infer<typeof reconciledRunnerInstanceSchema>;
export type ReconcileRunnerInstancesResponseDto = z.infer<
  typeof reconcileRunnerInstancesResponseSchema
>;
