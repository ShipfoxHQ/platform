import {and, count, desc, eq, ilike, inArray, lt, or, type SQL, sql} from 'drizzle-orm';
import type {Project} from '#core/entities/project.js';
import {ProjectAlreadyExistsError, ProjectNotFoundError} from '#core/errors.js';
import {recordProjectCreated} from '#metrics/instance.js';
import {db, type Executor} from './db.js';
import {projects, toProject} from './schema/projects.js';

export interface CreateProjectParams {
  workspaceId: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  name: string;
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

function cursorWhere(cursor: ProjectCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;
  return or(
    lt(projects.createdAt, cursor.createdAt),
    and(eq(projects.createdAt, cursor.createdAt), lt(projects.id, cursor.id)),
  );
}

export async function createProject(params: CreateProjectParams): Promise<Project> {
  const project = await db().transaction(async (tx) => {
    const [projectRow] = await tx
      .insert(projects)
      .values({
        workspaceId: params.workspaceId,
        sourceConnectionId: params.sourceConnectionId,
        sourceExternalRepositoryId: params.sourceExternalRepositoryId,
        name: params.name,
      })
      .onConflictDoNothing({
        target: [projects.sourceConnectionId, projects.sourceExternalRepositoryId],
      })
      .returning();

    if (!projectRow) {
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
      throw new Error('Insert returned no rows');
    }

    return toProject(projectRow);
  });
  recordProjectCreated();
  return project;
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
  defaults: {
    connectionId: string;
    owner: string;
  };
  target: {project: string} | {connection?: string | undefined; repository: string};
}

export interface ResolvedCheckoutTarget {
  projectId: string;
  connectionId: string;
  externalRepositoryId: string;
}

export async function resolveCheckoutTarget(
  params: ResolveCheckoutTargetParams,
): Promise<ResolvedCheckoutTarget | undefined> {
  const selection = {
    projectId: projects.id,
    connectionId: projects.sourceConnectionId,
    externalRepositoryId: projects.sourceExternalRepositoryId,
  };

  if ('project' in params.target) {
    const [project] = await db()
      .select(selection)
      .from(projects)
      .where(
        and(eq(projects.workspaceId, params.workspaceId), eq(projects.id, params.target.project)),
      )
      .limit(1);
    return project;
  }

  const separator = params.target.repository.indexOf('/');
  if (separator === 0 || separator === params.target.repository.length - 1) return undefined;

  const repository =
    separator === -1
      ? {
          connectionId: params.target.connection ?? params.defaults.connectionId,
          owner: params.defaults.owner,
          name: params.target.repository,
        }
      : params.target.repository.indexOf('/', separator + 1) === -1
        ? {
            connectionId: params.target.connection ?? params.defaults.connectionId,
            owner: params.target.repository.slice(0, separator),
            name: params.target.repository.slice(separator + 1),
          }
        : undefined;
  if (repository === undefined) return undefined;

  const matches = await db()
    .select(selection)
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, params.workspaceId),
        eq(projects.sourceConnectionId, repository.connectionId),
        sql`lower(${projects.sourceRepositoryOwner}) = lower(${repository.owner})`,
        sql`lower(${projects.sourceRepositoryName}) = lower(${repository.name})`,
      ),
    )
    .limit(2);

  // Owner/name isn't a unique key: renamed or reconnected repositories can leave
  // more than one project row matching. Fail closed instead of picking arbitrarily.
  return matches.length === 1 ? matches[0] : undefined;
}

export async function listProjects(params: ListProjectsParams): Promise<ListProjectsResult> {
  const conditions = [eq(projects.workspaceId, params.workspaceId)];
  const cursorCondition = cursorWhere(params.cursor);
  if (cursorCondition) conditions.push(cursorCondition);
  if (params.search) {
    conditions.push(ilike(projects.name, `%${escapeIlikePattern(params.search)}%`));
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
