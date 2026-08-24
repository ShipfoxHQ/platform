import crypto from 'node:crypto';
import {eq, sql} from 'drizzle-orm';
import {claimSession, db, sessions} from '#db/index.js';
import {reapStaleSessionClaims} from './reap-stale-session-claims.js';

// Reap tests share the Postgres database with other test files, so the cutoff
// and the backdated timestamps use horizons no other suite touches: only rows
// backdated 20 years qualify at a 10-year cutoff.
const TWENTY_YEARS = sql`now() - interval '20 years'`;
const TEN_YEARS_SECONDS = 10 * 365 * 24 * 60 * 60;

async function backdate(sessionId: string): Promise<void> {
  await db().update(sessions).set({claimedAt: TWENTY_YEARS}).where(eq(sessions.id, sessionId));
}

function newClaimCtx() {
  return {
    workspaceId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    workflowRunAttemptId: crypto.randomUUID(),
    harness: 'pi' as const,
    stepAttemptId: crypto.randomUUID(),
  };
}

describe('reapStaleSessionClaims', () => {
  it('releases claims held past the cutoff and leaves fresh claims alone', async () => {
    const ctx = newClaimCtx();
    const fresh = await claimSession({...ctx, key: 'fresh', stepAttemptId: crypto.randomUUID()});
    const stale = await claimSession({...ctx, key: 'stale', stepAttemptId: crypto.randomUUID()});
    await backdate(stale.id);

    const result = await reapStaleSessionClaims({
      olderThanSeconds: TEN_YEARS_SECONDS,
      batchLimit: 10,
    });

    expect(result).toEqual({reaped: 1, failed: 0});
    const [staleRow] = await db().select().from(sessions).where(eq(sessions.id, stale.id));
    expect(staleRow?.claimedByStepAttempt).toBeNull();
    const [freshRow] = await db().select().from(sessions).where(eq(sessions.id, fresh.id));
    expect(freshRow?.claimedByStepAttempt).toBe(fresh.claimedByStepAttempt);
  });

  it('is idempotent across overlapping cron runs', async () => {
    const ctx = newClaimCtx();
    const claimed = await claimSession({...ctx, key: 'stale'});
    await backdate(claimed.id);

    const first = await reapStaleSessionClaims({
      olderThanSeconds: TEN_YEARS_SECONDS,
      batchLimit: 10,
    });
    const second = await reapStaleSessionClaims({
      olderThanSeconds: TEN_YEARS_SECONDS,
      batchLimit: 10,
    });

    expect(first).toEqual({reaped: 1, failed: 0});
    expect(second).toEqual({reaped: 0, failed: 0});
    const [row] = await db().select().from(sessions).where(eq(sessions.id, claimed.id));
    expect(row?.claimedByStepAttempt).toBeNull();
  });

  it('clears every claim a wedged attempt held, not just the listed session', async () => {
    const ctx = newClaimCtx();
    const first = await claimSession({...ctx, key: 'one'});
    const second = await claimSession({...ctx, key: 'two'});
    await backdate(first.id);
    await backdate(second.id);

    const result = await reapStaleSessionClaims({
      olderThanSeconds: TEN_YEARS_SECONDS,
      batchLimit: 10,
    });

    // Both claims belong to the same wedged attempt, so they dedupe into one
    // guarded release statement that clears both rows; reaped sums the actual
    // claims cleared, not the statements issued.
    expect(result.reaped).toBe(2);
    expect(await findClaim(first.id)).toBeNull();
    expect(await findClaim(second.id)).toBeNull();
  });
});

async function findClaim(sessionId: string): Promise<string | null> {
  const [row] = await db().select().from(sessions).where(eq(sessions.id, sessionId));
  return row?.claimedByStepAttempt ?? null;
}
