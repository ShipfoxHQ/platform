import {sql} from 'drizzle-orm';
import type {Tx} from './db.js';

/**
 * The enrollment/termination lock order for runners with a workspace. Callers
 * handling an unassigned runner may skip the workspace lock because there is
 * no workspace-scoped enrollment to serialize; termination authorization and
 * token consumption always have a workspace before taking this lock.
 */
export async function lockRunnerEnrollmentTx(
  tx: Tx,
  params: {workspaceId: string; runnerInstanceId: string},
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`runners_workspace:${params.workspaceId}`}))`,
  );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`runners_activation:${params.runnerInstanceId}`}))`,
  );
}
