import {
  MAX_RUNNER_LABEL_LENGTH,
  MAX_RUNNER_LABELS,
  RUNNER_LABEL_PATTERN,
} from '@shipfox/runner-labels';
import {z} from 'zod';
import {runnerLifecycleCapabilitiesSchema} from './lifecycle-capabilities.js';
import {runnerToolCapabilitiesSchema} from './tool-capabilities.js';

export const runnerLabelSchema = z
  .string()
  .min(1)
  .max(MAX_RUNNER_LABEL_LENGTH)
  .regex(new RegExp(RUNNER_LABEL_PATTERN.source, 'i'));

export const registerRunnerBodySchema = z.object({
  labels: z.array(runnerLabelSchema).min(1).max(MAX_RUNNER_LABELS),
  capabilities: runnerToolCapabilitiesSchema.optional(),
  lifecycle_capabilities: runnerLifecycleCapabilitiesSchema.optional(),
});

export const registerRunnerResponseSchema = z.object({
  session_token: z.string().min(1),
  session_id: z.string().uuid(),
  mode: z.enum(['manual', 'ephemeral', 'activation']),
  max_claims: z.number().int().positive().nullable(),
});

export type RegisterRunnerBodyDto = z.infer<typeof registerRunnerBodySchema>;
export type RegisterRunnerResponseDto = z.infer<typeof registerRunnerResponseSchema>;
