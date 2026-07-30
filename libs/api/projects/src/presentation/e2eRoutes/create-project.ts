import {randomUUID} from 'node:crypto';
import {slugifyName, withSlugSuffix} from '@shipfox/api-common-dto';
import {
  e2eCreateProjectBodySchema,
  e2eCreateProjectResponseSchema,
} from '@shipfox/api-projects-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {ProjectAlreadyExistsError, ProjectSlugConflictError} from '#core/index.js';
import {createProject} from '#db/index.js';
import {toProjectDto} from '#presentation/dto/index.js';

function syntheticExternalRepositoryId(): string {
  return `e2e:${randomUUID()}`;
}

let e2eProjectSequence = 1;

export const createE2eProjectRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a synthetic project for E2E tests.',
  schema: {
    body: e2eCreateProjectBodySchema,
    response: {
      201: e2eCreateProjectResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof ProjectAlreadyExistsError) {
      throw new ClientError(error.message, 'project-already-exists', {
        details: {
          existing_project_id: error.existingProjectId,
          source_connection_id: error.sourceConnectionId,
          source_external_repository_id: error.sourceExternalRepositoryId,
        },
        status: 409,
      });
    }
    if (error instanceof ProjectSlugConflictError) {
      throw new ClientError('Project slug already exists', 'slug-conflict', {status: 409});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const project = await createProject({
      workspaceId: request.body.workspace_id,
      name: request.body.name,
      slug:
        request.body.slug ??
        withSlugSuffix(slugifyName(request.body.name, {fallback: 'project'}), ++e2eProjectSequence),
      sourceConnectionId: request.body.source_connection_id ?? randomUUID(),
      sourceExternalRepositoryId:
        request.body.source_external_repository_id ?? syntheticExternalRepositoryId(),
    });

    reply.code(201);
    return toProjectDto(project);
  },
});
