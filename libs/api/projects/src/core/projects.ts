import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {
  PROJECT_CREATED,
  PROJECT_SOURCE_BOUND,
  PROJECT_UPDATED,
  type ProjectsEventMap,
} from '@shipfox/api-projects-dto';
import {isUniqueViolation} from '@shipfox/node-drizzle';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {updateProject} from '#db/projects.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects, toProject} from '#db/schema/projects.js';
import {recordProjectCreated} from '#metrics/instance.js';
import type {Project} from './entities/project.js';
import {
  ProjectAlreadyExistsError,
  ProjectNotFoundError,
  ProjectSlugConflictError,
} from './errors.js';

const PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT = 'projects_workspace_slug_unique';

export interface CreateProjectFromSourceParams {
  actorId: string;
  workspaceId: string;
  name: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  slug: string;
  integrations: IntegrationsModuleClient;
}

export async function createProjectFromSource(
  params: CreateProjectFromSourceParams,
): Promise<Project> {
  const source = await params.integrations.resolveSourceRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });

  const project = await db().transaction(async (tx) => {
    let projectRow: typeof projects.$inferSelect | undefined;
    for (let attempt = 0; attempt < 2 && !projectRow; attempt += 1) {
      try {
        [projectRow] = await tx
          .insert(projects)
          .values({
            workspaceId: params.workspaceId,
            sourceConnectionId: source.connection.id,
            sourceExternalRepositoryId: source.repository.externalRepositoryId,
            sourceRepositoryOwner: source.repository.owner,
            sourceRepositoryName: source.repository.name,
            sourceDefaultBranch: source.repository.defaultBranch,
            name: params.name,
            slug: params.slug,
          })
          .onConflictDoNothing({
            target: [projects.sourceConnectionId, projects.sourceExternalRepositoryId],
          })
          .returning();
      } catch (error) {
        if (isUniqueViolation(error, PROJECTS_WORKSPACE_SLUG_UNIQUE_CONSTRAINT)) {
          throw new ProjectSlugConflictError(params.slug);
        }
        throw error;
      }

      if (!projectRow) {
        const [existing] = await tx
          .select()
          .from(projects)
          .where(
            and(
              eq(projects.sourceConnectionId, source.connection.id),
              eq(projects.sourceExternalRepositoryId, source.repository.externalRepositoryId),
            ),
          )
          .limit(1);
        if (existing) {
          throw new ProjectAlreadyExistsError(
            existing.id,
            source.connection.id,
            source.repository.externalRepositoryId,
          );
        }
      }
    }

    if (!projectRow) {
      throw new Error('Project insert returned no rows');
    }

    const project = toProject(projectRow);

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_CREATED,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        slug: project.slug,
        sourceConnectionId: project.sourceConnectionId,
        sourceExternalRepositoryId: project.sourceExternalRepositoryId,
      },
    });
    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_SOURCE_BOUND,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        sourceConnectionId: project.sourceConnectionId,
        provider: source.connection.provider,
        externalRepositoryId: project.sourceExternalRepositoryId,
      },
    });

    return project;
  });
  recordProjectCreated();
  return project;
}

export interface UpdateProjectDetailsParams {
  actorId: string;
  projectId: string;
  name?: string | undefined;
  slug?: string | undefined;
}

export function updateProjectDetails(params: UpdateProjectDetailsParams): Promise<Project> {
  return db().transaction(async (tx) => {
    const update = await updateProject(
      {projectId: params.projectId, name: params.name, slug: params.slug},
      {tx},
    );
    if (!update) throw new ProjectNotFoundError(params.projectId);
    if (!update.changed) return update.project;

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_UPDATED,
      payload: {
        actorId: params.actorId,
        workspaceId: update.project.workspaceId,
        projectId: update.project.id,
        name: update.project.name,
        slug: update.project.slug,
      },
    });

    return update.project;
  });
}
