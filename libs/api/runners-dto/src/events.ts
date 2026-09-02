import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();
const isoDateTimeSchema = z.string().datetime();

export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;
export const RUNNER_JOB_CLAIMED = 'runners.job.claimed' as const;

const runnerProvisionerScopeSchema = z.enum(['installation', 'workspace']);
const runnerLaunchKindSchema = z.enum(['demand', 'warm', 'manual']);

export const runnerJobLeaseExpiredEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  /**
   * Time when the reaper detected and removed the stale execution.
   * This is not the lease deadline.
   */
  expiredAt: isoDateTimeSchema.optional(),
});
export type RunnerJobLeaseExpiredEvent = z.infer<typeof runnerJobLeaseExpiredEventSchema>;

export const runnerJobClaimedEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  claimedAt: isoDateTimeSchema,
  // Optional so subscribers can continue to consume events written before the fields existed.
  workspaceId: nonEmptyStringSchema.optional(),
  projectId: nonEmptyStringSchema.optional(),
  runnerLabels: z.array(nonEmptyStringSchema).min(1).optional(),
  templateKey: nonEmptyStringSchema.nullable().optional(),
  providerRunnerId: nonEmptyStringSchema.nullable().optional(),
  provisionerId: nonEmptyStringSchema.nullable().optional(),
  provisionerScope: runnerProvisionerScopeSchema.nullable().optional(),
  providerKind: nonEmptyStringSchema.nullable().optional(),
  launchKind: runnerLaunchKindSchema.nullable().optional(),
});
export type RunnerJobClaimedEvent = z.infer<typeof runnerJobClaimedEventSchema>;

export interface RunnersEventMap {
  [RUNNER_JOB_LEASE_EXPIRED]: RunnerJobLeaseExpiredEvent;
  [RUNNER_JOB_CLAIMED]: RunnerJobClaimedEvent;
}

export const runnersEventSchemas = {
  [RUNNER_JOB_LEASE_EXPIRED]: runnerJobLeaseExpiredEventSchema,
  [RUNNER_JOB_CLAIMED]: runnerJobClaimedEventSchema,
} satisfies Record<keyof RunnersEventMap, z.ZodType>;
