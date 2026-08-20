import type {
  CustomModelProviderConfigDto,
  ListModelProviderConfigsResponseDto,
  ModelProviderCatalogEntryDto,
  ModelProviderCatalogResponseDto,
  ModelProviderConfigDto,
  WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';

export const AGENT_TEST_WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

const TEST_PROVIDER_IDS = [
  'anthropic',
  'openai',
  'deepseek',
  'nvidia',
  'google',
  'mistral',
  'groq',
  'cerebras',
  'xai',
] as const;

export function modelProviderEntry(
  overrides: Partial<ModelProviderCatalogEntryDto> = {},
): ModelProviderCatalogEntryDto {
  return {
    id: 'anthropic',
    label: 'Anthropic',
    support_status: 'supported',
    default_model: 'claude-opus-4-8',
    credential_fields: [{key: 'api_key', label: 'API key', secret: true}],
    unsupported_reason: null,
    models: [{id: 'claude-opus-4-8', label: 'Claude Opus 4.8'}],
    ...overrides,
  };
}

export function managedModelProviderEntry(
  overrides: Partial<ModelProviderCatalogEntryDto> = {},
): ModelProviderCatalogEntryDto {
  return modelProviderEntry({
    id: 'shipfox',
    label: 'Shipfox Managed',
    default_model: 'claude-opus-4-8',
    credential_fields: [],
    models: [
      {id: 'claude-opus-4-8', label: 'Claude Opus 4.8', api: 'anthropic-messages'},
      {id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', api: 'openai-responses'},
    ],
    ...overrides,
  });
}

export function unsupportedModelProviderEntry(
  overrides: Partial<ModelProviderCatalogEntryDto> = {},
): ModelProviderCatalogEntryDto {
  return {
    id: 'amazon-bedrock',
    label: 'Amazon Bedrock',
    support_status: 'unsupported',
    default_model: null,
    credential_fields: [],
    unsupported_reason: 'AWS cloud credentials are not supported yet.',
    models: [],
    ...overrides,
  };
}

export function testModelProviderEntries(count: number): ModelProviderCatalogEntryDto[] {
  return TEST_PROVIDER_IDS.slice(0, count).map((id, index) =>
    modelProviderEntry({
      id,
      label: `Provider ${index}`,
      default_model: `model-${index}`,
      models: [{id: `model-${index}`, label: `Model ${index}`}],
    }),
  );
}

export function modelProviderConfig(
  overrides: Partial<Omit<ModelProviderConfigDto, 'kind'>> = {},
): ModelProviderConfigDto {
  return {
    kind: 'builtin',
    provider_id: 'anthropic',
    default_model: null,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

export function customModelProviderConfig(
  overrides: Partial<Omit<CustomModelProviderConfigDto, 'kind'>> = {},
): CustomModelProviderConfigDto {
  return {
    kind: 'custom',
    provider_id: 'openai-compatible',
    display_name: 'OpenAI Compatible',
    base_url: 'https://models.example.test/v1',
    api: 'openai-responses',
    headers: [],
    secret_header_names: [],
    default_model: 'custom-model',
    models: [{id: 'custom-model', label: 'Custom Model'}],
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
    ...overrides,
  };
}

export function modelProviderCatalogResponse(
  modelProviders: ModelProviderCatalogEntryDto[] = [modelProviderEntry()],
  workspaceProviders?: WorkspaceProvidersPolicy,
): ModelProviderCatalogResponseDto {
  return {
    providers: modelProviders,
    ...(workspaceProviders === undefined ? {} : {workspace_providers: workspaceProviders}),
  };
}

export function modelProviderConfigsResponse(
  overrides: Partial<ListModelProviderConfigsResponseDto> = {},
): ListModelProviderConfigsResponseDto {
  return {
    configs: [modelProviderConfig()],
    default_harness_id: null,
    default_provider_id: 'anthropic',
    ...overrides,
  };
}
