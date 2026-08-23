import type {AgentThinking} from '@shipfox/workflow-document';
import {z} from 'zod';

export const managedModelApiSchema = z.enum([
  'anthropic-messages',
  'openai-responses',
  'openai-completions',
]);

export type ManagedModelApi = z.infer<typeof managedModelApiSchema>;

export interface ManagedModelEntry {
  readonly id: string;
  readonly label: string;
  readonly api: ManagedModelApi;
  // Optional model metadata mirroring the custom model schema (customAgentModelSchema);
  // pi reads these fields from the custom_provider.models entry, so a managed step
  // behaves like the equivalent custom provider instead of the custom-model defaults.
  readonly context_window?: number | undefined;
  readonly max_output_tokens?: number | undefined;
  readonly reasoning?: boolean | undefined;
  readonly input_image?: boolean | undefined;
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
