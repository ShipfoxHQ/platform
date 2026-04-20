import {defineRoute} from '@shipfox/node-fastify';
import {z} from 'zod';
import {validateDefinition} from '#core/validate-definition.js';

const validateBodySchema = z.object({
  yaml: z.string().min(1).max(1_000_000),
});

const validationErrorSchema = z.object({
  message: z.string(),
  path: z.string().optional(),
});

const validationResultSchema = z.union([
  z.object({
    valid: z.literal(true),
    spec: z.record(z.unknown()),
  }),
  z.object({
    valid: z.literal(false),
    errors: z.array(validationErrorSchema),
  }),
]);

export const validateDefinitionRoute = defineRoute({
  method: 'POST',
  path: '/validate',
  description: 'Validate a workflow definition without persisting',
  schema: {
    body: validateBodySchema,
    response: {
      200: validationResultSchema,
    },
  },
  handler: (request) => {
    const {yaml} = request.body;
    const result = validateDefinition(yaml);

    if (result.valid) {
      return {
        valid: true as const,
        spec: result.spec as unknown as Record<string, unknown>,
      };
    }

    return result;
  },
});
