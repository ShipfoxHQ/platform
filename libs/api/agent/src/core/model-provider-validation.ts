import {
  type AssistantMessage,
  type Context,
  complete,
  getModels,
  type ProviderStreamOptions,
} from '@earendil-works/pi-ai/compat';
import type {
  CustomAgentModelDto,
  ModelProviderApi,
  ModelProviderRef,
  SupportedModelProviderId,
} from '@shipfox/api-agent-dto';
import {type EgressPolicy, parseEgressHostDenylist} from '@shipfox/node-egress-guard';
import {redactSecrets, secretWireForms} from '@shipfox/redact';
import {config} from '#config.js';
import {modelProviderValidationCount} from '#metrics/index.js';
import {appendCustomProviderPath} from './custom-provider-url.js';
import {
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  ModelProviderValidationError,
  ModelProviderValidationUnavailableError,
  UnsupportedModelProviderError,
} from './errors.js';
import {getModelProviderEntry} from './model-provider-policy.js';

const PROBE_MAX_TOKENS = 64;
const MAX_SANITIZED_ERROR_LENGTH = 500;
const CUSTOM_PROBE_PROMPT = 'Reply with OK.';

export interface ProbeModelProviderCredentialsParams {
  providerId: SupportedModelProviderId;
  model: string;
  credentials: Record<string, string>;
  signal?: AbortSignal | undefined;
}

export interface ProbeCustomModelProviderCredentialsParams {
  providerId: ModelProviderRef;
  api: ModelProviderApi;
  baseUrl: string;
  model: CustomAgentModelDto;
  apiKey?: string | undefined;
  headers?: Record<string, string> | undefined;
  signal?: AbortSignal | undefined;
}

export interface RunProviderProbeParams<TArgs> {
  probe: (args: TArgs) => Promise<void>;
  args: TArgs;
  metricLabel: SupportedModelProviderId | 'custom';
  providerId: ModelProviderRef;
  secrets: string[];
  signal?: AbortSignal | undefined;
}

export async function runProviderProbe<TArgs>(
  params: RunProviderProbeParams<TArgs>,
): Promise<void> {
  try {
    await params.probe(params.args);
  } catch (error) {
    if (params.signal?.aborted) throw error;
    modelProviderValidationCount.add(1, {
      model_provider: params.metricLabel,
      outcome: 'failed',
    });
    if (error instanceof InvalidAgentModelError) throw error;

    const sanitizedMessage = sanitizeModelProviderError(error, params.secrets);
    throw new ModelProviderValidationError(params.providerId, sanitizedMessage);
  }

  modelProviderValidationCount.add(1, {
    model_provider: params.metricLabel,
    outcome: 'succeeded',
  });
}

export async function probeModelProviderCredentials(
  params: ProbeModelProviderCredentialsParams,
): Promise<void> {
  const entry = getModelProviderEntry(params.providerId);
  if (entry === undefined || entry.support_status !== 'supported') {
    throw new UnsupportedModelProviderError(params.providerId);
  }

  const model = getModels(params.providerId).find((candidate) => candidate.id === params.model);
  if (!model) throw new InvalidAgentModelError('pi', params.providerId, params.model);

  const secretField = entry.credential_fields.find((field) => field.secret);
  if (!secretField) throw new ModelProviderValidationUnavailableError(params.providerId);
  const apiKey = credentialValue(params, secretField.key);

  const context: Context = {
    messages: [
      {
        role: 'user',
        content: 'Reply with OK.',
        timestamp: Date.now(),
      },
    ],
  };
  const options: ProviderStreamOptions = {
    apiKey,
    maxTokens: PROBE_MAX_TOKENS,
    maxRetries: 0,
    timeoutMs: config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS,
    ...modelProviderCredentialOptions(params),
    ...(params.signal ? {signal: params.signal} : {}),
  };

  const result = await complete(model, context, options);
  rejectModelProviderErrorResult(result);
}

export async function probeCustomModelProviderCredentials(
  params: ProbeCustomModelProviderCredentialsParams,
): Promise<void> {
  const response = await fetch(customProbeUrl(params), {
    method: 'POST',
    headers: customProbeHeaders(params),
    body: JSON.stringify(customProbeBody(params)),
    redirect: 'error',
    signal: timeoutSignal(params.signal, config.AGENT_PROVIDER_VALIDATION_TIMEOUT_MS),
  });

  try {
    if (!response.ok) {
      throw new Error(`Provider returned HTTP ${response.status}.`);
    }
  } finally {
    await response.body?.cancel();
  }
}

export function sanitizeModelProviderError(error: unknown, secrets: string[]): string {
  const message =
    error instanceof Error && error.message.length > 0
      ? error.message
      : 'Provider validation failed.';
  const secretForms = secrets.flatMap((secret) => secretWireForms(secret));
  const redacted = redactSecrets(message, secretForms);
  return redacted.slice(0, MAX_SANITIZED_ERROR_LENGTH);
}

export function egressPolicy(): EgressPolicy {
  return {
    allowPrivateNetworks: config.AGENT_CUSTOM_PROVIDER_ALLOW_PRIVATE_NETWORKS,
    hostDenylist: parseEgressHostDenylist(config.AGENT_CUSTOM_PROVIDER_HOST_DENYLIST),
  };
}

function customProbeUrl(params: ProbeCustomModelProviderCredentialsParams): string {
  switch (params.api) {
    case 'anthropic-messages':
      return appendCustomProviderPath(params.baseUrl, 'messages').toString();
    case 'google-generative-ai':
      return appendCustomProviderPath(
        params.baseUrl,
        `models/${encodeURIComponent(params.model.id)}:generateContent`,
      ).toString();
    case 'openai-completions':
      return appendCustomProviderPath(params.baseUrl, 'chat/completions').toString();
    case 'openai-responses':
      return appendCustomProviderPath(params.baseUrl, 'responses').toString();
    default:
      return assertNever(params.api);
  }
}

function customProbeHeaders(params: ProbeCustomModelProviderCredentialsParams): Headers {
  const headers = new Headers(params.headers);
  headers.set('content-type', 'application/json');
  if (!params.apiKey) return headers;

  switch (params.api) {
    case 'anthropic-messages':
      headers.set('x-api-key', params.apiKey);
      headers.set('anthropic-version', '2023-06-01');
      break;
    case 'google-generative-ai':
      headers.set('x-goog-api-key', params.apiKey);
      break;
    case 'openai-completions':
    case 'openai-responses':
      headers.set('authorization', `Bearer ${params.apiKey}`);
      break;
    default:
      assertNever(params.api);
  }

  return headers;
}

function customProbeBody(params: ProbeCustomModelProviderCredentialsParams): unknown {
  switch (params.api) {
    case 'anthropic-messages':
      return {
        model: params.model.id,
        max_tokens: PROBE_MAX_TOKENS,
        messages: [{role: 'user', content: CUSTOM_PROBE_PROMPT}],
      };
    case 'google-generative-ai':
      return {
        contents: [{role: 'user', parts: [{text: CUSTOM_PROBE_PROMPT}]}],
        generationConfig: {maxOutputTokens: PROBE_MAX_TOKENS},
      };
    case 'openai-completions':
      return {
        model: params.model.id,
        messages: [{role: 'user', content: CUSTOM_PROBE_PROMPT}],
        max_tokens: PROBE_MAX_TOKENS,
        stream: false,
      };
    case 'openai-responses':
      return {
        model: params.model.id,
        input: CUSTOM_PROBE_PROMPT,
        max_output_tokens: PROBE_MAX_TOKENS,
        stream: false,
        store: false,
      };
    default:
      return assertNever(params.api);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unsupported custom model provider API: ${value}`);
}

function timeoutSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  return signal === undefined
    ? AbortSignal.timeout(timeoutMs)
    : AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function modelProviderCredentialOptions(
  params: Pick<ProbeModelProviderCredentialsParams, 'providerId' | 'credentials'>,
): ProviderStreamOptions {
  switch (params.providerId) {
    case 'azure-openai-responses':
      return {azureBaseUrl: credentialValue(params, 'endpoint')};
    case 'cloudflare-ai-gateway':
      return {
        env: {
          CLOUDFLARE_ACCOUNT_ID: credentialValue(params, 'account_id'),
          CLOUDFLARE_GATEWAY_ID: credentialValue(params, 'gateway_id'),
        },
      };
    case 'cloudflare-workers-ai':
      return {
        env: {
          CLOUDFLARE_ACCOUNT_ID: credentialValue(params, 'account_id'),
        },
      };
    default:
      return {};
  }
}

function credentialValue(
  params: Pick<ProbeModelProviderCredentialsParams, 'providerId' | 'credentials'>,
  key: string,
): string {
  const value = params.credentials[key];
  if (value === undefined) throw new InvalidCredentialFieldsError(params.providerId);
  return value;
}

function rejectModelProviderErrorResult(result: AssistantMessage): void {
  if (result.stopReason !== 'error' && result.stopReason !== 'aborted') return;
  throw new Error(result.errorMessage ?? 'Provider validation failed.');
}
