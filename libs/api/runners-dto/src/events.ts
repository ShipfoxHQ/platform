import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();
const isoDateTimeSchema = z.string().datetime();
const provisionerScopeSchema = z.enum(['installation', 'workspace']);
const runnerLaunchKindSchema = z.enum(['demand', 'warm', 'manual']);

export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;
export const RUNNER_JOB_CLAIMED = 'runners.job.claimed' as const;

export const runnerJobLeaseExpiredEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  expiredAt: isoDateTimeSchema.optional(),
});
export type RunnerJobLeaseExpiredEvent = z.infer<typeof runnerJobLeaseExpiredEventSchema>;

export const runnerJobClaimedEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  claimedAt: isoDateTimeSchema,
  workspaceId: nonEmptyStringSchema.optional(),
  projectId: nonEmptyStringSchema.optional(),
  runnerLabels: z.array(nonEmptyStringSchema).min(1).optional(),
  templateKey: nonEmptyStringSchema.nullable().optional(),
  provisionerId: nonEmptyStringSchema.nullable().optional(),
  provisionerScope: provisionerScopeSchema.nullable().optional(),
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
