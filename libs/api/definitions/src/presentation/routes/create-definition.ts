import {getApiKeyContext} from '@shipfox/api-auth-context';
import {createDefinitionBodySchema, definitionResponseSchema} from '@shipfox/api-definitions-dto';
import {ProjectNotFoundError, requireProjectForWorkspace} from '@shipfox/api-projects';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {DefinitionParseError} from '#core/errors.js';
import {parseDefinition} from '#core/parse-definition.js';
import {upsertDefinition} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';

export const createDefinitionRoute = defineRoute({
  method: 'POST',
  path: '/',
  description: 'Create or update a workflow definition',
  schema: {
    body: createDefinitionBodySchema,
    response: {
      200: definitionResponseSchema,
    },
  },
  errorHandler: (error, _request, _reply) => {
    if (error instanceof DefinitionParseError) {
      throw new ClientError(error.message, 'invalid-definition-spec', {
        data: error.details,
        status: 400,
      });
    }
    if (error instanceof ProjectNotFoundError) {
      throw new ClientError(error.message, 'project-not-found', {status: 404});
    }
    throw error;
  },
  handler: async (request) => {
    const {project_id: projectId, config_path, source, yaml: yamlString, sha, ref} = request.body;
    const apiKeyContext = getApiKeyContext(request);
    if (!apiKeyContext) {
      throw new ClientError('Authentication required', 'unauthorized', {status: 401});
    }
    await requireProjectForWorkspace({projectId, workspaceId: apiKeyContext.workspaceId});

    const spec = parseDefinition(yamlString);

    const definition = await upsertDefinition({
      projectId,
      configPath: config_path,
      source,
      name: spec.name,
      definition: spec,
      sha,
      ref,
    });

    return toDefinitionDto(definition);
  },
});
