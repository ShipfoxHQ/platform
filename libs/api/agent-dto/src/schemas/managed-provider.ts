import type {AgentThinking} from '@shipfox/workflow-document';
import {z} from 'zod';
import {type CustomAgentModelDto, customAgentModelSchema} from './custom-model-provider.js';

export const managedModelApiSchema = z.enum([
  'anthropic-messages',
  'openai-responses',
  'openai-completions',
]);

export type ManagedModelApi = z.infer<typeof managedModelApiSchema>;

export const managedModelMetadataSchema = customAgentModelSchema.omit({
  id: true,
  label: true,
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
  return {
    id: model.id,
    label: model.label,
    ...managedModelMetadataSchema.parse(model),
  };
}

export interface ManagedProviderRuntimeConfig {
  readonly api: ManagedModelApi;
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
