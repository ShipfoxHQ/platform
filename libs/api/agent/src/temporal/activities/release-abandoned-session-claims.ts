import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {releaseSessionClaimsHeldByStepAttempts} from '#db/index.js';

export function createReleaseAbandonedSessionClaimsActivity(workflows: WorkflowsModuleClient) {
  return async (params: {jobId: string}): Promise<{released: number}> => {
    const {stepAttemptIds} = await workflows.listJobStepAttempts({jobId: params.jobId});
    if (stepAttemptIds.length === 0) return {released: 0};

    const released = await releaseSessionClaimsHeldByStepAttempts(stepAttemptIds);
    return {released};
  };
}
