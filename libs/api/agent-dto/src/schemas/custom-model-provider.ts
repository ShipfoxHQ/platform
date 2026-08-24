import {z} from 'zod';
import {isReservedModelProviderId, modelProviderRefSchema} from './model-provider-id.js';
import {managedModelCompatSchema, managedModelThinkingLevelMapSchema} from './pi-model.js';

const MAX_HEADER_COUNT = 32;
export const MAX_MODEL_COUNT = 128;

export const DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 128_000;
export const DEFAULT_CUSTOM_MODEL_MAX_OUTPUT_TOKENS = 16_384;
export const DEFAULT_CUSTOM_MODEL_INPUT_IMAGE = false;
export const DEFAULT_CUSTOM_MODEL_REASONING = false;

const headerNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/)
  .transform((name) => name.toLowerCase());

const headerValueSchema = z.string().min(1).max(8192);
const modelIdSchema = z.string().min(1).max(128);

export const modelProviderApiSchema = z.enum([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
  'google-generative-ai',
]);

export type ModelProviderApi = z.infer<typeof modelProviderApiSchema>;

export const customAgentModelSchema = z.object({
  id: modelIdSchema,
  label: z.string().min(1).max(160),
  context_window: z.number().int().positive().optional(),
  max_output_tokens: z.number().int().positive().optional(),
  input_image: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  thinking_level_map: managedModelThinkingLevelMapSchema.optional(),
  compat: managedModelCompatSchema.optional(),
});

export type CustomAgentModelDto = z.infer<typeof customAgentModelSchema>;

export const customModelProviderHeaderDtoSchema = z.object({
  name: headerNameSchema,
  value: headerValueSchema,
});

export type CustomModelProviderHeaderDto = z.infer<typeof customModelProviderHeaderDtoSchema>;

export const customModelProviderHeaderRequestSchema = customModelProviderHeaderDtoSchema.extend({
  secret: z.boolean(),
});

export type CustomModelProviderHeaderRequestDto = z.infer<
  typeof customModelProviderHeaderRequestSchema
>;

export const updateCustomModelProviderHeaderRequestSchema = z
  .object({
    name: headerNameSchema,
    value: headerValueSchema.optional(),
    secret: z.boolean(),
    keep: z.boolean().optional(),
  })
  .superRefine((header, ctx) => {
    if (header.keep === true) {
      if (!header.secret) {
        ctx.addIssue({
          code: 'custom',
          path: ['secret'],
          message: 'Kept headers must be secret.',
        });
      }
      if (header.value !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['value'],
          message: 'Kept headers must not include a value.',
        });
      }
      return;
    }

    if (header.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Header value is required.',
      });
    }
  });

export type UpdateCustomModelProviderHeaderRequestDto = z.infer<
  typeof updateCustomModelProviderHeaderRequestSchema
>;

const customModelProviderHeadersRequestSchema = z
  .array(customModelProviderHeaderRequestSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const updateCustomModelProviderHeadersRequestSchema = z
  .array(updateCustomModelProviderHeaderRequestSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const customModelProviderHeadersDtoSchema = z
  .array(customModelProviderHeaderDtoSchema)
  .max(MAX_HEADER_COUNT)
  .superRefine(assertUniqueHeaderNames);

const customModelProviderModelsSchema = z
  .array(customAgentModelSchema)
  .min(1)
  .max(MAX_MODEL_COUNT)
  .superRefine(assertUniqueModelIds);

const customModelProviderBodyFields = {
  display_name: z.string().min(1).max(120),
  api: modelProviderApiSchema,
  base_url: z.string().url().max(2048),
  api_key: z.string().min(1).max(8192).optional(),
  models: customModelProviderModelsSchema,
  default_model: modelIdSchema.nullable().optional(),
};

export const createCustomModelProviderBodySchema = z
  .object({
    slug: modelProviderRefSchema.refine((slug) => !isReservedModelProviderId(slug), {
      message: 'Provider ID is reserved.',
    }),
    ...customModelProviderBodyFields,
    headers: customModelProviderHeadersRequestSchema.optional(),
  })
  .superRefine(assertDefaultModelInModels);

export type CreateCustomModelProviderBodyDto = z.infer<typeof createCustomModelProviderBodySchema>;

export const updateCustomModelProviderBodySchema = z
  .object({
    ...customModelProviderBodyFields,
    headers: updateCustomModelProviderHeadersRequestSchema.optional(),
    models: customModelProviderModelsSchema.optional(),
  })
  .partial()
  .superRefine((body, ctx) => {
    if (body.models === undefined) return;
    assertDefaultModelInModels(body, ctx);
  });

export type UpdateCustomModelProviderBodyDto = z.infer<typeof updateCustomModelProviderBodySchema>;

export const discoverCustomModelProviderModelsBodySchema = z.object({
  api: modelProviderApiSchema,
  base_url: z.string().url().max(2048),
  api_key: z.string().min(1).max(8192).optional(),
  headers: customModelProviderHeadersDtoSchema.optional(),
});

export type DiscoverCustomModelProviderModelsBodyDto = z.infer<
  typeof discoverCustomModelProviderModelsBodySchema
>;

export const discoverCustomModelProviderModelsBySlugBodySchema = z.object({
  api: modelProviderApiSchema.optional(),
  base_url: z.string().url().max(2048).optional(),
  api_key: z.string().min(1).max(8192).optional(),
  headers: updateCustomModelProviderHeadersRequestSchema.optional(),
});

export type DiscoverCustomModelProviderModelsBySlugBodyDto = z.infer<
  typeof discoverCustomModelProviderModelsBySlugBodySchema
>;

export const discoverCustomModelProviderModelsResponseSchema = z.object({
  models: z
    .array(z.object({id: modelIdSchema, label: z.string().min(1).max(160)}))
    .max(MAX_MODEL_COUNT),
});

export type DiscoverCustomModelProviderModelsResponseDto = z.infer<
  typeof discoverCustomModelProviderModelsResponseSchema
>;

const customModelProviderConfigBaseSchema = z.object({
  api: modelProviderApiSchema,
  base_url: z.string().url().max(2048),
  headers: customModelProviderHeadersDtoSchema,
  secret_header_names: z
    .array(headerNameSchema)
    .max(MAX_HEADER_COUNT)
    .superRefine(assertUniqueStrings),
  models: customModelProviderModelsSchema,
});

export const customModelProviderRuntimeConfigSchema = customModelProviderConfigBaseSchema.extend({
  requires_api_key: z.boolean(),
});

export type CustomModelProviderRuntimeConfigDto = z.infer<
  typeof customModelProviderRuntimeConfigSchema
>;

export const customModelProviderConfigDtoSchema = customModelProviderConfigBaseSchema.extend({
  kind: z.literal('custom'),
  provider_id: modelProviderRefSchema,
  display_name: z.string().min(1).max(120),
  default_model: modelIdSchema.nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type CustomModelProviderConfigDto = z.infer<typeof customModelProviderConfigDtoSchema>;

function assertDefaultModelInModels(
  body: {default_model?: string | null | undefined; models?: CustomAgentModelDto[] | undefined},
  ctx: z.RefinementCtx,
): void {
  if (typeof body.default_model !== 'string' || body.models === undefined) return;

  if (!body.models.some((model) => model.id === body.default_model)) {
    ctx.addIssue({
      code: 'custom',
      path: ['default_model'],
      message: 'Default model must be one of the configured models.',
    });
  }
}

function assertUniqueHeaderNames(headers: Array<{name: string}>, ctx: z.RefinementCtx): void {
  assertUniqueStrings(
    headers.map((header) => header.name),
    ctx,
  );
}

function assertUniqueModelIds(models: CustomAgentModelDto[], ctx: z.RefinementCtx): void {
  assertUniqueStrings(
    models.map((model) => model.id),
    ctx,
  );
}

function assertUniqueStrings(values: string[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (!seen.has(value)) {
      seen.add(value);
      continue;
    }

    ctx.addIssue({
      code: 'custom',
      path: [index],
      message: 'Duplicate value.',
    });
  }
}
