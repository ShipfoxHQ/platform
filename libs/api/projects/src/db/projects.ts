import {isUniqueViolation} from '@shipfox/node-drizzle';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  lt,
  or,
  type SQL,
  sql,
} from 'drizzle-orm';
import type {Project} from '#core/entities/project.js';
import {
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from '#core/errors.js';
import {recordProjectCreated} from '#metrics/instance.js';
import {db, type Executor} from './db.js';
import {projects, toProject} from './schema/projects.js';

type ProjectDatabase = ReturnType<typeof db>;
type ProjectTransaction = Parameters<Parameters<ProjectDatabase['transaction']>[0]>[0];

export interface CreateProjectParams {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  name: string;
  slug: string;
}

export interface UpdateProjectParams {
  projectId: string;
  name?: string | undefined;
  slug?: string | undefined;
}

export interface UpdateProjectResult {
  project: Project;
  changed: boolean;
}

export interface ProjectCursor {
  createdAt: Date;
  id: string;
}

export interface ListProjectsParams {
  workspaceId: string;
  limit: number;
  cursor?: ProjectCursor | undefined;
  search?: string | undefined;
}

function escapeIlikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export interface ListProjectsResult {
  projects: Project[];
  nextCursor: ProjectCursor | null;
}

export type AdminProjectSummary = Pick<
  Project,
  'id' | 'workspaceId' | 'name' | 'createdAt' | 'updatedAt'
>;

export interface ListAdminProjectsParams {
  limit: number;
  cursor?: ProjectCursor | undefined;
  projectId?: string | undefined;
  search?: string | undefined;
}

export interface ListAdminProjectsResult {
  projects: AdminProjectSummary[];
  nextCursor: ProjectCursor | null;
}

const PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT = 'projects_workspace_slug_unique';

function cursorWhere(cursor: ProjectCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(projects.createdAt, cursor.createdAt),
    and(eq(projects.createdAt, cursor.createdAt), lt(projects.id, cursor.id)),
  );
}

export async function createProject(params: CreateProjectParams): Promise<Project> {
  const project = await db().transaction(async (tx) => {
    let projectRow: typeof projects.$inferSelect | undefined;
    for (let attempt = 0; attempt < 2 && !projectRow; attempt += 1) {
      try {
        [projectRow] = await tx
          .insert(projects)
          .values({
            workspaceId: params.workspaceId,
            sourceConnectionId: params.sourceConnectionId,
            sourceExternalRepositoryId: params.sourceExternalRepositoryId,
            name: params.name,
            slug: params.slug,
          })
          .onConflictDoNothing({
            target: [projects.sourceConnectionId, projects.sourceExternalRepositoryId],
          })
          .returning();
      } catch (error) {
        throw mapProjectInsertError(error, params.slug);
      }

      if (!projectRow) await assertSourceProjectDoesNotExist(tx, params);
    }

    if (!projectRow) {
      throw new Error('Insert returned no rows');
    }

    return toProject(projectRow);
  });
  recordProjectCreated();
  return project;
}

function mapProjectInsertError(error: unknown, slug: string): unknown {
  if (isUniqueViolation(error, PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT)) {
    return new ProjectSlugConflictError(slug);
  }
  return error;
}

async function assertSourceProjectDoesNotExist(
  tx: ProjectTransaction,
  params: Pick<CreateProjectParams, 'sourceConnectionId' | 'sourceExternalRepositoryId'>,
): Promise<void> {
  const [conflict] = await tx
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.sourceConnectionId, params.sourceConnectionId),
        eq(projects.sourceExternalRepositoryId, params.sourceExternalRepositoryId),
      ),
    )
    .limit(1);
  if (conflict) {
    throw new ProjectAlreadyExistsError(
      conflict.id,
      params.sourceConnectionId,
      params.sourceExternalRepositoryId,
    );
  }
}

export async function updateProject(
  params: UpdateProjectParams,
  options: {tx?: ProjectDatabase | ProjectTransaction | undefined} = {},
): Promise<UpdateProjectResult | undefined> {
  const executor = options.tx ?? db();

  const [existingRow] = await executor
    .select()
    .from(projects)
    .where(eq(projects.id, params.projectId))
    .limit(1);
  if (!existingRow) return undefined;

  const nextName = params.name ?? existingRow.name;
  const nextSlug = params.slug ?? existingRow.slug;
  if (nextName === existingRow.name && nextSlug === existingRow.slug) {
    return {project: toProject(existingRow), changed: false};
  }

  try {
    const [row] = await executor
      .update(projects)
      .set({
        ...(params.name !== undefined ? {name: params.name} : {}),
        ...(params.slug !== undefined ? {slug: params.slug} : {}),
        updatedAt: new Date(),
      })
      .where(eq(projects.id, params.projectId))
      .returning();

    return row ? {project: toProject(row), changed: true} : undefined;
  } catch (error) {
    if (isUniqueViolation(error, PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT)) {
      throw new ProjectSlugConflictError(nextSlug);
    }
    throw error;
  }
}

export async function getProjectById(id: string): Promise<Project | undefined> {
  const rows = await db().select().from(projects).where(eq(projects.id, id)).limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toProject(row);
}

export interface GetProjectBySourceParams {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
}

export async function getProjectBySource(
  params: GetProjectBySourceParams,
): Promise<Project | undefined> {
  const rows = await db()
    .select()
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, params.workspaceId),
        eq(projects.sourceConnectionId, params.sourceConnectionId),
        eq(projects.sourceExternalRepositoryId, params.sourceExternalRepositoryId),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toProject(row);
}

function whereSourceRepositoryMatches(params: {
  workspaceId: string;
  sourceConnectionId: string;
  sourceRepositoryOwner: string;
  sourceRepositoryName: string;
}): SQL | undefined {
  return and(
    eq(projects.workspaceId, params.workspaceId),
    eq(projects.sourceConnectionId, params.sourceConnectionId),
    sql`lower(${projects.sourceRepositoryOwner}) = lower(${params.sourceRepositoryOwner})`,
    sql`lower(${projects.sourceRepositoryName}) = lower(${params.sourceRepositoryName})`,
  );
}

export interface FindProjectBySourceRepositoryNameParams {
  workspaceId: string;
  sourceConnectionId: string;
  sourceRepositoryOwner: string;
  sourceRepositoryName: string;
}

export async function findProjectBySourceRepositoryName(
  params: FindProjectBySourceRepositoryNameParams,
): Promise<Project[]> {
  const rows = await db()
    .select()
    .from(projects)
    .where(whereSourceRepositoryMatches(params))
    .orderBy(projects.createdAt, projects.id);

  return rows.map(toProject);
}

export interface ProjectRepositoryListItem {
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner: string;
  sourceRepositoryName: string;
  projectId: string;
  projectName: string;
  projectSlug: string;
}

export interface ProjectRepositoryListCursor {
  sourceRepositoryOwner: string;
  sourceRepositoryName: string;
  sourceExternalRepositoryId: string;
}

export interface ListProjectsBySourceConnectionParams {
  workspaceId: string;
  sourceConnectionId: string;
  limit: number;
  cursor?: ProjectRepositoryListCursor | undefined;
}

export interface ListProjectsBySourceConnectionResult {
  projects: ProjectRepositoryListItem[];
  nextCursor: ProjectRepositoryListCursor | null;
}

function projectSourceRepositoryCursorWhere(
  cursor: ProjectRepositoryListCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined;

  return or(
    sql`lower(${projects.sourceRepositoryOwner}) > lower(${cursor.sourceRepositoryOwner})`,
    and(
      sql`lower(${projects.sourceRepositoryOwner}) = lower(${cursor.sourceRepositoryOwner})`,
      sql`lower(${projects.sourceRepositoryName}) > lower(${cursor.sourceRepositoryName})`,
    ),
    and(
      sql`lower(${projects.sourceRepositoryOwner}) = lower(${cursor.sourceRepositoryOwner})`,
      sql`lower(${projects.sourceRepositoryName}) = lower(${cursor.sourceRepositoryName})`,
      gt(projects.sourceExternalRepositoryId, cursor.sourceExternalRepositoryId),
    ),
  );
}

export async function listProjectsBySourceConnection(
  params: ListProjectsBySourceConnectionParams,
): Promise<ListProjectsBySourceConnectionResult> {
  const conditions = [
    eq(projects.workspaceId, params.workspaceId),
    eq(projects.sourceConnectionId, params.sourceConnectionId),
    and(isNotNull(projects.sourceRepositoryOwner), sql`${projects.sourceRepositoryOwner} <> ''`),
    and(isNotNull(projects.sourceRepositoryName), sql`${projects.sourceRepositoryName} <> ''`),
  ];
  const cursorCondition = projectSourceRepositoryCursorWhere(params.cursor);
  if (cursorCondition) conditions.push(cursorCondition);

  const rows = await db()
    .select({
      sourceExternalRepositoryId: projects.sourceExternalRepositoryId,
      sourceRepositoryOwner: projects.sourceRepositoryOwner,
      sourceRepositoryName: projects.sourceRepositoryName,
      projectId: projects.id,
      projectName: projects.name,
      projectSlug: projects.slug,
    })
    .from(projects)
    .where(and(...conditions))
    .orderBy(
      asc(sql`lower(${projects.sourceRepositoryOwner})`),
      asc(sql`lower(${projects.sourceRepositoryName})`),
      asc(projects.sourceExternalRepositoryId),
    )
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const projectRepositories = pageRows.map(toProjectRepositoryListItem);
  const last = projectRepositories.at(-1);

  return {
    projects: projectRepositories,
    nextCursor:
      hasMore && last
        ? {
            sourceRepositoryOwner: last.sourceRepositoryOwner,
            sourceRepositoryName: last.sourceRepositoryName,
            sourceExternalRepositoryId: last.sourceExternalRepositoryId,
          }
        : null,
  };
}

function toProjectRepositoryListItem(row: {
  sourceExternalRepositoryId: string;
  sourceRepositoryOwner: string | null;
  sourceRepositoryName: string | null;
  projectId: string;
  projectName: string;
  projectSlug: string;
}): ProjectRepositoryListItem {
  if (row.sourceRepositoryOwner === null || row.sourceRepositoryName === null) {
    throw new Error('Project source repository metadata is missing');
  }

  return {
    sourceExternalRepositoryId: row.sourceExternalRepositoryId,
    sourceRepositoryOwner: row.sourceRepositoryOwner,
    sourceRepositoryName: row.sourceRepositoryName,
    projectId: row.projectId,
    projectName: row.projectName,
    projectSlug: row.projectSlug,
  };
}

export interface UpdateProjectSourceRepositoryParams extends GetProjectBySourceParams {
  tx?: Executor;
  sourceRepositoryOwner: string;
  sourceRepositoryName: string;
  sourceDefaultBranch: string;
}

export async function updateProjectSourceRepository(
  params: UpdateProjectSourceRepositoryParams,
): Promise<Project | undefined> {
  const executor = params.tx ?? db();
  const rows = await executor
    .update(projects)
    .set({
      sourceRepositoryOwner: params.sourceRepositoryOwner,
      sourceRepositoryName: params.sourceRepositoryName,
      sourceDefaultBranch: params.sourceDefaultBranch,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(projects.workspaceId, params.workspaceId),
        eq(projects.sourceConnectionId, params.sourceConnectionId),
        eq(projects.sourceExternalRepositoryId, params.sourceExternalRepositoryId),
      ),
    )
    .returning();

  const row = rows[0];
  if (!row) return undefined;
  return toProject(row);
}

export async function requireProjectForWorkspace(params: {
  projectId: string;
  workspaceId: string;
}): Promise<Project> {
  const project = await getProjectById(params.projectId);
  if (!project) throw new ProjectNotFoundError(params.projectId);
  if (project.workspaceId !== params.workspaceId) throw new ProjectNotFoundError(params.projectId);
  return project;
}

export interface ResolveCheckoutTargetParams {
  workspaceId: string;
  target: {project: string};
}

export interface ResolvedCheckoutTarget {
  projectId: string;
  connectionId: string;
  target: {kind: 'external-id'; externalRepositoryId: string};
}

export async function resolveCheckoutTarget(
  params: ResolveCheckoutTargetParams,
): Promise<ResolvedCheckoutTarget | undefined> {
  const [project] = await db()
    .select({
      projectId: projects.id,
      connectionId: projects.sourceConnectionId,
      externalRepositoryId: projects.sourceExternalRepositoryId,
    })
    .from(projects)
    .where(
      and(eq(projects.workspaceId, params.workspaceId), eq(projects.id, params.target.project)),
    )
    .limit(1);
  return project === undefined
    ? undefined
    : {
        projectId: project.projectId,
        connectionId: project.connectionId,
        target: {kind: 'external-id', externalRepositoryId: project.externalRepositoryId},
      };
}

export async function listProjects(params: ListProjectsParams): Promise<ListProjectsResult> {
  const conditions = [eq(projects.workspaceId, params.workspaceId)];
  const cursorCondition = cursorWhere(params.cursor);
  if (cursorCondition) conditions.push(cursorCondition);
  if (params.search) {
    const searchPattern = `%${escapeIlikePattern(params.search)}%`;
    conditions.push(
      or(ilike(projects.name, searchPattern), ilike(projects.slug, searchPattern)) as SQL,
    );
  }

  const rows = await db()
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.createdAt), desc(projects.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    projects: pageRows.map(toProject),
    nextCursor: hasMore && last ? {createdAt: last.createdAt, id: last.id} : null,
  };
}

export async function listAdminProjects(
  params: ListAdminProjectsParams,
): Promise<ListAdminProjectsResult> {
  const conditions: SQL[] = [];
  const cursorCondition = cursorWhere(params.cursor);
  if (cursorCondition) conditions.push(cursorCondition);
  if (params.projectId) conditions.push(eq(projects.id, params.projectId));
  if (params.search) {
    conditions.push(ilike(projects.name, `%${escapeIlikePattern(params.search)}%`));
  }

  const rows = await db()
    .select({
      id: projects.id,
      workspaceId: projects.workspaceId,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(projects.createdAt), desc(projects.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    projects: pageRows,
    nextCursor: hasMore && last ? {createdAt: last.createdAt, id: last.id} : null,
  };
}

export async function getProjectCount(): Promise<number> {
  const [row] = await db().select({value: count()}).from(projects);
  return row?.value ?? 0;
}

export async function getWorkspaceProjectCounts(params: {
  workspaceIds: string[];
}): Promise<Array<{workspaceId: string; count: number}>> {
  const rows = await db()
    .select({workspaceId: projects.workspaceId, count: count()})
    .from(projects)
    .where(inArray(projects.workspaceId, params.workspaceIds))
    .groupBy(projects.workspaceId);

  const countsByWorkspace = new Map(rows.map((row) => [row.workspaceId, Number(row.count)]));
  return params.workspaceIds.map((workspaceId) => ({
    workspaceId,
    count: countsByWorkspace.get(workspaceId) ?? 0,
  }));
}
