import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {createProjectBodySchema, projectResponseSchema} from '@shipfox/api-projects-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {
  createProjectFromRepository,
  ProjectAccessDeniedError,
  ProjectAlreadyExistsError,
  TestVcsProviderDisabledError,
  VcsConnectionNotFoundError,
  VcsProviderError,
} from '#core/index.js';
import {toProjectDto} from '#presentation/dto/index.js';

function providerStatus(reason: VcsProviderError['reason']): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

export const createProjectRoute = defineRoute({
  method: 'POST',
  path: '/',
  auth: AUTH_USER,
  description: 'Create a project bound to a repository.',
  schema: {
    body: createProjectBodySchema,
    response: {
      201: projectResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof VcsConnectionNotFoundError) {
      throw new ClientError(error.message, 'vcs-connection-not-found', {status: 404});
    }
    if (error instanceof ProjectAccessDeniedError) {
      throw new ClientError(error.message, 'forbidden', {status: 403});
    }
    if (error instanceof TestVcsProviderDisabledError) {
      throw new ClientError(error.message, 'test-provider-disabled', {status: 422});
    }
    if (error instanceof ProjectAlreadyExistsError) {
      throw new ClientError(error.message, 'project-already-exists', {
        details: {
          existing_project_id: error.existingProjectId,
          repository_id: error.repositoryId,
        },
        status: 409,
      });
    }
    if (error instanceof VcsProviderError) {
      throw new ClientError(error.message, error.reason, {
        details: {retry_after_seconds: error.retryAfterSeconds},
        status: providerStatus(error.reason),
      });
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {
      workspace_id: workspaceId,
      name,
      vcs_connection_id: vcsConnectionId,
      external_repository_id: externalRepositoryId,
    } = request.body;
    const actor = requireUserContext(request);

    await requireMembership({request, workspaceId});
    const project = await createProjectFromRepository({
      actorId: actor.userId,
      workspaceId,
      name,
      vcsConnectionId,
      externalRepositoryId,
    });

    reply.status(201);
    return toProjectDto(project);
  },
});
