import {
  agentThinkingSchema,
  buildHarnessToolDeploymentConfig,
  isReservedModelProviderId,
  type ManagedModelProvider,
  managedModelApiSchema,
  modelProviderRefSchema,
  SUPPORTED_MODEL_PROVIDER_IDS,
  type WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {bool, createConfig, num, str} from '@shipfox/config';
import {WorkspaceProvidersDisabledError} from '#core/errors.js';
import {getModelProviderEntry} from '#core/model-provider-policy.js';

const AGENT_THINKING_CHOICES = agentThinkingSchema.options;
const SUPPORTED_PROVIDER_IDS_DESCRIPTION = SUPPORTED_MODEL_PROVIDER_IDS.join(', ');

export const config = createConfig({
  AGENT_WORKSPACE_PROVIDERS: str({
    desc: 'Controls whether workspaces can configure model providers. Use enabled to preserve the default workspace provider behavior, or disabled when the injected managed provider is the only provider for this instance.',
    choices: ['enabled', 'disabled'],
    default: 'enabled',
  }),
  AGENT_DEFAULT_PROVIDER: str({
    desc: `Instance-wide default model provider ID used when a workflow and workspace do not choose one. Optional. Use one of the supported model catalog IDs (${SUPPORTED_PROVIDER_IDS_DESCRIPTION}) or the injected managed provider.`,
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_MODEL: str({
    desc: 'Instance-wide default model ID used when the resolved provider matches AGENT_DEFAULT_PROVIDER and no workflow or workspace model is set. Optional. Use a model ID supported by that provider.',
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_THINKING: str({
    desc: 'Instance-wide default thinking effort used when the resolved provider matches AGENT_DEFAULT_PROVIDER and no workflow or workspace thinking effort is set. Optional. Accepted values are off, minimal, low, medium, high, and xhigh.',
    choices: AGENT_THINKING_CHOICES,
    default: undefined,
  }),
  AGENT_DEFAULT_PROVIDER_API_KEY: str({
    desc: 'API key for the instance default provider. Optional. Must belong to AGENT_DEFAULT_PROVIDER. If you change the default provider, change this key too. Instance defaults support API-key-only providers.',
    default: undefined,
  }),
  AGENT_PROVIDER_VALIDATION_TIMEOUT_MS: num({
    desc: 'Maximum time in milliseconds to wait for the live provider test request when saving credentials.',
    default: 10000,
  }),
  AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS: bool({
    desc: 'Allows custom model providers to use private, loopback, link-local, metadata, and .internal network targets. Keep this true for local development and self-hosted private networks. Set it to false on cloud instances.',
    default: true,
  }),
  AGENT_CUSTOM_PROVIDER_HOST_DENYLIST: str({
    desc: 'Comma-separated hosts and IP ranges that custom model providers may not call. Accepts exact hosts, suffix patterns such as .internal.example or *.internal.example, IP literals, and CIDR blocks such as 10.0.0.0/8.',
    default: '',
  }),
  AGENT_PI_ENABLED_TOOL_PACKAGES: str({
    desc: 'Comma-separated optional Pi tool packages enabled for this deployment. Defaults to pi-web-access so Pi web access is available. Set it to an empty value to enable only Pi built-in tools. Accepted values: pi-web-access.',
    default: 'pi-web-access',
  }),
  AGENT_PI_WEB_SEARCH_ENABLED: bool({
    desc: 'Enables Pi web search tools when pi-web-access is enabled. Set it to false to disable web_search and get_search_content while keeping fetch_content available.',
    default: true,
  }),
});

export const workspaceProvidersPolicy =
  config.AGENT_WORKSPACE_PROVIDERS as WorkspaceProvidersPolicy;

export const harnessToolDeploymentConfig = buildHarnessToolDeploymentConfig({
  piEnabledToolPackages: config.AGENT_PI_ENABLED_TOOL_PACKAGES,
  piWebSearchEnabled: config.AGENT_PI_WEB_SEARCH_ENABLED,
});

export function assertAgentConfig(managedProvider?: ManagedModelProvider): void {
  if (managedProvider !== undefined) assertManagedProvider(managedProvider);

  if (workspaceProvidersPolicy === 'disabled') {
    if (managedProvider === undefined) {
      throw new Error(
        'AGENT_WORKSPACE_PROVIDERS=disabled requires an injected managed model provider.',
      );
    }
    if (
      config.AGENT_DEFAULT_PROVIDER !== undefined &&
      config.AGENT_DEFAULT_PROVIDER !== managedProvider.id
    ) {
      throw new WorkspaceProvidersDisabledError(managedProvider.id);
    }
  }

  const defaultProvider = config.AGENT_DEFAULT_PROVIDER;
  if (defaultProvider !== undefined && !isRegisteredProvider(defaultProvider, managedProvider)) {
    throw new Error(
      `AGENT_DEFAULT_PROVIDER must name a supported registered provider: ${defaultProvider}.`,
    );
  }

  if (!config.AGENT_DEFAULT_PROVIDER_API_KEY) return;
  if (!defaultProvider) {
    throw new Error('AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER to be set.');
  }
  if (managedProvider?.id === defaultProvider) {
    throw new Error('AGENT_DEFAULT_PROVIDER_API_KEY cannot be used with a managed model provider.');
  }

  const credentialFields = getModelProviderEntry(defaultProvider)?.credential_fields ?? [];
  const field = credentialFields[0];
  if (credentialFields.length === 1 && field?.key === 'api_key' && field.secret) return;

  throw new Error(
    'AGENT_DEFAULT_PROVIDER_API_KEY requires AGENT_DEFAULT_PROVIDER to use exactly one secret api_key credential field.',
  );
}

function isRegisteredProvider(
  providerId: string,
  managedProvider: ManagedModelProvider | undefined,
): boolean {
  if (managedProvider?.id === providerId) return true;
  return getModelProviderEntry(providerId)?.support_status === 'supported';
}

function assertManagedProvider(provider: ManagedModelProvider): void {
  if (!modelProviderRefSchema.safeParse(provider.id).success) {
    throw new Error(`Managed model provider ID must be a valid provider slug: ${provider.id}.`);
  }
  if (isReservedModelProviderId(provider.id)) {
    throw new Error(`Managed model provider ID is reserved: ${provider.id}.`);
  }
  if (provider.label.length === 0) {
    throw new Error(`Managed model provider label must not be empty: ${provider.id}.`);
  }
  if (provider.models.length === 0) {
    throw new Error(`Managed model provider must define at least one model: ${provider.id}.`);
  }

  const modelIds = new Set<string>();
  for (const model of provider.models) {
    if (model.id.length === 0 || model.label.length === 0) {
      throw new Error(`Managed model provider models must have IDs and labels: ${provider.id}.`);
    }
    if (modelIds.has(model.id)) {
      throw new Error(`Managed model provider models must have unique IDs: ${provider.id}.`);
    }
    modelIds.add(model.id);
    if (!managedModelApiSchema.safeParse(model.api).success) {
      throw new Error(`Managed model provider model API is invalid: ${provider.id}/${model.id}.`);
    }
  }

  if (!modelIds.has(provider.defaultModel)) {
    throw new Error(`Managed model provider default model is not registered: ${provider.id}.`);
  }
  if (
    provider.defaultThinking !== undefined &&
    !agentThinkingSchema.safeParse(provider.defaultThinking).success
  ) {
    throw new Error(`Managed model provider default thinking is invalid: ${provider.id}.`);
  }
  if (typeof provider.resolveCredentials !== 'function') {
    throw new Error(`Managed model provider must resolve credentials: ${provider.id}.`);
  }
}
