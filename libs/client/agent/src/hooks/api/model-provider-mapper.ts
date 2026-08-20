import type {
  CustomModelProviderConfigDto,
  ListModelProviderConfigsResponseDto,
  ModelProviderCatalogEntryDto,
  ModelProviderCatalogResponseDto,
  ModelProviderConfigDto,
  ModelProviderConfigResponseDto,
  SetDefaultHarnessResponseDto,
  SetDefaultModelProviderResponseDto,
} from '@shipfox/api-agent-dto';
import type {
  AgentModel,
  BuiltinProviderConfig,
  CustomProviderConfig,
  DefaultHarnessSelection,
  DefaultModelProviderSelection,
  ProviderCatalog,
  ProviderCatalogEntry,
  ProviderConfig,
  ProviderConfiguration,
} from '#core/models.js';

export function toProviderCatalog(response: ModelProviderCatalogResponseDto): ProviderCatalog {
  return {
    providers: response.providers.map(toProviderCatalogEntry),
    workspaceProviders: response.workspace_providers ?? 'enabled',
  };
}

export function toProviderCatalogEntry(entry: ModelProviderCatalogEntryDto): ProviderCatalogEntry {
  if (entry.support_status === 'unsupported') {
    return {
      kind: 'unsupported',
      id: entry.id,
      label: entry.label,
      unsupportedReason: entry.unsupported_reason ?? 'Unsupported provider',
    };
  }
  return {
    kind: 'supported',
    id: entry.id,
    label: entry.label,
    defaultModel: entry.default_model,
    credentialFields: entry.credential_fields.map((field) => ({
      key: field.key,
      label: field.label,
      secret: field.secret,
    })),
    models: entry.models.map(toAgentModel),
  };
}

export function toProviderConfiguration(
  response: ListModelProviderConfigsResponseDto,
): ProviderConfiguration {
  return {
    configs: response.configs.map(toProviderConfig),
    defaultHarnessId: response.default_harness_id,
    defaultProviderId: response.default_provider_id,
  };
}

export function toDefaultModelProviderSelection(
  response: SetDefaultModelProviderResponseDto,
): DefaultModelProviderSelection {
  return {defaultProviderId: response.default_provider_id};
}

export function toDefaultHarnessSelection(
  response: SetDefaultHarnessResponseDto,
): DefaultHarnessSelection {
  return {defaultHarnessId: response.default_harness_id};
}

export function toProviderConfig(config: ModelProviderConfigResponseDto): ProviderConfig {
  return config.kind === 'builtin'
    ? toBuiltinProviderConfig(config)
    : toCustomProviderConfig(config);
}

export function toBuiltinProviderConfig(config: ModelProviderConfigDto): BuiltinProviderConfig {
  return {
    kind: 'builtin',
    providerId: config.provider_id,
    defaultModel: config.default_model,
    createdAt: config.created_at,
    updatedAt: config.updated_at,
  };
}

export function toCustomProviderConfig(config: CustomModelProviderConfigDto): CustomProviderConfig {
  return {
    kind: 'custom',
    providerId: config.provider_id,
    displayName: config.display_name,
    api: config.api,
    baseUrl: config.base_url,
    headers: config.headers.map((header) => ({name: header.name, value: header.value})),
    secretHeaderNames: config.secret_header_names,
    models: config.models.map(toAgentModel),
    defaultModel: config.default_model,
    createdAt: config.created_at,
    updatedAt: config.updated_at,
  };
}

function toAgentModel(model: {
  id: string;
  label: string;
  context_window?: number | undefined;
  max_output_tokens?: number | undefined;
  input_image?: boolean | undefined;
  reasoning?: boolean | undefined;
}): AgentModel {
  return {
    id: model.id,
    label: model.label,
    ...(model.context_window === undefined ? {} : {contextWindow: model.context_window}),
    ...(model.max_output_tokens === undefined ? {} : {maxOutputTokens: model.max_output_tokens}),
    ...(model.input_image === undefined ? {} : {inputImage: model.input_image}),
    ...(model.reasoning === undefined ? {} : {reasoning: model.reasoning}),
  };
}
