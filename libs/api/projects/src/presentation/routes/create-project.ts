import {AUTH_USER, requireUserContext} from '@shipfox/api-auth-context';
import {
  IntegrationCapabilityUnavailableError,
  IntegrationConnectionInactiveError,
  IntegrationConnectionNotFoundError,
  IntegrationConnectionWorkspaceMismatchError,
  IntegrationProviderError,
  type IntegrationProviderErrorReason,
  IntegrationProviderUnavailableError,
  type IntegrationSourceControlService,
} from '@shipfox/api-integration-core';
import {createProjectBodySchema, projectResponseSchema} from '@shipfox/api-projects-dto';
import {requireMembership} from '@shipfox/api-workspaces';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {createProjectFromSource, ProjectAlreadyExistsError} from '#core/index.js';
import {toProjectDto} from '#presentation/dto/index.js';

function providerStatus(reason: IntegrationProviderErrorReason): number {
  if (reason === 'rate-limited') return 429;
  if (reason === 'timeout' || reason === 'provider-unavailable') return 503;
  return 422;
}

function isProviderError(error: unknown): error is IntegrationProviderError {
  return (
    error instanceof IntegrationProviderError ||
    (error instanceof Error &&
      'reason' in error &&
      typeof error.reason === 'string' &&
      (error.reason === 'repository-not-found' ||
        error.reason === 'access-denied' ||
        error.reason === 'rate-limited' ||
        error.reason === 'timeout' ||
        error.reason === 'provider-unavailable' ||
        error.reason === 'malformed-provider-response'))
  );
}

export function createProjectRoute(sourceControl: IntegrationSourceControlService) {
  return defineRoute({
    method: 'POST',
    path: '/',
    auth: AUTH_USER,
    description: 'Create a project bound to a source repository.',
    schema: {
      body: createProjectBodySchema,
      response: {
        201: projectResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof IntegrationConnectionNotFoundError) {
        throw new ClientError(error.message, 'source-connection-not-found', {status: 404});
      }
      if (error instanceof IntegrationConnectionWorkspaceMismatchError) {
        throw new ClientError(error.message, 'forbidden', {status: 403});
      }
      if (error instanceof IntegrationConnectionInactiveError) {
        throw new ClientError(error.message, 'source-connection-inactive', {status: 422});
      }
      if (error instanceof IntegrationProviderUnavailableError) {
        throw new ClientError(error.message, 'integration-provider-unavailable', {status: 422});
      }
      if (error instanceof IntegrationCapabilityUnavailableError) {
        throw new ClientError(error.message, 'integration-capability-unavailable', {status: 422});
      }
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
      if (isProviderError(error)) {
        throw new ClientError(error.message, error.reason, {
          details: {retry_after_seconds: error.retryAfterSeconds},
          status: providerStatus(error.reason),
        });
      }
      throw error;
    },
    handler: async (request, reply) => {
      const {workspace_id: workspaceId, name, source} = request.body;
      const actor = requireUserContext(request);

      await requireMembership({request, workspaceId});
      const project = await createProjectFromSource({
        actorId: actor.userId,
        workspaceId,
        name,
        sourceConnectionId: source.connection_id,
        sourceExternalRepositoryId: source.external_repository_id,
        sourceControl,
      });

      reply.status(201);
      return toProjectDto(project);
    },
  });
}
