import crypto from 'node:crypto';
import type {WorkflowsModuleClient} from '@shipfox/api-workflows-dto/inter-module';
import {eq} from 'drizzle-orm';
import {claimSession, db, sessions} from '#db/index.js';
import {createReleaseAbandonedSessionClaimsActivity} from './release-abandoned-session-claims.js';

describe('releaseAbandonedSessionClaimsActivity', () => {
  it('releases claims held by the terminated job step attempts', async () => {
    const stepAttemptId = crypto.randomUUID();
    const ctx = {
      workspaceId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      workflowRunAttemptId: crypto.randomUUID(),
      harness: 'pi' as const,
    };
    const claimed = await claimSession({...ctx, key: 'main', stepAttemptId});
    const workflows = {
      listJobStepAttempts: vi.fn().mockResolvedValue({stepAttemptIds: [stepAttemptId]}),
    } as unknown as WorkflowsModuleClient;

    const activity = createReleaseAbandonedSessionClaimsActivity(workflows);
    const result = await activity({jobId: crypto.randomUUID()});

    expect(workflows.listJobStepAttempts).toHaveBeenCalledTimes(1);
    expect(result).toEqual({released: 1});
    const [row] = await db().select().from(sessions).where(eq(sessions.id, claimed.id));
    expect(row?.claimedByStepAttempt).toBeNull();
  });

  it('is a no-op when the job has no step attempts', async () => {
    const workflows = {
      listJobStepAttempts: vi.fn().mockResolvedValue({stepAttemptIds: []}),
    } as unknown as WorkflowsModuleClient;

    const activity = createReleaseAbandonedSessionClaimsActivity(workflows);
    const result = await activity({jobId: crypto.randomUUID()});

    expect(result).toEqual({released: 0});
  });
});
