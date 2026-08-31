import {sql} from 'drizzle-orm';
import type {Tx} from './db.js';

/**
 * Serialize enrollment and termination authorization for a runner. Workspace
 * runners take the workspace lock before the runner lock; unassigned runners
 * use the runner lock as their activation-scoped fallback.
 */
export async function lockRunnerEnrollmentTx(
  tx: Tx,
  params: {workspaceId: string | null; runnerInstanceId: string},
): Promise<void> {
  if (params.workspaceId)
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`runners_workspace:${params.workspaceId}`}))`,
    );
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`runners_activation:${params.runnerInstanceId}`}))`,
  );
}
