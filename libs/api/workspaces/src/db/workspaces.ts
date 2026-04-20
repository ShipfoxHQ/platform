import {eq} from 'drizzle-orm';
import type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
import {db} from './db.js';
import {toWorkspace, workspaces} from './schema/workspaces.js';

export interface CreateWorkspaceParams {
  name: string;
}

export async function createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
  const rows = await db()
    .insert(workspaces)
    .values({
      name: params.name,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  return toWorkspace(row);
}

export interface UpdateWorkspaceParams {
  id: string;
  name?: string | undefined;
  status?: WorkspaceStatus | undefined;
  settings?: Record<string, unknown> | undefined;
}

export async function updateWorkspace(
  params: UpdateWorkspaceParams,
): Promise<Workspace | undefined> {
  const set: Record<string, unknown> = {updatedAt: new Date()};
  if (params.name !== undefined) set.name = params.name;
  if (params.status !== undefined) set.status = params.status;
  if (params.settings !== undefined) set.settings = params.settings;

  const rows = await db()
    .update(workspaces)
    .set(set)
    .where(eq(workspaces.id, params.id))
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toWorkspace(row);
}

export async function getWorkspaceById(id: string): Promise<Workspace | undefined> {
  const rows = await db().select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  const row = rows[0];
  if (!row) return undefined;
  return toWorkspace(row);
}
