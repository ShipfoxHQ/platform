import {eq} from 'drizzle-orm';
import type {ApiKey} from '#core/entities/api-key.js';
import type {Workspace} from '#core/entities/workspace.js';
import {db} from './db.js';
import {apiKeys, toApiKey} from './schema/api-keys.js';
import {toWorkspace, workspaces} from './schema/workspaces.js';

export interface ResolvedApiKey {
  apiKey: ApiKey;
  workspace: Workspace;
}

export async function resolveApiKeyWithWorkspace(
  hashedKey: string,
): Promise<ResolvedApiKey | undefined> {
  const rows = await db()
    .select()
    .from(apiKeys)
    .innerJoin(workspaces, eq(apiKeys.workspaceId, workspaces.id))
    .where(eq(apiKeys.hashedKey, hashedKey))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;

  return {
    apiKey: toApiKey(row.api_keys),
    workspace: toWorkspace(row.workspaces),
  };
}
