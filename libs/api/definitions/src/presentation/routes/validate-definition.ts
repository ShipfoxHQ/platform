import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  definitionDtoSchema,
  definitionValidationDiagnosticSchema,
  definitionValidationErrorSchema,
} from '@shipfox/api-definitions-dto';
import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import type {ProjectsModuleClient} from '@shipfox/api-projects-dto/inter-module';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {loadIntegrationValidationContext} from '#core/integrations.js';
import {needsIntegrationValidationContext} from '#core/needs-integration-validation-context.js';
import {validateDefinition} from '#core/validate-definition.js';
import {requireProjectAccess} from './project-access.js';

const validateBodySchema = z.object({
  yaml: z.string().min(1).max(1_000_000),
  project_id: z.string().uuid().optional(),
});

const validationResultSchema = z.union([
  z.object({
    valid: z.literal(true),
    workflow_document: definitionDtoSchema.shape.workflow_document,
    workflow_model: definitionDtoSchema.shape.workflow_model,
    diagnostics: z.array(definitionValidationDiagnosticSchema),
  }),
  z.object({
    valid: z.literal(false),
    errors: z.array(definitionValidationErrorSchema),
  }),
]);

export function buildValidateDefinitionRoute(options: {
  agent: AgentInterModuleClient;
  projects: ProjectsModuleClient;
  integrations: IntegrationsModuleClient;
}) {
  return defineRoute({
    method: 'POST',
    path: '/validate',
    description: 'Validate a workflow definition without persisting',
    schema: {
      body: validateBodySchema,
      response: {
        200: validationResultSchema,
      },
    },
    handler: async (request) => {
      const {yaml, project_id: projectId} = request.body;
      const project =
        projectId === undefined
          ? null
          : await requireProjectAccess(request, projectId, options.projects);
      const workspaceId = project?.workspaceId ?? null;
      const agentValidationCatalog = await options.agent.getValidationCatalogV2({workspaceId});
      let result = validateDefinition(yaml, {
        agentValidationCatalog,
      });

      if (result.valid && needsIntegrationValidationContext(result.definition.document)) {
        if (project === null) {
          return {
            valid: false as const,
            errors: [
              {
                path: 'project_id',
                message:
                  '`project_id` is required to validate integration triggers, listeners, agent integrations, and tool steps.',
              },
            ],
          };
        }

        result = validateDefinition(yaml, {
          agentValidationCatalog,
          integrationValidationContext: await loadIntegrationValidationContext(
            options.integrations,
            project.workspaceId,
            project.sourceConnectionId,
          ),
        });
      }

      if (result.valid) {
        return {
          valid: true as const,
          workflow_document: result.definition.document,
          workflow_model: result.definition.model,
          diagnostics: result.diagnostics,
        };
      }

      return result;
    },
  });
}
