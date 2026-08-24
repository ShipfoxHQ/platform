import crypto from 'node:crypto';
import {afterEach, describe, expect, it} from '@shipfox/vitest/vi';
import {eq, sql} from 'drizzle-orm';
import {createSession, db, sessions} from '#db/index.js';
import {onWorkflowRunTerminated} from '#presentation/subscribers/on-workflow-run-terminated.js';

describe('onWorkflowRunTerminated', () => {
  afterEach(async () => {
    await db().execute(sql`TRUNCATE agent_sessions CASCADE`);
  });

  it('stamps retired_at on every session of the terminated run attempt', async () => {
    const workflowRunAttemptId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    for (const key of ['main', 'triage']) {
      await db().transaction((tx) =>
        createSession(tx, {workspaceId, projectId, workflowRunAttemptId, key, harness: 'pi'}),
      );
    }
    // A session of another run attempt must be untouched.
    const otherRun = crypto.randomUUID();
    const other = await db().transaction((tx) =>
      createSession(tx, {
        workspaceId,
        projectId,
        workflowRunAttemptId: otherRun,
        key: 'main',
        harness: 'pi',
      }),
    );

    await onWorkflowRunTerminated({
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId,
      projectId,
      status: 'failed',
    });

    const rows = await db()
      .select()
      .from(sessions)
      .where(eq(sessions.workflowRunAttemptId, workflowRunAttemptId));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.retiredAt).not.toBeNull();
    }

    const untouched = await db().select().from(sessions).where(eq(sessions.id, other.id));
    expect(untouched[0]?.retiredAt).toBeNull();
  });

  it('keeps the original stamp on a redelivered event', async () => {
    const workflowRunAttemptId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const session = await db().transaction((tx) =>
      createSession(tx, {workspaceId, projectId, workflowRunAttemptId, key: 'main', harness: 'pi'}),
    );

    await onWorkflowRunTerminated({
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId,
      projectId,
      status: 'succeeded',
    });
    const [first] = await db().select().from(sessions).where(eq(sessions.id, session.id));
    const firstStamp = first?.retiredAt;
    expect(firstStamp).not.toBeNull();

    // Force a later clock so a re-stamp would be visible if the handler rewrote it.
    await db()
      .update(sessions)
      .set({updatedAt: sql`now() - interval '1 hour'`})
      .where(eq(sessions.id, session.id));

    await onWorkflowRunTerminated({
      workflowRunId: crypto.randomUUID(),
      workflowRunAttemptId,
      projectId,
      status: 'failed',
    });

    const [second] = await db().select().from(sessions).where(eq(sessions.id, session.id));
    expect(second?.retiredAt).toEqual(firstStamp);
  });
});
