import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {releaseSessionClaimsHeldByStepAttempts} from '#db/index.js';
import {sessionClaimReleaseCount} from '#metrics/instance.js';

/**
 * Releases every session claim the terminated job's step attempts still hold.
 * `listJobStepAttempts` requires a workflows module that ships the method added
 * with the session release stack; agent and workflows must deploy together. The
 * release is guarded on the claiming attempt, so it never steals a claim a
 * step re-claimed after the job-terminated sweep started.
 */
export function createReleaseAbandonedSessionClaimsActivity(workflows: WorkflowsModuleClient) {
  return async (params: {jobId: string}): Promise<{released: number}> => {
    const {stepAttemptIds} = await workflows.listJobStepAttempts({jobId: params.jobId});
    if (stepAttemptIds.length === 0) return {released: 0};

    const released = await releaseSessionClaimsHeldByStepAttempts(stepAttemptIds);
    if (released > 0) {
      sessionClaimReleaseCount.add(released, {path: 'job-grace'});
    }
    return {released};
  };
}
