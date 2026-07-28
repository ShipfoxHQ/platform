import {MAX_RUNNER_LABELS} from '@shipfox/runner-labels';
import {z} from 'zod';
import {runnerLabelSchema} from './register.js';
import {runnerToolCapabilitiesSchema} from './tool-capabilities.js';

export const runnerBootstrapExchangeBodySchema = z
  .object({bootstrap_token: z.string().min(1)})
  .strict();
export const createRunnerInstancesBodySchema = z
  .object({
    provider_kind: z.string().min(1).max(64).optional(),
    runner_instances: z
      .array(
        z
          .object({
            template_key: z.string().min(1).max(255).optional(),
            reservation_id: z.string().uuid().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
export const createRunnerInstancesResponseSchema = z.object({
  runner_instances: z.array(
    z.object({runner_instance_id: z.string().uuid(), bootstrap_token: z.string().min(1)}),
  ),
});
export const runnerBootstrapExchangeResponseSchema = z.object({
  runner_instance_id: z.string().uuid(),
  control_session_token: z.string().min(1),
  expires_at: z.string().datetime(),
});
export const runnerEnrollmentBodySchema = z
  .object({
    labels: z.array(runnerLabelSchema).min(1).max(MAX_RUNNER_LABELS),
    capabilities: runnerToolCapabilitiesSchema.optional(),
    provider_kind: z.string().min(1).max(64),
    protocol_version: z.string().min(1).max(64),
  })
  .strict();
export const runnerEnrollmentResponseSchema = z.object({
  activation_token: z.string().min(1).nullable(),
});
export const attachRunnerControlProviderIdBodySchema = z
  .object({provider_runner_id: z.string().min(1).max(255)})
  .strict();
export const runnerControlHeartbeatResponseSchema = z.object({ok: z.literal(true)});
export const RUNNER_ASSIGNMENT_POLL_DEFAULT_WAIT_SECONDS = 30;
export const runnerAssignmentPollQuerySchema = z
  .object({wait_seconds: z.coerce.number().int().min(1).optional()})
  .strict();
export const runnerAssignmentPollResponseSchema = z.object({
  activation_token: z.string().min(1).nullable(),
});

export type RunnerBootstrapExchangeBodyDto = z.infer<typeof runnerBootstrapExchangeBodySchema>;
export type CreateRunnerInstancesBodyDto = z.infer<typeof createRunnerInstancesBodySchema>;
export type CreateRunnerInstancesResponseDto = z.infer<typeof createRunnerInstancesResponseSchema>;
export type RunnerBootstrapExchangeResponseDto = z.infer<
  typeof runnerBootstrapExchangeResponseSchema
>;
export type RunnerEnrollmentBodyDto = z.infer<typeof runnerEnrollmentBodySchema>;
export type RunnerEnrollmentResponseDto = z.infer<typeof runnerEnrollmentResponseSchema>;
export type RunnerAssignmentPollQueryDto = z.infer<typeof runnerAssignmentPollQuerySchema>;
