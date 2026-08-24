import {log, proxyActivities, sleep} from '@temporalio/workflow';
import type {createAgentSessionActivities} from '../activities/index.js';

const {releaseAbandonedSessionClaimsActivity} = proxyActivities<
  ReturnType<typeof createAgentSessionActivities>
>({
  startToCloseTimeout: '5 minutes',
});

export interface ReleaseAbandonedSessionClaimsInput {
  jobId: string;
  graceSeconds: number;
}

/**
 * Started by the `WORKFLOWS_JOB_TERMINATED` subscriber, deduped per job. Waits
 * out the grace period (so a last in-flight attempt can report and its own
 * step-attempt-terminated release can win), then releases whatever session
 * claims the job's step attempts still hold.
 */
export async function releaseAbandonedSessionClaims(
  input: ReleaseAbandonedSessionClaimsInput,
): Promise<void> {
  await sleep(input.graceSeconds * 1000);

  const {released} = await releaseAbandonedSessionClaimsActivity({jobId: input.jobId});
  if (released > 0) {
    log.info('Released abandoned agent session claims', {jobId: input.jobId, released});
  }
}
