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

const MAX_GENERATED_SLUG_ATTEMPTS = 5;

function generatedProjectSlug(slugBase: string): string {
  const suffix = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 8), 16);
  return withSlugSuffix(slugBase, suffix);
}

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
    const requestedSlug = request.body.slug;
    const slugBase = slugifyName(request.body.name, {fallback: 'project'});
    let slug = requestedSlug ?? generatedProjectSlug(slugBase);

    for (let attempt = 0; attempt < MAX_GENERATED_SLUG_ATTEMPTS; attempt += 1) {
      try {
        const sourceRepository =
          request.body.source_repository_owner === undefined ||
          request.body.source_repository_name === undefined
            ? undefined
            : {
                owner: request.body.source_repository_owner,
                name: request.body.source_repository_name,
                defaultBranch: request.body.source_default_branch ?? 'main',
              };
        const project = await createProject({
          workspaceId: request.body.workspace_id,
          name: request.body.name,
          slug,
          sourceConnectionId: request.body.source_connection_id ?? randomUUID(),
          sourceExternalRepositoryId:
            request.body.source_external_repository_id ?? syntheticExternalRepositoryId(),
          sourceRepository,
        });

        reply.code(201);
        return toProjectDto(project);
      } catch (error) {
        const shouldRetrySlug =
          requestedSlug === undefined &&
          error instanceof ProjectSlugConflictError &&
          attempt < MAX_GENERATED_SLUG_ATTEMPTS - 1;
        if (!shouldRetrySlug) throw error;
        slug = generatedProjectSlug(slugBase);
      }
    }

    throw new Error('Unable to generate a unique project slug');
  },
});
