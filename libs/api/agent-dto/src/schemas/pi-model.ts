import {z} from 'zod';

export const managedModelThinkingLevelSchema = z.enum([
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

export type ManagedModelThinkingLevel = z.infer<typeof managedModelThinkingLevelSchema>;

type NormalizeOptional<T> = T extends readonly (infer U)[]
  ? readonly NormalizeOptional<U>[]
  : T extends object
    ? {[K in keyof T]: NormalizeOptional<Exclude<T[K], undefined>>}
    : T;

/**
 * Maps Pi thinking levels to provider-specific values. A null entry preserves
 * Pi's explicit unsupported-level behavior; an omitted entry keeps Pi's
 * provider default behavior.
 */
const managedModelThinkingLevelMapSchemaInternal = z.partialRecord(
  managedModelThinkingLevelSchema,
  z.string().nullable(),
);

export type ManagedModelThinkingLevelMap = NormalizeOptional<
  z.infer<typeof managedModelThinkingLevelMapSchemaInternal>
>;

export const managedModelThinkingLevelMapSchema: z.ZodType<ManagedModelThinkingLevelMap> =
  managedModelThinkingLevelMapSchemaInternal as z.ZodType<ManagedModelThinkingLevelMap>;

const sessionAffinityFormatSchema = z.enum(['openai', 'openai-nosession', 'openrouter']);
const thinkingFormatSchema = z.enum([
  'openai',
  'openrouter',
  'deepseek',
  'together',
  'zai',
  'qwen',
  'chat-template',
  'qwen-chat-template',
  'string-thinking',
  'ant-ling',
]);

const chatTemplateKwargSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
  z.object({
    $var: z.enum(['thinking.enabled', 'thinking.effort']),
    omitWhenOff: z.boolean().optional(),
  }),
]);

const openRouterRoutingSchema = z.object({
  allow_fallbacks: z.boolean().optional(),
  require_parameters: z.boolean().optional(),
  data_collection: z.enum(['deny', 'allow']).optional(),
  zdr: z.boolean().optional(),
  enforce_distillable_text: z.boolean().optional(),
  order: z.array(z.string()).optional(),
  only: z.array(z.string()).optional(),
  ignore: z.array(z.string()).optional(),
  quantizations: z.array(z.string()).optional(),
  sort: z
    .union([
      z.string(),
      z.object({
        by: z.string().optional(),
        partition: z.string().nullable().optional(),
      }),
    ])
    .optional(),
  max_price: z
    .object({
      prompt: z.union([z.number(), z.string()]).optional(),
      completion: z.union([z.number(), z.string()]).optional(),
      image: z.union([z.number(), z.string()]).optional(),
      audio: z.union([z.number(), z.string()]).optional(),
      request: z.union([z.number(), z.string()]).optional(),
    })
    .optional(),
  preferred_min_throughput: z
    .union([
      z.number(),
      z.object({
        p50: z.number().optional(),
        p75: z.number().optional(),
        p90: z.number().optional(),
        p99: z.number().optional(),
      }),
    ])
    .optional(),
  preferred_max_latency: z
    .union([
      z.number(),
      z.object({
        p50: z.number().optional(),
        p75: z.number().optional(),
        p90: z.number().optional(),
        p99: z.number().optional(),
      }),
    ])
    .optional(),
});

const vercelGatewayRoutingSchema = z.object({
  only: z.array(z.string()).optional(),
  order: z.array(z.string()).optional(),
});

const openAICompletionsCompatSchema = z
  .object({
    supportsStore: z.boolean().optional(),
    supportsDeveloperRole: z.boolean().optional(),
    supportsReasoningEffort: z.boolean().optional(),
    supportsUsageInStreaming: z.boolean().optional(),
    maxTokensField: z.enum(['max_completion_tokens', 'max_tokens']).optional(),
    requiresToolResultName: z.boolean().optional(),
    requiresAssistantAfterToolResult: z.boolean().optional(),
    requiresThinkingAsText: z.boolean().optional(),
    requiresReasoningContentOnAssistantMessages: z.boolean().optional(),
    thinkingFormat: thinkingFormatSchema.optional(),
    chatTemplateKwargs: z.record(z.string(), chatTemplateKwargSchema).optional(),
    openRouterRouting: openRouterRoutingSchema.optional(),
    vercelGatewayRouting: vercelGatewayRoutingSchema.optional(),
    zaiToolStream: z.boolean().optional(),
    supportsOpenAIGrammarTools: z.boolean().optional(),
    supportsStrictMode: z.boolean().optional(),
    cacheControlFormat: z.literal('anthropic').optional(),
    sendSessionAffinityHeaders: z.boolean().optional(),
    deferredToolsMode: z.literal('kimi').optional(),
    sessionAffinityFormat: sessionAffinityFormatSchema.optional(),
    supportsLongCacheRetention: z.boolean().optional(),
  })
  .strict();

const openAIResponsesCompatSchema = z
  .object({
    supportsDeveloperRole: z.boolean().optional(),
    sessionAffinityFormat: sessionAffinityFormatSchema.optional(),
    supportsLongCacheRetention: z.boolean().optional(),
    supportsStrictMode: z.boolean().optional(),
    supportsOpenAIGrammarTools: z.boolean().optional(),
    supportsToolSearch: z.boolean().optional(),
    supportsExplicitPromptCacheMode: z.boolean().optional(),
  })
  .strict();

const anthropicMessagesCompatSchema = z
  .object({
    supportsEagerToolInputStreaming: z.boolean().optional(),
    supportsLongCacheRetention: z.boolean().optional(),
    sendSessionAffinityHeaders: z.boolean().optional(),
    supportsCacheControlOnTools: z.boolean().optional(),
    supportsTemperature: z.boolean().optional(),
    forceAdaptiveThinking: z.boolean().optional(),
    allowEmptySignature: z.boolean().optional(),
    supportsStrictTools: z.boolean().optional(),
    supportsToolReferences: z.boolean().optional(),
  })
  .strict();

/** Pi compatibility overrides for managed models. */
const managedModelCompatSchemaInternal = z.union([
  openAICompletionsCompatSchema,
  openAIResponsesCompatSchema,
  anthropicMessagesCompatSchema,
]);

export type ManagedModelCompat = NormalizeOptional<
  z.infer<typeof managedModelCompatSchemaInternal>
>;

export const managedModelCompatSchema: z.ZodType<ManagedModelCompat> =
  managedModelCompatSchemaInternal as z.ZodType<ManagedModelCompat>;
