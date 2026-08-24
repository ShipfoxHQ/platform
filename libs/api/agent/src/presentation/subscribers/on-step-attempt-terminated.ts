import type {WorkflowsStepAttemptTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {releaseSessionClaimsHeldByStepAttempts} from '#db/index.js';
import {sessionClaimReleaseCount} from '#metrics/instance.js';

/**
 * Releases every session claim the terminated step attempt held. Guarded on
 * the claiming attempt: a redelivered event is a no-op, and a stale event can
 * never steal a claim another attempt just took. Events written before the
 * `stepAttemptId` field existed carry no identity; those claims are left for
 * the job-terminated grace sweep and the reap cron.
 *
 * The release is delivered asynchronously through the workflows outbox, so it
 * is not ordered against the next synchronous `claimSession` at dispatch: the
 * dispatch side must tolerate `session-held` with a short bounded retry until
 * the outbox release lands (implemented with the dispatch consumer).
 */
export async function onStepAttemptTerminated(
  payload: WorkflowsStepAttemptTerminatedEventDto,
): Promise<void> {
  if (!payload.stepAttemptId) return;

  const released = await releaseSessionClaimsHeldByStepAttempts([payload.stepAttemptId]);
  if (released > 0) {
    sessionClaimReleaseCount.add(released, {path: 'step-attempt'});
  }
}
