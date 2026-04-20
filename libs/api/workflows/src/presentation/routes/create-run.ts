import {getApiKeyContext} from '@shipfox/api-auth-context';
import {ProjectNotFoundError, requireProjectForWorkspace} from '@shipfox/api-projects';
import {createRunBodySchema, runResponseSchema} from '@shipfox/api-workflows-dto';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {DefinitionNotFoundError, ProjectMismatchError} from '#core/errors.js';
import {runWorkflow} from '#core/run-workflow.js';
import {toRunDto} from '#presentation/dto/index.js';

export const createRunRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create a workflow run (manual trigger)',
  schema: {
    body: createRunBodySchema,
    response: {
      201: runResponseSchema,
    },
  },
  errorHandler: (error) => {
    if (error instanceof DefinitionNotFoundError) {
      throw new ClientError(error.message, 'definition-not-found', {status: 404});
    }
    if (error instanceof ProjectMismatchError) {
      throw new ClientError(error.message, 'project-mismatch', {status: 403});
    }
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError(error.message, 'project-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request, reply) => {
    const {project_id: projectId, definition_id, inputs} = request.body;

    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }

    const project = await requireProjectForWorkspace({
      projectId,
      workspaceId: apiKeyContext.workspaceId,
    });

    const run = await runWorkflow({
      workspaceId: project.workspaceId,
      projectId: project.id,
      definitionId: definition_id,
      inputs,
    });

    reply.status(201);
    return toRunDto(run);
  },
});
