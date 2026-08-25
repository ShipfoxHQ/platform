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
export function createReleaseAbandonedSessionClaimsActivity(
  workflows: WorkflowsModuleClient | undefined,
) {
  return async (params: {jobId: string}): Promise<{released: number}> => {
    if (workflows === undefined) {
      // The grace-release workflow is only started when the module was composed
      // with the workflows client (see the module's job-terminated subscriber), so
      // this is a fail-loud guard, not an expected path: without the client the
      // job's step attempts cannot be listed and the sweep cannot run.
      throw new Error(
        'Agent session grace release requires a workflows inter-module client; the module was composed without one.',
      );
    }
    const {stepAttemptIds} = await workflows.listJobStepAttempts({jobId: params.jobId});
    if (stepAttemptIds.length === 0) return {released: 0};

    const released = await releaseSessionClaimsHeldByStepAttempts(stepAttemptIds);
    if (released > 0) {
      sessionClaimReleaseCount.add(released, {path: 'job-grace'});
    }
    return {released};
  };
}
