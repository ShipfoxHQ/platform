import {asc, eq} from 'drizzle-orm';
import type {ApiKey} from '#core/entities/api-key.js';
import {db} from './db.js';
import {apiKeys, toApiKey} from './schema/api-keys.js';

export interface CreateApiKeyParams {
  workspaceId: string;
  hashedKey: string;
  prefix: string;
  scopes: string[];
  expiresAt?: Date | undefined;
}

export async function createApiKey(params: CreateApiKeyParams): Promise<ApiKey> {
  const rows = await db()
    .insert(apiKeys)
    .values({
      workspaceId: params.workspaceId,
      hashedKey: params.hashedKey,
      prefix: params.prefix,
      scopes: params.scopes,
      expiresAt: params.expiresAt ?? null,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toApiKey(row);
}

export async function revokeApiKey(id: string): Promise<ApiKey | undefined> {
  const rows = await db()
    .update(apiKeys)
    .set({revokedAt: new Date(), updatedAt: new Date()})
    .where(eq(apiKeys.id, id))
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toApiKey(row);
}

export async function getApiKeyById(id: string): Promise<ApiKey | undefined> {
  const rows = await db().select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toApiKey(row);
}

export async function getApiKeyByHashedKey(hashedKey: string): Promise<ApiKey | undefined> {
  const rows = await db().select().from(apiKeys).where(eq(apiKeys.hashedKey, hashedKey)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toApiKey(row);
}

export async function listApiKeysByWorkspaceId(workspaceId: string): Promise<ApiKey[]> {
  const rows = await db()
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.workspaceId, workspaceId))
    .orderBy(asc(apiKeys.createdAt));

  return rows.map(toApiKey);
}
