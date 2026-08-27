import {z} from 'zod';
import {runnerJobStopReasonSchema} from './reconcile-runner-instances.js';
import {runnerToolCapabilitiesSchema} from './tool-capabilities.js';

export const heartbeatBodySchema = z
  .object({
    capabilities: runnerToolCapabilitiesSchema.optional(),
  })
  .strict();

export const heartbeatResponseSchema = z.object({
  cancel: z.boolean(),
  lease_token: z.string().min(1),
  // Optional for compatibility with older runner API responses.
  cancellation_reason: runnerJobStopReasonSchema.nullable().optional(),
});

export type HeartbeatBodyDto = z.infer<typeof heartbeatBodySchema>;
export type HeartbeatResponseDto = z.infer<typeof heartbeatResponseSchema>;
