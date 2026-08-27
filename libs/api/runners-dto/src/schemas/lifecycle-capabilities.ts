import {z} from 'zod';

/** Capabilities that change runner lifecycle safety semantics. */
export const runnerLifecycleCapabilitySchema = z.enum(['local_execution_fence_v1']);

export const runnerLifecycleCapabilitiesSchema = z
  .array(runnerLifecycleCapabilitySchema)
  .max(8)
  .refine((capabilities) => new Set(capabilities).size === capabilities.length, {
    message: 'Lifecycle capabilities must be unique',
  });

export type RunnerLifecycleCapability = z.infer<typeof runnerLifecycleCapabilitySchema>;
export type RunnerLifecycleCapabilitiesDto = z.infer<typeof runnerLifecycleCapabilitiesSchema>;
