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

/**
 * Static Claude model options for the built-in `anthropic` provider. This is
 * the wire shape of the Claude harness model picker; the Agent harness catalog
 * and the runner's Claude adapter read the same list so a catalog addition
 * cannot silently lose runner-side capability handling.
 */
export const CLAUDE_MODEL_LINE: AgentModelOptionDto[] = [
  {id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (latest)'},
  {id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5'},
  {id: 'claude-opus-4-1', label: 'Claude Opus 4.1 (latest)'},
  {id: 'claude-opus-4-1-20250805', label: 'Claude Opus 4.1'},
  {id: 'claude-opus-4-5', label: 'Claude Opus 4.5 (latest)'},
  {id: 'claude-opus-4-5-20251101', label: 'Claude Opus 4.5'},
  {id: 'claude-opus-4-6', label: 'Claude Opus 4.6'},
  {id: 'claude-opus-4-7', label: 'Claude Opus 4.7'},
  {id: 'claude-opus-4-8', label: 'Claude Opus 4.8'},
  {id: 'claude-opus-5', label: 'Claude Opus 5'},
  {id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (latest)'},
  {id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5'},
  {id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6'},
];

/**
 * Managed `shipfox`-provider Claude model families not exposed through the
 * built-in Claude harness picker. The runner's Claude adapter must still
 * resolve thinking capabilities for them, so they join the
 * `CLAUDE_MODEL_LINE` families in
 * `CLAUDE_MODEL_FAMILY_IDS`.
 */
export const CLAUDE_MANAGED_MODEL_FAMILY_IDS = ['claude-fable-5', 'claude-sonnet-5'] as const;

/**
 * Every Claude model family the runner's Claude adapter must resolve thinking
 * capabilities for: the `CLAUDE_MODEL_LINE` families plus
 * `CLAUDE_MANAGED_MODEL_FAMILY_IDS`. The runner keys its capability table with
 * these ids, so a capability row without a family here, or a family here
 * without a capability row, fails type checking instead of silently dropping
 * thinking control.
 */
export const CLAUDE_MODEL_FAMILY_IDS = [
  'claude-haiku-4-5',
  'claude-opus-4-1',
  'claude-opus-4-5',
  'claude-opus-4-6',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5',
  'claude-sonnet-4-5',
  'claude-sonnet-4-6',
  ...CLAUDE_MANAGED_MODEL_FAMILY_IDS,
] as const;

export type ClaudeModelFamilyId = (typeof CLAUDE_MODEL_FAMILY_IDS)[number];

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
  supportedProvider('anthropic', 'Anthropic', 'claude-opus-5'),
  supportedProvider('ant-ling', 'Ant Ling', 'Ring-2.6-1T'),
  supportedProvider('azure-openai-responses', 'Azure OpenAI', 'gpt-5.6-sol', azureCredentialFields),
  supportedProvider('baseten', 'Baseten', 'zai-org/GLM-5.2'),
  supportedProvider('openai', 'OpenAI', 'gpt-5.6-sol'),
  supportedProvider('deepseek', 'DeepSeek', 'deepseek-v4-pro'),
  supportedProvider('nvidia', 'NVIDIA', 'nvidia/nemotron-3-ultra-550b-a55b'),
  supportedProvider('google', 'Google AI Studio', 'gemini-3.1-pro-preview'),
  supportedProvider('mistral', 'Mistral', 'mistral-large-latest'),
  supportedProvider('groq', 'Groq', 'openai/gpt-oss-120b'),
  supportedProvider('cerebras', 'Cerebras', 'gpt-oss-120b'),
  supportedProvider(
    'cloudflare-ai-gateway',
    'Cloudflare AI Gateway',
    'claude-opus-5',
    cloudflareAiGatewayCredentialFields,
  ),
  supportedProvider(
    'cloudflare-workers-ai',
    'Cloudflare Workers AI',
    '@cf/moonshotai/kimi-k2.7-code',
    cloudflareWorkersAiCredentialFields,
  ),
  supportedProvider('xai', 'xAI', 'grok-4.6'),
  supportedProvider('openrouter', 'OpenRouter', 'anthropic/claude-opus-5'),
  supportedProvider('vercel-ai-gateway', 'Vercel AI Gateway', 'anthropic/claude-opus-5'),
  supportedProvider('zai', 'Z.ai', 'glm-5.3'),
  supportedProvider('zai-coding-cn', 'Z.ai Coding CN', 'glm-5.3'),
  supportedProvider('opencode', 'OpenCode', 'claude-opus-5'),
  supportedProvider('opencode-go', 'OpenCode Go', 'kimi-k3'),
  supportedProvider('huggingface', 'Hugging Face', 'deepseek-ai/DeepSeek-V4-Pro'),
  supportedProvider('fireworks', 'Fireworks', 'accounts/fireworks/models/deepseek-v4-pro'),
  supportedProvider('together', 'Together AI', 'deepseek-ai/DeepSeek-V4-Pro'),
  supportedProvider('kimi-coding', 'Kimi Coding', 'k3-256k'),
  supportedProvider('qwen-token-plan', 'Qwen Token Plan', 'qwen3.8-max'),
  supportedProvider('qwen-token-plan-cn', 'Qwen Token Plan CN', 'qwen3.8-max'),
  supportedProvider('qwen-token-plan-individual', 'Qwen Token Plan Individual', 'qwen3.8-max'),
  supportedProvider('minimax', 'MiniMax', 'MiniMax-M3'),
  supportedProvider('minimax-cn', 'MiniMax CN', 'MiniMax-M3'),
  supportedProvider('moonshotai', 'Moonshot AI', 'kimi-k3'),
  supportedProvider('moonshotai-cn', 'Moonshot AI CN', 'kimi-k3'),
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
