import crypto from 'node:crypto';
import type {WorkflowsStepAttemptTerminatedEventDto} from '@shipfox/api-workflows-dto';
import {eq} from 'drizzle-orm';
import {claimSession, db, sessions} from '#db/index.js';
import {onStepAttemptTerminated} from './on-step-attempt-terminated.js';

function buildPayload(stepAttemptId: string | undefined): WorkflowsStepAttemptTerminatedEventDto {
  return {
    jobId: crypto.randomUUID(),
    workflowRunId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    stepId: crypto.randomUUID(),
    attempt: 1,
    status: 'failed',
    logOutcome: 'drained',
    ...(stepAttemptId === undefined ? {} : {stepAttemptId}),
  };
}

describe('onStepAttemptTerminated', () => {
  it('releases the session claims held by the terminated step attempt', async () => {
    const payload = buildPayload(crypto.randomUUID());
    const stepAttemptId = payload.stepAttemptId as string;
    const claimed = await claimSession({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      key: 'main',
      harness: 'pi',
      stepAttemptId,
    });

    await onStepAttemptTerminated(payload);

    const [row] = await db().select().from(sessions).where(eq(sessions.id, claimed.id));
    expect(row?.claimedByStepAttempt).toBeNull();
    expect(row?.claimedAt).toBeNull();
  });

  it('never steals a claim held by another attempt', async () => {
    const payload = buildPayload(crypto.randomUUID());
    const holder = crypto.randomUUID();
    const held = await claimSession({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      key: 'main',
      harness: 'pi',
      stepAttemptId: holder,
    });

    await onStepAttemptTerminated(payload);

    const [row] = await db().select().from(sessions).where(eq(sessions.id, held.id));
    expect(row?.claimedByStepAttempt).toBe(holder);
  });

  it('is a no-op for events written before stepAttemptId existed', async () => {
    const payload = buildPayload(undefined);
    const stepAttemptId = crypto.randomUUID();
    const claimed = await claimSession({
      workspaceId: payload.workspaceId,
      projectId: payload.projectId,
      workflowRunAttemptId: payload.workflowRunAttemptId,
      key: 'main',
      harness: 'pi',
      stepAttemptId,
    });

    await onStepAttemptTerminated(payload);

    const [row] = await db().select().from(sessions).where(eq(sessions.id, claimed.id));
    expect(row?.claimedByStepAttempt).toBe(stepAttemptId);
  });
});
