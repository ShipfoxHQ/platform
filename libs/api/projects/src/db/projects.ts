import {and, count, desc, eq, ilike, inArray, lt, or, type SQL} from 'drizzle-orm';
import type {Project} from '#core/entities/project.js';
import {ProjectAlreadyExistsError, ProjectNotFoundError} from '#core/errors.js';
import {recordProjectCreated} from '#metrics/instance.js';
import {db} from './db.js';
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

function cursorWhere(params: ListProjectsParams): SQL | undefined {
  if (!params.cursor) return undefined;
  return or(
    lt(projects.createdAt, params.cursor.createdAt),
    and(eq(projects.createdAt, params.cursor.createdAt), lt(projects.id, params.cursor.id)),
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

export async function requireProjectForWorkspace(params: {
  projectId: string;
  workspaceId: string;
}): Promise<Project> {
  const project = await getProjectById(params.projectId);
  if (!project) throw new ProjectNotFoundError(params.projectId);
  if (project.workspaceId !== params.workspaceId) throw new ProjectNotFoundError(params.projectId);
  return project;
}

export async function listProjects(params: ListProjectsParams): Promise<ListProjectsResult> {
  const conditions = [eq(projects.workspaceId, params.workspaceId)];
  const cursorCondition = cursorWhere(params);
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
