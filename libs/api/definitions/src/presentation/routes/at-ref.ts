import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  type DefinitionAtRefFileDto,
  definitionAtRefQuerySchema,
  definitionAtRefResponseSchema,
} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {DefinitionAtRefError, type DefinitionAtRefFile, listDefinitionsAtRef} from '#core/index.js';
import {requireProjectAccess} from './project-access.js';

export interface AtRefRouteOptions {
  projects: ProjectsModuleClient;
  agent: AgentInterModuleClient;
  integrations: IntegrationsModuleClient;
}

export function buildAtRefRoute(options: AtRefRouteOptions) {
  return defineRoute({
    method: 'GET',
    path: '/at-ref',
    description: 'List workflow definitions at a git ref with validation state',
    schema: {
      querystring: definitionAtRefQuerySchema,
      response: {
        200: definitionAtRefResponseSchema,
      },
    },
    errorHandler: (error) => {
      if (error instanceof DefinitionAtRefError) throw toAtRefClientError(error);
      throw error;
    },
    handler: async (request) => {
      const {project_id: projectId, ref} = request.query;
      await requireProjectAccess(request, projectId, options.projects);
      const listing = await listDefinitionsAtRef({projectId, ref, ...options});
      return {
        ref,
        commit: listing.commit,
        files: listing.files.map(toDefinitionAtRefFileDto),
      };
    },
  });
}

function toAtRefClientError(error: DefinitionAtRefError): ClientError {
  switch (error.code) {
    case 'project-not-found':
      return new ClientError('Project not found', 'project-not-found', {status: 404});
    case 'ref-not-found':
      return new ClientError('Git ref not found', 'ref-not-found', {
        details: {ref: String(error.details.ref)},
        status: 404,
      });
    case 'ref-invalid':
      return new ClientError('Ref must be a branch or tag name', 'ref-invalid', {
        details: {ref: String(error.details.ref)},
        status: 400,
      });
    case 'too-many-files':
      return new ClientError('Too many workflow files at this ref', 'too-many-files', {
        status: 422,
      });
    case 'source-unavailable':
      return new ClientError('Source repository is unavailable', 'source-unavailable', {
        status: 502,
      });
    default:
      // The remaining codes are resolve-only and unreachable from the listing.
      throw error;
  }
}

function toDefinitionAtRefFileDto(file: DefinitionAtRefFile): DefinitionAtRefFileDto {
  return {
    config_path: file.configPath,
    name: file.name,
    valid: file.valid,
    errors: file.errors,
    warnings: file.warnings,
    triggers: file.triggers,
  };
}
