import type {AgentInterModuleClient} from '@shipfox/api-agent-dto/inter-module';
import {
  definitionDtoSchema,
  definitionValidationErrorSchema,
  definitionValidationWarningSchema,
} from '@shipfox/api-definitions-dto';
import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {validateDefinition} from '#core/validate-definition.js';

const validateBodySchema = z.object({
  yaml: z.string().min(1).max(1_000_000),
});

const validationResultSchema = z.union([
  z.object({
    valid: z.literal(true),
    workflow_document: definitionDtoSchema.shape.workflow_document,
    workflow_model: definitionDtoSchema.shape.workflow_model,
    warnings: z.array(definitionValidationWarningSchema),
  }),
  z.object({
    valid: z.literal(false),
    errors: z.array(definitionValidationErrorSchema),
  }),
]);

export function buildValidateDefinitionRoute(agent: AgentInterModuleClient) {
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
      const {yaml} = request.body;
      const result = validateDefinition(yaml, {
        agentValidationCatalog: await agent.getValidationCatalog({}),
      });

      if (result.valid) {
        return {
          valid: true as const,
          workflow_document: result.definition.document,
          workflow_model: result.definition.model,
          warnings: result.warnings,
        };
      }

      return result;
    },
  });
}
