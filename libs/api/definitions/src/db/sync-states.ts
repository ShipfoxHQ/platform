import {and, desc, eq} from 'drizzle-orm';
import type {
  DefinitionSyncErrorCode,
  DefinitionSyncState,
  DefinitionSyncStatus,
  DefinitionSyncWarning,
} from '#core/entities/sync-state.js';
import {limitDefinitionSyncWarnings} from '#core/entities/sync-state.js';
import {db} from './db.js';
import {definitionSyncStates, toDefinitionSyncState} from './schema/sync-states.js';

export interface DefinitionSyncStateKey {
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  ref: string;
}

export interface MarkDefinitionSyncParams extends DefinitionSyncStateKey {
  status: DefinitionSyncStatus;
  lastErrorCode?: DefinitionSyncErrorCode | null | undefined;
  lastErrorMessage?: string | null | undefined;
  warnings?: readonly DefinitionSyncWarning[] | null | undefined;
  startedAt?: Date | null | undefined;
  finishedAt?: Date | null | undefined;
}

export async function markDefinitionSyncState(
  params: MarkDefinitionSyncParams,
): Promise<DefinitionSyncState> {
  const now = new Date();
  const warnings = limitDefinitionSyncWarnings(params.warnings ?? []);
  const [row] = await db()
    .insert(definitionSyncStates)
    .values({
      projectId: params.projectId,
      sourceConnectionId: params.sourceConnectionId,
      sourceExternalRepositoryId: params.sourceExternalRepositoryId,
      ref: params.ref,
      status: params.status,
      lastErrorCode: params.lastErrorCode ?? null,
      lastErrorMessage: params.lastErrorMessage ?? null,
      warnings,
      startedAt: params.startedAt ?? null,
      finishedAt: params.finishedAt ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        definitionSyncStates.projectId,
        definitionSyncStates.sourceConnectionId,
        definitionSyncStates.sourceExternalRepositoryId,
        definitionSyncStates.ref,
      ],
      set: {
        status: params.status,
        lastErrorCode: params.lastErrorCode ?? null,
        lastErrorMessage: params.lastErrorMessage ?? null,
        warnings,
        ...(params.startedAt !== undefined ? {startedAt: params.startedAt} : {}),
        ...(params.finishedAt !== undefined ? {finishedAt: params.finishedAt} : {}),
        updatedAt: now,
      },
    })
    .returning();

  if (!row) throw new Error('Definition sync state upsert returned no rows');
  return toDefinitionSyncState(row);
}

export async function getLatestDefinitionSyncState(params: {
  projectId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}): Promise<DefinitionSyncState | undefined> {
  const rows = await db()
    .select()
    .from(definitionSyncStates)
    .where(
      and(
        eq(definitionSyncStates.projectId, params.projectId),
        eq(definitionSyncStates.sourceConnectionId, params.sourceConnectionId),
        eq(definitionSyncStates.sourceExternalRepositoryId, params.sourceExternalRepositoryId),
      ),
    )
    .orderBy(desc(definitionSyncStates.updatedAt))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toDefinitionSyncState(row);
}
