import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  definitionAtRefQuerySchema,
  definitionAtRefResponseSchema,
} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {ClientError, defineRoute} from '@shipfox/node-fastify';
import {DefinitionAtRefError} from '#core/errors.js';
import {listDefinitionsAtRef} from '#core/resolve-definition-at-ref.js';
import {toDefinitionAtRefFileDto} from '#presentation/dto/index.js';
import {requireProjectAccess} from './project-access.js';

const AT_REF_HANDLER_TIMEOUT_MS = 30_000;

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
    options: {handlerTimeout: AT_REF_HANDLER_TIMEOUT_MS},
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
      const project = await requireProjectAccess(request, projectId, options.projects);
      const listing = await listDefinitionsAtRef({
        projectId,
        ref,
        project,
        signal: request.signal,
        ...options,
      });
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
        details: {file_count: Number(error.details.fileCount)},
        status: 422,
      });
    case 'source-unavailable':
      if (error.details.sourceCode === 'connection-inactive') {
        return new ClientError(
          'Integration connection is not active',
          'integration-connection-inactive',
          {
            status: 422,
          },
        );
      }
      if (error.details.sourceCode === 'connection-not-found') {
        return new ClientError(
          'Integration connection not found',
          'integration-connection-not-found',
          {
            status: 404,
          },
        );
      }
      if (error.details.sourceCode === 'connection-workspace-mismatch') {
        return new ClientError(
          'Integration connection does not belong to this workspace',
          'forbidden',
          {status: 403},
        );
      }
      if (
        error.details.sourceCode === 'provider-failure' &&
        error.details.sourceReason === 'rate-limited'
      ) {
        return new ClientError('Integration provider request failed', 'rate-limited', {
          details:
            error.details.retryAfterSeconds === undefined
              ? {}
              : {retry_after_seconds: error.details.retryAfterSeconds},
          status: 429,
        });
      }
      return new ClientError('Source repository is unavailable', 'source-unavailable', {
        status: 502,
      });
    default:
      // The remaining codes are resolve-only and unreachable from the listing.
      throw error;
  }
}
