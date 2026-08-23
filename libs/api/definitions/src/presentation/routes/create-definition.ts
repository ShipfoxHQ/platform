import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  createDefinitionBodySchema,
  definitionResponseSchema,
  definitionValidationErrorSchema,
} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {limitDefinitionSyncDiagnostics} from '#core/entities/sync-state.js';
import {DefinitionParseError} from '#core/errors.js';
import {loadIntegrationValidationContext} from '#core/integrations.js';
import {needsIntegrationValidationContext} from '#core/needs-integration-validation-context.js';
import {
  type ParseDefinitionOptions,
  type ParsedDefinition,
  parseDefinitionWithDiagnostics,
} from '#core/parse-definition.js';
import {upsertDefinition} from '#db/definitions.js';
import {toDefinitionDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

export interface CreateDefinitionRouteOptions {
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations?: IntegrationsModuleClient;
}

export function buildCreateDefinitionRoute(options: CreateDefinitionRouteOptions) {
  return defineRoute({
    method: 'POST',
    path: '/',
    description: 'Create or update a workflow definition',
    schema: {
      body: createDefinitionBodySchema,
      response: {
        200: definitionResponseSchema,
        400: z.object({
          code: z.string(),
          message: z.string().optional(),
          details: z.array(definitionValidationErrorSchema).optional(),
        }),
        404: z.object({code: z.string()}),
      },
    },
    errorHandler: (error, _request, _reply) => {
      if (error instanceof DefinitionParseError) {
        throw new ClientError(error.message, 'invalid-workflow-definition', {
          details: error.details,
          status: 400,
        });
      }
      throw error;
    },
    handler: async (request) => {
      const {project_id: projectId, config_path, source, yaml: yamlString, sha, ref} = request.body;
      const project = await requireProjectAccess(request, projectId, options.projects);

      const agentValidationCatalog = await options.agent.getValidationCatalog({});
      const structurallyParsed = parseDefinitionForCreate(yamlString, {agentValidationCatalog});
      const {integrations} = options;
      const parsed =
        integrations !== undefined && needsIntegrationValidationContext(structurallyParsed.document)
          ? parseDefinitionForCreate(yamlString, {
              agentValidationCatalog,
              integrationValidationContext: await loadIntegrationValidationContext(
                integrations,
                project.workspaceId,
                project.sourceConnectionId,
              ),
            })
          : structurallyParsed;

      const definition = await upsertDefinition({
        projectId,
        workspaceId: project.workspaceId,
        configPath: config_path,
        source,
        name: parsed.document.name,
        document: parsed.document,
        model: parsed.model,
        sourceSnapshot: parsed.sourceSnapshot,
        sha,
        ref,
      });

      return {
        ...toDefinitionDto(definition),
        diagnostics: limitDefinitionSyncDiagnostics(parsed.diagnostics),
      };
    },
  });
}

function parseDefinitionForCreate(
  yamlString: string,
  options: ParseDefinitionOptions,
): ParsedDefinition {
  const parsed = parseDefinitionWithDiagnostics(yamlString, options);
  const errors = parsed.issues
    .filter((issue) => issue.severity === 'error' && issue.scope === 'definition')
    .map(({message, path}) => ({message, ...(path.length === 0 ? {} : {path: path.join('.')})}));

  if (errors.length > 0) {
    throw new DefinitionParseError(errors[0]?.message ?? 'Invalid definition', errors);
  }

  return parsed;
}
