import {and, desc, eq, lt, or, type SQL} from 'drizzle-orm';
import type {ProjectWithRepository} from '#core/entities/project.js';
import {ProjectAlreadyExistsError, ProjectNotFoundError} from '#core/errors.js';
import {db} from './db.js';
import {projects, toProject} from './schema/projects.js';
import {repositories, toRepository} from './schema/repositories.js';

export interface CreateProjectParams {
  workspaceId: string;
  repositoryId: string;
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
}

export interface ListProjectsResult {
  projects: ProjectWithRepository[];
  nextCursor: ProjectCursor | null;
}

function toProjectWithRepository(row: {
  project: typeof projects.$inferSelect;
  repository: typeof repositories.$inferSelect;
}): ProjectWithRepository {
  return {
    ...toProject(row.project),
    repository: toRepository(row.repository),
  };
}

function cursorWhere(params: ListProjectsParams): SQL | undefined {
  if (!params.cursor) return undefined;
  return or(
    lt(projects.createdAt, params.cursor.createdAt),
    and(eq(projects.createdAt, params.cursor.createdAt), lt(projects.id, params.cursor.id)),
  );
}

export async function createProject(params: CreateProjectParams): Promise<ProjectWithRepository> {
  return await db().transaction(async (tx) => {
    const existing = await tx
      .select({project: projects, repository: repositories})
      .from(projects)
      .innerJoin(repositories, eq(repositories.id, projects.repositoryId))
      .where(
        and(
          eq(projects.workspaceId, params.workspaceId),
          eq(projects.repositoryId, params.repositoryId),
        ),
      )
      .limit(1);

    const existingRow = existing[0];
    if (existingRow) {
      throw new ProjectAlreadyExistsError(existingRow.project.id, params.repositoryId);
    }

    const [projectRow] = await tx
      .insert(projects)
      .values({
        workspaceId: params.workspaceId,
        repositoryId: params.repositoryId,
        name: params.name,
      })
      .onConflictDoNothing({
        target: [projects.workspaceId, projects.repositoryId],
      })
      .returning();
    if (!projectRow) {
      const [conflict] = await tx
        .select({project: projects})
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, params.workspaceId),
            eq(projects.repositoryId, params.repositoryId),
          ),
        )
        .limit(1);
      if (conflict) throw new ProjectAlreadyExistsError(conflict.project.id, params.repositoryId);
      throw new Error('Insert returned no rows');
    }

    const [row] = await tx
      .select({project: projects, repository: repositories})
      .from(projects)
      .innerJoin(repositories, eq(repositories.id, projects.repositoryId))
      .where(eq(projects.id, projectRow.id))
      .limit(1);
    if (!row) throw new Error('Inserted project could not be loaded');
    return toProjectWithRepository(row);
  });
}

export async function getProjectById(id: string): Promise<ProjectWithRepository | undefined> {
  const rows = await db()
    .select({project: projects, repository: repositories})
    .from(projects)
    .innerJoin(repositories, eq(repositories.id, projects.repositoryId))
    .where(eq(projects.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return undefined;
  return toProjectWithRepository(row);
}

export async function requireProjectForWorkspace(params: {
  projectId: string;
  workspaceId: string;
}): Promise<ProjectWithRepository> {
  const project = await getProjectById(params.projectId);
  if (!project) throw new ProjectNotFoundError(params.projectId);
  if (project.workspaceId !== params.workspaceId) throw new ProjectNotFoundError(params.projectId);
  return project;
}

export async function listProjects(params: ListProjectsParams): Promise<ListProjectsResult> {
  const conditions = [eq(projects.workspaceId, params.workspaceId)];
  const cursorCondition = cursorWhere(params);
  if (cursorCondition) conditions.push(cursorCondition);

  const rows = await db()
    .select({project: projects, repository: repositories})
    .from(projects)
    .innerJoin(repositories, eq(repositories.id, projects.repositoryId))
    .where(and(...conditions))
    .orderBy(desc(projects.createdAt), desc(projects.id))
    .limit(params.limit + 1);

  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1)?.project;

  return {
    projects: pageRows.map(toProjectWithRepository),
    nextCursor: hasMore && last ? {createdAt: last.createdAt, id: last.id} : null,
  };
}
