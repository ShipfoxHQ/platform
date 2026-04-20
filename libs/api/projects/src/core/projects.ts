import {PROJECT_CREATED, PROJECT_VCS_BOUND, type ProjectsEventMap} from '@shipfox/api-projects-dto';
import {writeOutboxEvent} from '@shipfox/node-outbox';
import {and, eq} from 'drizzle-orm';
import {db, getVcsConnectionById} from '#db/index.js';
import {projectsOutbox} from '#db/schema/outbox.js';
import {projects, toProject} from '#db/schema/projects.js';
import {repositories, toRepository} from '#db/schema/repositories.js';
import {config} from '../config.js';
import type {ProjectWithRepository} from './entities/project.js';
import {
  ProjectAccessDeniedError,
  ProjectAlreadyExistsError,
  TestVcsProviderDisabledError,
  VcsConnectionNotFoundError,
} from './errors.js';
import {vcsProviderRegistry} from './providers/registry.js';

export interface CreateProjectFromRepositoryParams {
  actorId: string;
  workspaceId: string;
  name: string;
  vcsConnectionId: string;
  externalRepositoryId: string;
}

export async function createProjectFromRepository(
  params: CreateProjectFromRepositoryParams,
): Promise<ProjectWithRepository> {
  const connection = await getVcsConnectionById(params.vcsConnectionId);
  if (!connection) throw new VcsConnectionNotFoundError(params.vcsConnectionId);
  if (connection.workspaceId !== params.workspaceId) {
    throw new ProjectAccessDeniedError(params.vcsConnectionId);
  }
  if (connection.provider === 'test' && !config.PROJECTS_ENABLE_TEST_VCS_PROVIDER) {
    throw new TestVcsProviderDisabledError();
  }

  const provider = vcsProviderRegistry().get(connection.provider);
  const snapshot = await provider.resolveRepository({
    connection,
    externalRepositoryId: params.externalRepositoryId,
  });

  return await db().transaction(async (tx) => {
    const now = new Date();
    const [repositoryRow] = await tx
      .insert(repositories)
      .values({
        ...snapshot,
        vcsConnectionId: connection.id,
        metadataFetchedAt: now,
      })
      .onConflictDoUpdate({
        target: [repositories.vcsConnectionId, repositories.externalRepositoryId],
        set: {
          owner: snapshot.owner,
          name: snapshot.name,
          fullName: snapshot.fullName,
          defaultBranch: snapshot.defaultBranch,
          visibility: snapshot.visibility,
          cloneUrl: snapshot.cloneUrl,
          htmlUrl: snapshot.htmlUrl,
          metadataFetchedAt: now,
          updatedAt: now,
        },
      })
      .returning();
    if (!repositoryRow) throw new Error('Repository upsert returned no rows');

    const [projectRow] = await tx
      .insert(projects)
      .values({
        workspaceId: params.workspaceId,
        repositoryId: repositoryRow.id,
        name: params.name,
      })
      .onConflictDoNothing({
        target: [projects.workspaceId, projects.repositoryId],
      })
      .returning();

    if (!projectRow) {
      const [existing] = await tx
        .select({project: projects})
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, params.workspaceId),
            eq(projects.repositoryId, repositoryRow.id),
          ),
        )
        .limit(1);
      if (existing) throw new ProjectAlreadyExistsError(existing.project.id, repositoryRow.id);
      throw new Error('Project insert returned no rows');
    }

    const project: ProjectWithRepository = {
      ...toProject(projectRow),
      repository: toRepository(repositoryRow),
    };

    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_CREATED,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        repositoryId: project.repositoryId,
      },
    });
    await writeOutboxEvent<ProjectsEventMap>(tx, projectsOutbox, {
      type: PROJECT_VCS_BOUND,
      payload: {
        actorId: params.actorId,
        workspaceId: project.workspaceId,
        projectId: project.id,
        repositoryId: project.repositoryId,
        provider: project.repository.provider,
        providerHost: project.repository.providerHost,
        externalRepositoryId: project.repository.externalRepositoryId,
      },
    });

    return project;
  });
}
