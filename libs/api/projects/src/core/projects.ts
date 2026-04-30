import type {IntegrationSourceControlService} from '@shipfox/api-integration-core';
import {
  PROJECT_CREATED,
  PROJECT_SOURCE_BOUND,
  type ProjectsEventMap,
} from '@shipfox/api-projects-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq} from 'drizzle-orm';
import {db} from '#db/db.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects, toProject} from '#db/schema/projects.js';
import type {Project} from './entities/project.js';
import {ProjectAlreadyExistsError} from './errors.js';

export interface CreateProjectFromSourceParams {
  actorId: string;
  workspaceId: string;
  name: string;
  sourceConnectionId: string;
  sourceExternalRepositoryId: string;
  sourceControl: IntegrationSourceControlService;
}

export async function createProjectFromSource(
  params: CreateProjectFromSourceParams,
): Promise<Project> {
  const source = await params.sourceControl.resolveRepository({
    workspaceId: params.workspaceId,
    connectionId: params.sourceConnectionId,
    externalRepositoryId: params.sourceExternalRepositoryId,
  });

  return await db().transaction(async (tx) => {
    const [projectRow] = await tx
      .insert(projects)
      .values({
        workspaceId: params.workspaceId,
        sourceConnectionId: source.connection.id,
        sourceExternalRepositoryId: source.repository.externalRepositoryId,
        name: params.name,
      })
      .onConflictDoNothing({
        target: [projects.sourceConnectionId, projects.sourceExternalRepositoryId],
      })
      .returning();

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
      throw new Error('Project insert returned no rows');
    }

    const project = toProject(projectRow);

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_CREATED,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
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
}
