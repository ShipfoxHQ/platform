import type {AgentThinking} from '@shipfox/workflow-document';
import {z} from 'zod';
import {type CustomAgentModelDto, customAgentModelSchema} from './custom-model-provider.js';
import {managedModelCompatSchema, managedModelThinkingLevelMapSchema} from './pi-model.js';

export {
  type ManagedModelCompat,
  type ManagedModelThinkingLevel,
  type ManagedModelThinkingLevelMap,
  managedModelCompatSchema,
  managedModelThinkingLevelMapSchema,
  managedModelThinkingLevelSchema,
} from './pi-model.js';

export const managedModelApiSchema = z.enum([
  'anthropic-messages',
  'openai-responses',
  'openai-completions',
]);

export type ManagedModelApi = z.infer<typeof managedModelApiSchema>;

export const managedModelMetadataSchema = customAgentModelSchema
  .omit({
    id: true,
    label: true,
    thinking_level_map: true,
    compat: true,
  })
  .extend({
    claudeModelId: z.string().min(1).max(128).optional(),
    thinkingLevelMap: managedModelThinkingLevelMapSchema.optional(),
    thinking_level_map: managedModelThinkingLevelMapSchema.optional(),
    compat: managedModelCompatSchema.optional(),
  })
  .superRefine((model, ctx) => {
    if (model.thinkingLevelMap !== undefined && model.thinking_level_map !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['thinkingLevelMap'],
        message: 'Use either thinkingLevelMap or thinking_level_map, not both.',
      });
    }
  });

export type ManagedModelMetadata = z.infer<typeof managedModelMetadataSchema>;

/**
 * Optional model metadata passed through to Pi's custom-provider adapter.
 * Omitted properties retain the adapter's defaults.
 */
export interface ManagedModelEntry extends Readonly<ManagedModelMetadata> {
  readonly id: string;
  readonly label: string;
  readonly api: ManagedModelApi;
}

export function toCustomAgentModelDto(
  model: Pick<ManagedModelEntry, 'id' | 'label'> & ManagedModelMetadata,
): CustomAgentModelDto {
  const {
    claudeModelId: _claudeModelId,
    thinkingLevelMap,
    thinking_level_map,
    ...metadata
  } = managedModelMetadataSchema.parse(model);
  const normalizedThinkingLevelMap = thinkingLevelMap ?? thinking_level_map;

  return {
    id: model.id,
    label: model.label,
    ...metadata,
    ...(normalizedThinkingLevelMap === undefined
      ? {}
      : {thinking_level_map: normalizedThinkingLevelMap}),
  };
}

/**
 * Lease-scoped credentials and endpoint returned by a managed provider.
 *
 * `baseUrl` is the provider's gateway mount root, including any deployment
 * path prefix but not a client-specific API path, query, or fragment. The
 * agent runtime normalizes this root for the client API family before handing
 * it to a harness client.
 */
export interface ManagedProviderRuntimeConfig {
  readonly api: ManagedModelApi;
  /** Gateway mount root, including path prefixes but no client API path, query, or fragment. */
  readonly baseUrl: string;
  readonly credentials: Record<string, string>;
}

export interface ManagedModelProvider {
  readonly id: string;
  readonly label: string;
  readonly models: readonly ManagedModelEntry[];
  readonly defaultModel: string;
  readonly defaultThinking?: AgentThinking | undefined;
  readonly resolveCredentials: (params: {
    workspaceId: string;
    runId: string;
    stepAttemptId: string;
    model: string;
  }) => Promise<ManagedProviderRuntimeConfig>;
}
