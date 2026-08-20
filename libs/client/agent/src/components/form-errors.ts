import {ApiError} from '@shipfox/client-api';

export type ModelProviderConfigFormErrorMapping =
  | {kind: 'form'; message: string}
  | {kind: 'field'; field: 'slug' | 'base_url' | 'default_model'; message: string};

type ModelProviderErrorDetails = {
  message?: unknown;
  provider_id?: unknown;
  expected_keys?: unknown;
  reason?: unknown;
  target?: unknown;
  cap?: unknown;
  details?: unknown;
};

export function modelProviderConfigErrorToFormError(
  error: unknown,
): ModelProviderConfigFormErrorMapping {
  if (error instanceof ApiError) {
    return {kind: 'form', message: apiErrorMessage(error)};
  }
  if (error instanceof Error) {
    return {kind: 'form', message: error.message};
  }
  return {kind: 'form', message: 'Something went wrong. Try again.'};
}

function apiErrorMessage(error: ApiError): string {
  const details = modelProviderErrorDetails(error.details);

  if (error.code === 'provider-validation-failed') {
    return typeof details.message === 'string' ? details.message : error.message;
  }
  if (error.code === 'invalid-credential-fields') {
    const expectedKeys = Array.isArray(details.expected_keys)
      ? details.expected_keys.filter((key): key is string => typeof key === 'string')
      : [];
    if (expectedKeys.length > 0) {
      return `Credentials must include exactly these fields: ${expectedKeys.join(', ')}.`;
    }
    return 'Credentials do not match the fields required by this provider.';
  }
  if (error.code === 'invalid-agent-model') {
    return 'Choose a model from the models list.';
  }
  if (error.code === 'slug-collision') {
    return 'A provider with this id already exists in this workspace.';
  }
  if (error.code === 'egress-denied') {
    const target = typeof details.target === 'string' ? details.target : undefined;
    const reason = typeof details.reason === 'string' ? details.reason : undefined;
    const prefix = target && reason ? `Requests to ${target} are blocked (${reason}). ` : '';
    return `${prefix}On Shipfox Cloud the endpoint must be reachable from the internet. Use a public HTTPS URL for hosted providers.`;
  }
  if (error.code === 'invalid-header-keep') {
    return 'A kept secret header no longer exists - re-enter its value.';
  }
  if (error.code === 'stored-secret-base-url-changed') {
    return 'Re-enter stored secret values before testing against a different base URL.';
  }
  if (error.code === 'not-found') {
    return 'This custom provider no longer exists. Refresh and try again.';
  }
  if (error.code === 'workspace-secret-cap-exceeded') {
    return typeof details.cap === 'number'
      ? `This workspace has reached its secrets limit of ${details.cap}.`
      : 'This workspace has reached its secrets limit.';
  }
  if (error.code === 'value-too-large') {
    return 'A key or header value is too large to store.';
  }
  if (error.code === 'provider-unsupported') {
    return 'This provider is not supported for workspace-managed credentials.';
  }
  if (error.code === 'provider-not-configured') {
    return 'Configure this provider before setting it as the default.';
  }
  if (error.code === 'workspace-providers-disabled') {
    return typeof details.message === 'string' ? details.message : error.message;
  }
  return error.message;
}

export function modelProviderConfigErrorField(error: unknown): ModelProviderConfigFormErrorMapping {
  const mapping = modelProviderConfigErrorToFormError(error);
  if (!(error instanceof ApiError)) return mapping;
  if (error.code === 'slug-collision') return {...mapping, kind: 'field', field: 'slug'};
  if (error.code === 'egress-denied') return {...mapping, kind: 'field', field: 'base_url'};
  if (error.code === 'invalid-agent-model')
    return {...mapping, kind: 'field', field: 'default_model'};
  if (error.code === 'stored-secret-base-url-changed')
    return {...mapping, kind: 'field', field: 'base_url'};
  return mapping;
}

function modelProviderErrorDetails(rawDetails: unknown): ModelProviderErrorDetails {
  if (typeof rawDetails !== 'object' || rawDetails === null) return {};

  const payload = rawDetails as ModelProviderErrorDetails;
  if (typeof payload.details === 'object' && payload.details !== null) {
    return payload.details as ModelProviderErrorDetails;
  }
  return payload;
}
