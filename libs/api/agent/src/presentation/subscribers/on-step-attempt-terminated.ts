import type {WorkflowsStepAttemptTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {releaseSessionClaimsHeldByStepAttempts} from '#db/index.js';

/**
 * Releases every session claim the terminated step attempt held, so the next
 * dispatch of the step (or a rerun of the run attempt) can claim again.
 * Guarded on the claiming attempt: a redelivered event is a no-op, and a
 * stale event can never steal a claim another attempt just took. Events
 * written before the `stepAttemptId` field existed carry no identity; those
 * claims are left for the job-terminated grace sweep and the reap cron.
 */
export async function onStepAttemptTerminated(
  payload: WorkflowsStepAttemptTerminatedEventDto,
): Promise<void> {
  if (!payload.stepAttemptId) return;

  await releaseSessionClaimsHeldByStepAttempts([payload.stepAttemptId]);
}
