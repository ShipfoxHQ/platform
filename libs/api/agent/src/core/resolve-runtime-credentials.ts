import type {
  AgentRuntimeCredentialsResponseDto,
  AgentThinking,
  Harness,
  ManagedModelProvider,
  ManagedProviderRuntimeConfig,
  ModelProviderRef,
  SupportedModelProviderId,
  WorkspaceProvidersPolicy,
} from '@shipfox/api-agent-dto';
import {toCustomAgentModelDto} from '@shipfox/api-agent-dto';
import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {config, workspaceProvidersPolicy} from '#config.js';
import {getModelProviderConfig} from '#db/index.js';
import {agentRuntimeConfigResolvedCount} from '#metrics/index.js';
import {
  agentSystemNamespace,
  storeValuesToCustomRuntimeCredentials,
  storeValuesToRuntimeCredentials,
} from './credential-fingerprints.js';
import type {ModelProviderConfig} from './entities/model-provider-config.js';
import {ModelProviderConfigNotFoundError, WorkspaceProvidersDisabledError} from './errors.js';
import {managedProviderAdapterBaseUrl} from './managed-provider-url.js';
import {getModelProviderEntry, modelProviderCredentialKeysMatch} from './model-provider-policy.js';
import {type AgentSecretsClient, requireAgentSecretsClient} from './secrets-client.js';

export interface ResolveRuntimeCredentialsParams {
  workspaceId: string;
  runId: string;
  stepAttemptId: string;
  projectId?: string | undefined;
  jobId?: string | undefined;
  jobExecutionId?: string | undefined;
  stepId?: string | undefined;
  attempt?: number | undefined;
  harness: Harness;
  provider: ModelProviderRef;
  model: string;
  thinking: AgentThinking;
}

interface RuntimeCredentialsConfig {
  AGENT_DEFAULT_PROVIDER?: ModelProviderRef | undefined;
  AGENT_DEFAULT_PROVIDER_API_KEY?: string | undefined;
}

interface ResolveRuntimeCredentialsOptions {
  runtimeConfig?: RuntimeCredentialsConfig | undefined;
  workspaceProviders?: WorkspaceProvidersPolicy | undefined;
  secrets?: AgentSecretsClient | undefined;
  managedProvider?: ManagedModelProvider | undefined;
  getCredentialBag?:
    | ((params: {workspaceId: string; namespace: string}) => Promise<Record<string, string>>)
    | undefined;
}

export async function resolveRuntimeCredentials(
  params: ResolveRuntimeCredentialsParams,
  options?: ResolveRuntimeCredentialsOptions,
): Promise<AgentRuntimeCredentialsResponseDto> {
  const runtimeConfig = options?.runtimeConfig ?? config;
  const configuredWorkspaceProviders = options?.workspaceProviders ?? workspaceProvidersPolicy;
  const managedProvider = options?.managedProvider;
  const managedResponse = await resolveManagedCredentials(params, managedProvider);
  if (managedResponse !== undefined) return managedResponse;

  if (configuredWorkspaceProviders === 'disabled') {
    throwWorkspaceProviderUnavailable(params, runtimeConfig, managedProvider);
  }

  const providerConfig = await getModelProviderConfig({
    workspaceId: params.workspaceId,
    providerId: params.provider,
  });

  const workspaceResponse = await resolveWorkspaceCredentials(params, providerConfig, options);
  if (workspaceResponse !== undefined) return workspaceResponse;

  const instanceCredentials = instanceFallbackCredentials(params.provider, runtimeConfig);
  if (instanceCredentials) {
    agentRuntimeConfigResolvedCount.add(1, {source: 'instance', outcome: 'resolved'});
    return toResponse(params, instanceCredentials);
  }

  agentRuntimeConfigResolvedCount.add(1, {
    source: params.provider === runtimeConfig.AGENT_DEFAULT_PROVIDER ? 'instance' : 'workspace',
    outcome: 'unavailable',
  });
  throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
}

async function resolveManagedCredentials(
  params: ResolveRuntimeCredentialsParams,
  managedProvider: ManagedModelProvider | undefined,
): Promise<AgentRuntimeCredentialsResponseDto | undefined> {
  if (managedProvider?.id !== params.provider) return undefined;
  const managedRuntimeConfig = await managedProvider.resolveCredentials({
    workspaceId: params.workspaceId,
    runId: params.runId,
    stepAttemptId: params.stepAttemptId,
    ...(params.projectId === undefined ? {} : {projectId: params.projectId}),
    ...(params.jobId === undefined ? {} : {jobId: params.jobId}),
    ...(params.jobExecutionId === undefined ? {} : {jobExecutionId: params.jobExecutionId}),
    ...(params.stepId === undefined ? {} : {stepId: params.stepId}),
    ...(params.attempt === undefined ? {} : {attempt: params.attempt}),
    model: params.model,
  });
  agentRuntimeConfigResolvedCount.add(1, {source: 'instance', outcome: 'resolved'});
  return toResponse(params, managedRuntimeConfig.credentials, undefined, {
    provider: managedProvider,
    runtimeConfig: managedRuntimeConfig,
  });
}

function throwWorkspaceProviderUnavailable(
  params: ResolveRuntimeCredentialsParams,
  runtimeConfig: RuntimeCredentialsConfig,
  managedProvider: ManagedModelProvider | undefined,
): never {
  agentRuntimeConfigResolvedCount.add(1, {
    source: params.provider === runtimeConfig.AGENT_DEFAULT_PROVIDER ? 'instance' : 'workspace',
    outcome: 'unavailable',
  });
  if (managedProvider !== undefined) throw new WorkspaceProvidersDisabledError(managedProvider.id);
  throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
}

async function readWorkspaceCredentialValues(
  params: ResolveRuntimeCredentialsParams,
  options: ResolveRuntimeCredentialsOptions | undefined,
): Promise<Record<string, string>> {
  if (options?.getCredentialBag) {
    return await options.getCredentialBag({
      workspaceId: params.workspaceId,
      namespace: agentSystemNamespace(params.provider),
    });
  }
  return (
    await requireAgentSecretsClient(options?.secrets).getSecretsByNamespace({
      workspaceId: params.workspaceId,
      namespace: agentSystemNamespace(params.provider),
    })
  ).values;
}

function workspaceCredentialsResponse(
  params: ResolveRuntimeCredentialsParams,
  providerConfig: ModelProviderConfig,
  values: Record<string, string>,
): AgentRuntimeCredentialsResponseDto {
  if (providerConfig.kind === 'custom') {
    return toResponse(params, storeValuesToCustomRuntimeCredentials(values), providerConfig);
  }
  const providerId = params.provider as SupportedModelProviderId;
  const credentials = storeValuesToRuntimeCredentials(providerId, values);
  if (!modelProviderCredentialKeysMatch(providerId, credentials)) {
    throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
  }
  return toResponse(params, credentials, providerConfig);
}

async function resolveWorkspaceCredentials(
  params: ResolveRuntimeCredentialsParams,
  providerConfig: ModelProviderConfig | undefined,
  options: ResolveRuntimeCredentialsOptions | undefined,
): Promise<AgentRuntimeCredentialsResponseDto | undefined> {
  if (!providerConfig) return undefined;
  try {
    const values = await readWorkspaceCredentialValues(params, options);
    const response = workspaceCredentialsResponse(params, providerConfig, values);
    agentRuntimeConfigResolvedCount.add(1, {source: 'workspace', outcome: 'resolved'});
    return response;
  } catch (error) {
    if (isInterModuleKnownError(secretsInterModuleContract.methods.getSecretsByNamespace, error)) {
      agentRuntimeConfigResolvedCount.add(1, {source: 'workspace', outcome: 'decryption_failed'});
    }
    throw error;
  }
}

export function getInstanceDefaultModelProviderApiKeyField(
  providerId: ModelProviderRef,
): 'api_key' | undefined {
  const credentialFields =
    getModelProviderEntry(providerId as SupportedModelProviderId)?.credential_fields ?? [];
  const field = credentialFields[0];
  if (credentialFields.length !== 1 || field?.key !== 'api_key' || !field.secret) {
    return undefined;
  }
  return 'api_key';
}

function instanceFallbackCredentials(
  providerId: ModelProviderRef,
  runtimeConfig: RuntimeCredentialsConfig,
): Record<string, string> | undefined {
  const instanceApiKey = runtimeConfig.AGENT_DEFAULT_PROVIDER_API_KEY;
  if (providerId !== runtimeConfig.AGENT_DEFAULT_PROVIDER || !instanceApiKey) return undefined;

  const fieldKey = getInstanceDefaultModelProviderApiKeyField(providerId);
  if (!fieldKey) return undefined;

  return {[fieldKey]: instanceApiKey};
}

function toResponse(
  params: ResolveRuntimeCredentialsParams,
  credentials: Record<string, string>,
  providerConfig?: ModelProviderConfig | undefined,
  managed?:
    | {
        provider: ManagedModelProvider;
        runtimeConfig: ManagedProviderRuntimeConfig;
      }
    | undefined,
): AgentRuntimeCredentialsResponseDto {
  const managedModel = managed?.provider.models.find((candidate) => candidate.id === params.model);
  const runtimeModel =
    params.harness === 'claude' ? (managedModel?.claudeModelId ?? params.model) : params.model;
  const response: AgentRuntimeCredentialsResponseDto = {
    harness: params.harness,
    provider_id: params.provider,
    model: runtimeModel,
    thinking: params.thinking,
    credentials,
  };

  appendCustomProviderResponse(response, providerConfig, credentials);
  appendManagedProviderResponse(response, params, managed, managedModel);
  return response;
}

function appendCustomProviderResponse(
  response: AgentRuntimeCredentialsResponseDto,
  providerConfig: ModelProviderConfig | undefined,
  credentials: Record<string, string>,
): void {
  if (providerConfig?.kind !== 'custom') return;
  response.custom_provider = {
    api: providerConfig.api ?? 'openai-responses',
    base_url: providerConfig.baseUrl ?? '',
    headers: providerConfig.headers ?? [],
    secret_header_names: Object.keys(credentials)
      .filter((key) => key.startsWith('header:'))
      .map((key) => key.slice('header:'.length))
      .sort(),
    models: providerConfig.models ?? [],
    requires_api_key: providerConfig.requiresApiKey,
  };
}

function appendManagedProviderResponse(
  response: AgentRuntimeCredentialsResponseDto,
  params: ResolveRuntimeCredentialsParams,
  managed:
    | {provider: ManagedModelProvider; runtimeConfig: ManagedProviderRuntimeConfig}
    | undefined,
  managedModel: ManagedModelProvider['models'][number] | undefined,
): void {
  if (managed === undefined) return;
  const modelDescriptor = toCustomAgentModelDto(
    managedModel ?? {id: params.model, label: params.model},
  );
  const clientApi = params.harness === 'claude' ? 'anthropic-messages' : managed.runtimeConfig.api;
  if (params.harness === 'pi') {
    response.custom_provider = {
      api: managed.runtimeConfig.api,
      base_url: managedProviderAdapterBaseUrl(clientApi, managed.runtimeConfig.baseUrl),
      headers: [],
      secret_header_names: [],
      models: [modelDescriptor],
      requires_api_key: true,
    };
    return;
  }
  const authToken = managed.runtimeConfig.credentials.api_key;
  if (authToken === undefined) {
    throw new ModelProviderConfigNotFoundError(params.workspaceId, params.provider);
  }
  response.claude = {
    base_url: managedProviderAdapterBaseUrl(clientApi, managed.runtimeConfig.baseUrl),
    auth_token: authToken,
  };
}
