import type {StringIdCursor} from '@shipfox/node-drizzle';
import {and, asc, count, eq, gt, ilike, inArray, isNull, or, type SQL, sql} from 'drizzle-orm';
import type {Workspace, WorkspaceStatus} from '#core/entities/workspace.js';
import {recordWorkspaceCreated} from '#metrics/instance.js';
import {db} from './db.js';
import {invitations} from './schema/invitations.js';
import {memberships} from './schema/memberships.js';
import {toWorkspace, workspaces} from './schema/workspaces.js';

export interface CreateWorkspaceParams {
  name: string;
  /** Existing database-only fixtures predate the required API slug. */
  slug?: string | undefined;
}

export async function createWorkspace(params: CreateWorkspaceParams): Promise<Workspace> {
  const rows = await db()
    .insert(workspaces)
    .values({
      name: params.name,
      slug: params.slug ?? `workspace-${crypto.randomUUID().slice(0, 8)}`,
    })
    .returning();

  const row = rows[0];
  if (!row) throw new Error('Insert returned no rows');
  recordWorkspaceCreated();
  return toWorkspace(row);
}

export interface UpdateWorkspaceParams {
  id: string;
  name?: string | undefined;
  slug?: string | undefined;
  status?: WorkspaceStatus | undefined;
  settings?: Record<string, unknown> | undefined;
}

type WorkspaceDatabase = ReturnType<typeof db>;
type WorkspaceTransaction = Parameters<Parameters<WorkspaceDatabase['transaction']>[0]>[0];

export async function updateWorkspace(
  params: UpdateWorkspaceParams,
  options: {tx?: WorkspaceDatabase | WorkspaceTransaction | undefined} = {},
): Promise<Workspace | undefined> {
  const executor = options.tx ?? db();
  const set: Record<string, unknown> = {updatedAt: sql`NOW()`};
  if (params.name !== undefined) set.name = params.name;
  if (params.slug !== undefined) set.slug = params.slug;
  if (params.status !== undefined) set.status = params.status;
  if (params.settings !== undefined) set.settings = params.settings;

  const rows = await executor
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

export async function isWorkspaceSlugAvailable(slug: string): Promise<boolean> {
  const rows = await db()
    .select({id: workspaces.id})
    .from(workspaces)
    .where(eq(workspaces.slug, slug))
    .limit(1);

  return rows.length === 0;
}

export interface AdminWorkspaceRow extends Workspace {
  memberCount: number;
}

export interface ListAdminWorkspaceParams {
  workspaceId?: string | undefined;
  search?: string | undefined;
  status?: WorkspaceStatus | undefined;
  limit: number;
  cursor?: StringIdCursor | undefined;
}

export interface ListAdminWorkspaceResult {
  workspaces: AdminWorkspaceRow[];
  nextCursor: StringIdCursor | null;
}

function adminWorkspaceCursorWhere(cursor: StringIdCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    gt(workspaces.name, cursor.value),
    and(eq(workspaces.name, cursor.value), gt(workspaces.id, cursor.id)),
  );
}

export async function listAdminWorkspaces(
  params: ListAdminWorkspaceParams,
): Promise<ListAdminWorkspaceResult> {
  const conditions = [] as SQL[];
  if (params.workspaceId) conditions.push(eq(workspaces.id, params.workspaceId));
  if (params.search) {
    conditions.push(ilike(workspaces.name, `%${escapeIlikePattern(params.search)}%`));
  }
  if (params.status) conditions.push(eq(workspaces.status, params.status));
  const cursor = adminWorkspaceCursorWhere(params.cursor);
  if (cursor) conditions.push(cursor);

  const rows = await db()
    .select({workspace: workspaces})
    .from(workspaces)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(workspaces.name), asc(workspaces.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);
  const workspaceIds = pageRows.map((row) => row.workspace.id);
  const memberCountRows =
    workspaceIds.length > 0
      ? await db()
          .select({workspaceId: memberships.workspaceId, memberCount: count(memberships.id)})
          .from(memberships)
          .where(inArray(memberships.workspaceId, workspaceIds))
          .groupBy(memberships.workspaceId)
      : [];
  const memberCounts = new Map(
    memberCountRows.map((row) => [row.workspaceId, Number(row.memberCount)]),
  );

  return {
    workspaces: pageRows.map((row) => ({
      ...toWorkspace(row.workspace),
      memberCount: memberCounts.get(row.workspace.id) ?? 0,
    })),
    nextCursor: hasMore && last ? {value: last.workspace.name, id: last.workspace.id} : null,
  };
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface WorkspaceServiceMetrics {
  activeWorkspaces: number;
  memberships: number;
  openInvitations: number;
}

export async function getWorkspaceServiceMetrics(): Promise<WorkspaceServiceMetrics> {
  const [workspaceRows, membershipRows, invitationRows] = await Promise.all([
    db().select({value: count()}).from(workspaces).where(eq(workspaces.status, 'active')),
    db().select({value: count()}).from(memberships),
    db()
      .select({value: count()})
      .from(invitations)
      .where(and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, sql`now()`))),
  ]);

  return {
    activeWorkspaces: workspaceRows[0]?.value ?? 0,
    memberships: membershipRows[0]?.value ?? 0,
    openInvitations: invitationRows[0]?.value ?? 0,
  };
}
