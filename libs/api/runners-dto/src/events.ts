import {z} from 'zod';

const nonEmptyStringSchema = z.string().nonempty();
const isoDateTimeSchema = z.string().datetime();

export const RUNNER_JOB_LEASE_EXPIRED = 'runners.job.lease_expired' as const;
export const RUNNER_JOB_CLAIMED = 'runners.job.claimed' as const;

export const runnerJobLeaseExpiredEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
});
export type RunnerJobLeaseExpiredEvent = z.infer<typeof runnerJobLeaseExpiredEventSchema>;

export const runnerJobClaimedEventSchema = z.object({
  workflowRunId: nonEmptyStringSchema,
  workflowRunAttemptId: nonEmptyStringSchema,
  jobId: nonEmptyStringSchema,
  jobExecutionId: nonEmptyStringSchema,
  claimedAt: isoDateTimeSchema,
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
