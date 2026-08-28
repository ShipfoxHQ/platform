import {sql} from 'drizzle-orm';
import type {Tx} from './db.js';

/**
 * The enrollment/termination lock order. Keep every path that can issue or
 * consume an activation token, or authorize termination, in this order.
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
