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

  switch (error.code) {
    case 'provider-validation-failed':
    case 'workspace-providers-disabled':
      return typeof details.message === 'string' ? details.message : error.message;
    case 'invalid-credential-fields':
      return invalidCredentialFieldsMessage(details);
    case 'invalid-agent-model':
      return 'Choose a model from the models list.';
    case 'slug-collision':
      return 'A provider with this id already exists in this workspace.';
    case 'egress-denied':
      return egressDeniedMessage(details);
    case 'invalid-header-keep':
      return 'A kept secret header no longer exists - re-enter its value.';
    case 'stored-secret-base-url-changed':
      return 'Re-enter stored secret values before testing against a different base URL.';
    case 'not-found':
      return 'This custom provider no longer exists. Refresh and try again.';
    case 'workspace-secret-cap-exceeded':
      return workspaceSecretCapMessage(details);
    case 'value-too-large':
      return 'A key or header value is too large to store.';
    case 'provider-unsupported':
      return 'This provider is not supported for workspace-managed credentials.';
    case 'provider-not-configured':
      return 'Configure this provider before setting it as the default.';
    default:
      return error.message;
  }
}

function invalidCredentialFieldsMessage(details: ModelProviderErrorDetails): string {
  const expectedKeys = Array.isArray(details.expected_keys)
    ? details.expected_keys.filter((key): key is string => typeof key === 'string')
    : [];
  if (expectedKeys.length === 0) {
    return 'Credentials do not match the fields required by this provider.';
  }
  return `Credentials must include exactly these fields: ${expectedKeys.join(', ')}.`;
}

function egressDeniedMessage(details: ModelProviderErrorDetails): string {
  const target = typeof details.target === 'string' ? details.target : undefined;
  const reason = typeof details.reason === 'string' ? details.reason : undefined;
  const prefix = target && reason ? `Requests to ${target} are blocked (${reason}). ` : '';
  return `${prefix}On Shipfox Cloud the endpoint must be reachable from the internet. Use a public HTTPS URL for hosted providers.`;
}

function workspaceSecretCapMessage(details: ModelProviderErrorDetails): string {
  if (typeof details.cap === 'number') {
    return `This workspace has reached its secrets limit of ${details.cap}.`;
  }
  return 'This workspace has reached its secrets limit.';
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
