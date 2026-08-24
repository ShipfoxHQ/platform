import {eq} from 'drizzle-orm';
import {db, type Transaction} from './db.js';
import {type SessionDataKey, sessionDataKeys, toSessionDataKey} from './schema/data-keys.js';

export async function getSessionDataKey(
  workspaceId: string,
  tx?: Transaction,
): Promise<SessionDataKey | undefined> {
  const executor = tx ?? db();
  const rows = await executor
    .select()
    .from(sessionDataKeys)
    .where(eq(sessionDataKeys.workspaceId, workspaceId))
    .limit(1);
  const row = rows[0];
  return row ? toSessionDataKey(row) : undefined;
}

export async function insertSessionDataKeyIfAbsent(
  dataKey: {workspaceId: string; wrappedDek: string; kekVersion: string},
  tx?: Transaction,
): Promise<boolean> {
  const executor = tx ?? db();
  const rows = await executor
    .insert(sessionDataKeys)
    .values(dataKey)
    .onConflictDoNothing({
      target: sessionDataKeys.workspaceId,
    })
    .returning({workspaceId: sessionDataKeys.workspaceId});
  return rows.length > 0;
}
