import {and, eq, gt, inArray, notInArray, type SQL, sql} from 'drizzle-orm';
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

export async function updateSessionDataKeyWrapCas(
  params: {workspaceId: string; oldKekVersion: string; wrappedDek: string; kekVersion: string},
  tx?: Transaction,
): Promise<boolean> {
  const executor = tx ?? db();
  const rows = await executor
    .update(sessionDataKeys)
    .set({
      wrappedDek: params.wrappedDek,
      kekVersion: params.kekVersion,
      rotatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(sessionDataKeys.workspaceId, params.workspaceId),
        eq(sessionDataKeys.kekVersion, params.oldKekVersion),
      ),
    )
    .returning({workspaceId: sessionDataKeys.workspaceId});
  return rows.length > 0;
}

export async function listSessionDataKeyVersions(
  knownVersions: string[],
  params: {workspaceIds?: string[] | undefined} = {},
): Promise<string[]> {
  if (params.workspaceIds?.length === 0) return [];

  const filters: SQL[] = [];
  if (knownVersions.length > 0) filters.push(notInArray(sessionDataKeys.kekVersion, knownVersions));
  if (params.workspaceIds) filters.push(inArray(sessionDataKeys.workspaceId, params.workspaceIds));
  const rows = await db()
    .selectDistinct({kekVersion: sessionDataKeys.kekVersion})
    .from(sessionDataKeys)
    .where(filters.length > 0 ? and(...filters) : undefined);
  return rows.map((row) => row.kekVersion);
}

export async function listSessionDataKeysPage(params: {
  afterWorkspaceId?: string | undefined;
  limit: number;
  workspaceIds?: string[] | undefined;
}): Promise<SessionDataKey[]> {
  if (params.workspaceIds?.length === 0) return [];

  const filters: SQL[] = [];
  if (params.afterWorkspaceId) {
    filters.push(gt(sessionDataKeys.workspaceId, params.afterWorkspaceId));
  }
  if (params.workspaceIds) filters.push(inArray(sessionDataKeys.workspaceId, params.workspaceIds));
  const rows = await db()
    .select()
    .from(sessionDataKeys)
    .where(filters.length > 0 ? and(...filters) : undefined)
    .orderBy(sessionDataKeys.workspaceId)
    .limit(params.limit);
  return rows.map(toSessionDataKey);
}
