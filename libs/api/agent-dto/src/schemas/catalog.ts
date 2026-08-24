import {
  agentThinkingByHarness,
  agentThinkingSchema,
  claudeAgentThinkingSchema,
  DEFAULT_AGENT_THINKING,
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  harnessSchema,
  piAgentThinkingSchema,
  thinkingLevelsForHarness,
} from '@shipfox/workflow-document';
import {z} from 'zod';
import {managedModelApiSchema} from './managed-provider.js';
import {
  type ModelProviderId,
  modelProviderRefSchema,
  providerIdSchema,
  SUPPORTED_MODEL_PROVIDER_IDS,
  type SupportedModelProviderId,
  UNSUPPORTED_MODEL_PROVIDER_IDS,
} from './model-provider-id.js';

export type {AgentThinking, Harness} from '@shipfox/workflow-document';
export {
  agentThinkingByHarness,
  agentThinkingSchema,
  claudeAgentThinkingSchema,
  DEFAULT_AGENT_THINKING,
  DEFAULT_HARNESS,
  DEFAULT_MODEL_PROVIDER,
  harnessSchema,
  piAgentThinkingSchema,
  thinkingLevelsForHarness,
};

export const agentModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  api: managedModelApiSchema.optional(),
});

export type AgentModelOptionDto = z.infer<typeof agentModelOptionSchema>;

export const modelProviderCredentialFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  secret: z.boolean(),
});

export type ModelProviderCredentialFieldDto = z.infer<typeof modelProviderCredentialFieldSchema>;

export const modelProviderSupportStatusSchema = z.enum(['supported', 'unsupported']);

export type ModelProviderSupportStatus = z.infer<typeof modelProviderSupportStatusSchema>;

export const workspaceProvidersPolicySchema = z.enum(['enabled', 'disabled']);

export type WorkspaceProvidersPolicy = z.infer<typeof workspaceProvidersPolicySchema>;

const supportedModelProviderIds = new Set<string>(SUPPORTED_MODEL_PROVIDER_IDS);
const unsupportedModelProviderIds = new Set<string>(UNSUPPORTED_MODEL_PROVIDER_IDS);

const modelProviderCatalogSeedBaseSchema = z.object({
  id: providerIdSchema,
  label: z.string().min(1),
  support_status: modelProviderSupportStatusSchema,
  default_model: z.string().min(1).nullable(),
  credential_fields: z.array(modelProviderCredentialFieldSchema),
  unsupported_reason: z.string().min(1).nullable(),
});

export const modelProviderCatalogSeedSchema =
  modelProviderCatalogSeedBaseSchema.superRefine(validateCatalogSeedEntry);

export type ModelProviderCatalogSeedDto = z.infer<typeof modelProviderCatalogSeedSchema>;

const modelProviderCatalogEntryBaseSchema = z.object({
  id: modelProviderRefSchema,
  label: z.string().min(1),
  support_status: modelProviderSupportStatusSchema,
  default_model: z.string().min(1).nullable(),
  credential_fields: z.array(modelProviderCredentialFieldSchema),
  unsupported_reason: z.string().min(1).nullable(),
});

export const modelProviderCatalogEntrySchema = modelProviderCatalogEntryBaseSchema
  .extend({
    models: z.array(agentModelOptionSchema),
  })
  .superRefine((entry, ctx) => {
    const seedId = providerIdSchema.safeParse(entry.id);
    if (seedId.success) {
      validateCatalogSeedEntry({...entry, id: seedId.data}, ctx);
    }

    if (entry.support_status === 'supported') {
      if (entry.models.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['models'],
          message: 'Supported model providers must include at least one model.',
        });
      }
      if (
        entry.default_model !== null &&
        !entry.models.some((model) => model.id === entry.default_model)
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['default_model'],
          message: 'Supported model provider default_model must be present in models.',
        });
      }
    } else if (entry.models.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['models'],
        message: 'Unsupported model providers must not include models.',
      });
    }
  });

export type ModelProviderCatalogEntryDto = z.infer<typeof modelProviderCatalogEntrySchema>;

export const modelProviderCatalogResponseSchema = z.object({
  providers: z.array(modelProviderCatalogEntrySchema),
  workspace_providers: workspaceProvidersPolicySchema.optional(),
  managed_provider_id: modelProviderRefSchema.nullable().default(null),
  instance_default_provider_id: modelProviderRefSchema.nullable().default(null),
});

export type ModelProviderCatalogResponseDto = z.infer<typeof modelProviderCatalogResponseSchema>;

const apiKeyCredentialFields = [credentialField('api_key', 'API key', true)];

const azureCredentialFields = [
  credentialField('endpoint', 'Endpoint', false),
  credentialField('api_key', 'API key', true),
];

const cloudflareAiGatewayCredentialFields = [
  credentialField('api_key', 'API token', true),
  credentialField('account_id', 'Account ID', false),
  credentialField('gateway_id', 'Gateway ID', false),
];

const cloudflareWorkersAiCredentialFields = [
  credentialField('api_key', 'API token', true),
  credentialField('account_id', 'Account ID', false),
];

export const MODEL_PROVIDER_CATALOG_SEED: ModelProviderCatalogSeedDto[] = [
  supportedProvider('anthropic', 'Anthropic', 'claude-opus-4-8'),
  supportedProvider('ant-ling', 'Ant Ling', 'Ring-2.6-1T'),
  supportedProvider('azure-openai-responses', 'Azure OpenAI', 'gpt-5.5-pro', azureCredentialFields),
  supportedProvider('openai', 'OpenAI', 'gpt-5.5-pro'),
  supportedProvider('deepseek', 'DeepSeek', 'deepseek-v4-pro'),
  supportedProvider('nvidia', 'NVIDIA', 'nvidia/nemotron-3-ultra-550b-a55b'),
  supportedProvider('google', 'Google AI Studio', 'gemini-3.1-pro-preview'),
  supportedProvider('mistral', 'Mistral', 'mistral-large-latest'),
  supportedProvider('groq', 'Groq', 'openai/gpt-oss-120b'),
  supportedProvider('cerebras', 'Cerebras', 'gpt-oss-120b'),
  supportedProvider(
    'cloudflare-ai-gateway',
    'Cloudflare AI Gateway',
    'claude-opus-4-8',
    cloudflareAiGatewayCredentialFields,
  ),
  supportedProvider(
    'cloudflare-workers-ai',
    'Cloudflare Workers AI',
    '@cf/moonshotai/kimi-k2.7-code',
    cloudflareWorkersAiCredentialFields,
  ),
  supportedProvider('xai', 'xAI', 'grok-4.3'),
  supportedProvider('openrouter', 'OpenRouter', 'anthropic/claude-opus-4.8'),
  supportedProvider('vercel-ai-gateway', 'Vercel AI Gateway', 'anthropic/claude-opus-4.8'),
  supportedProvider('zai', 'Z.ai', 'glm-5.2'),
  supportedProvider('zai-coding-cn', 'Z.ai Coding CN', 'glm-5.2'),
  supportedProvider('opencode', 'OpenCode', 'claude-opus-4-8'),
  supportedProvider('opencode-go', 'OpenCode Go', 'kimi-k2.7-code'),
  supportedProvider('huggingface', 'Hugging Face', 'deepseek-ai/DeepSeek-V4-Pro'),
  supportedProvider('fireworks', 'Fireworks', 'accounts/fireworks/models/deepseek-v4-pro'),
  supportedProvider('together', 'Together AI', 'deepseek-ai/DeepSeek-V4-Pro'),
  supportedProvider('kimi-coding', 'Kimi Coding', 'kimi-for-coding'),
  supportedProvider('qwen-token-plan', 'Qwen Token Plan', 'qwen3.8-max-preview'),
  supportedProvider('qwen-token-plan-cn', 'Qwen Token Plan CN', 'qwen3.8-max-preview'),
  supportedProvider('minimax', 'MiniMax', 'MiniMax-M3'),
  supportedProvider('minimax-cn', 'MiniMax CN', 'MiniMax-M3'),
  supportedProvider('moonshotai', 'Moonshot AI', 'kimi-k2.7-code'),
  supportedProvider('moonshotai-cn', 'Moonshot AI CN', 'kimi-k2.7-code'),
  supportedProvider('xiaomi', 'Xiaomi', 'mimo-v2.5-pro'),
  supportedProvider('xiaomi-token-plan-cn', 'Xiaomi Token Plan CN', 'mimo-v2.5-pro'),
  supportedProvider('xiaomi-token-plan-ams', 'Xiaomi Token Plan AMS', 'mimo-v2.5-pro'),
  supportedProvider('xiaomi-token-plan-sgp', 'Xiaomi Token Plan SGP', 'mimo-v2.5-pro'),
  unsupportedProvider(
    'amazon-bedrock',
    'Amazon Bedrock',
    'AWS cloud credentials are not supported by workspace API-key provider configs yet.',
  ),
  unsupportedProvider(
    'google-vertex',
    'Google Vertex AI',
    'GCP cloud credentials are not supported by workspace API-key provider configs yet.',
  ),
  unsupportedProvider(
    'openai-codex',
    'OpenAI Codex',
    'ChatGPT subscription and OAuth credentials are not supported by workspace API-key provider configs yet.',
  ),
  unsupportedProvider(
    'github-copilot',
    'GitHub Copilot',
    'GitHub Copilot OAuth credentials are not supported by workspace API-key provider configs yet.',
  ),
];

export function getModelProviderEntry(id: string): ModelProviderCatalogSeedDto | undefined {
  return MODEL_PROVIDER_CATALOG_SEED.find((entry) => entry.id === id);
}

export function listSupportedModelProviders(): ModelProviderCatalogSeedDto[] {
  return MODEL_PROVIDER_CATALOG_SEED.filter((entry) => entry.support_status === 'supported');
}

function validateCatalogSeedEntry(
  entry: z.infer<typeof modelProviderCatalogSeedBaseSchema>,
  ctx: z.RefinementCtx,
): void {
  if (entry.support_status === 'supported') {
    if (!supportedModelProviderIds.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Supported catalog entries must use a supported model provider id.',
      });
    }
    if (entry.default_model === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['default_model'],
        message: 'Supported model providers must define a default_model.',
      });
    }
    if (entry.credential_fields.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['credential_fields'],
        message: 'Supported model providers must define credential_fields.',
      });
    }
    if (entry.unsupported_reason !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'Supported model providers must not define unsupported_reason.',
      });
    }
  } else {
    if (!unsupportedModelProviderIds.has(entry.id)) {
      ctx.addIssue({
        code: 'custom',
        path: ['id'],
        message: 'Unsupported catalog entries must use an unsupported model provider id.',
      });
    }
    if (entry.default_model !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['default_model'],
        message: 'Unsupported model providers must not define a default_model.',
      });
    }
    if (entry.credential_fields.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['credential_fields'],
        message: 'Unsupported model providers must not define credential_fields.',
      });
    }
    if (entry.unsupported_reason === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['unsupported_reason'],
        message: 'Unsupported model providers must define unsupported_reason.',
      });
    }
  }
}

function credentialField(
  key: string,
  label: string,
  secret: boolean,
): ModelProviderCredentialFieldDto {
  return {key, label, secret};
}

function supportedProvider(
  id: SupportedModelProviderId,
  label: string,
  defaultModel: string,
  credentialFields: ModelProviderCredentialFieldDto[] = apiKeyCredentialFields,
): ModelProviderCatalogSeedDto {
  return {
    id,
    label,
    support_status: 'supported',
    default_model: defaultModel,
    credential_fields: credentialFields.map((field) => ({...field})),
    unsupported_reason: null,
  };
}

function unsupportedProvider(
  id: ModelProviderId,
  label: string,
  unsupportedReason: string,
): ModelProviderCatalogSeedDto {
  return {
    id,
    label,
    support_status: 'unsupported',
    default_model: null,
    credential_fields: [],
    unsupported_reason: unsupportedReason,
  };
}
