import {ApiError} from '@shipfox/client-api';
import {modelProviderConfigErrorField, modelProviderConfigErrorToFormError} from './form-errors.js';

describe('modelProviderConfigErrorToFormError', () => {
  test.each([
    [
      new ApiError({
        code: 'provider-validation-failed',
        message: 'Validation failed',
        status: 422,
        details: {provider_id: 'anthropic', message: 'Provider rejected the key.'},
      }),
      'Provider rejected the key.',
    ],
    [
      new ApiError({
        code: 'provider-validation-failed',
        message: 'Validation failed',
        status: 422,
        details: {
          code: 'provider-validation-failed',
          message: 'Validation failed',
          details: {provider_id: 'anthropic', message: 'Provider rejected the key.'},
        },
      }),
      'Provider rejected the key.',
    ],
    [
      new ApiError({
        code: 'provider-validation-failed',
        message: 'Validation failed',
        status: 422,
      }),
      'Validation failed',
    ],
    [
      new ApiError({
        code: 'invalid-credential-fields',
        message: 'Invalid credentials',
        status: 422,
        details: {
          provider_id: 'azure-openai-responses',
          expected_keys: ['endpoint', 'api_key'],
        },
      }),
      'Credentials must include exactly these fields: endpoint, api_key.',
    ],
    [
      new ApiError({
        code: 'invalid-credential-fields',
        message: 'Invalid credentials',
        status: 422,
      }),
      'Credentials do not match the fields required by this provider.',
    ],
    [
      new ApiError({
        code: 'provider-unsupported',
        message: 'Unsupported',
        status: 422,
        details: {provider_id: 'amazon-bedrock'},
      }),
      'This provider is not supported for workspace-managed credentials.',
    ],
    [
      new ApiError({
        code: 'invalid-agent-model',
        message: 'Invalid agent model',
        status: 422,
        details: {provider_id: 'anthropic', model: 'missing-model'},
      }),
      'Choose a model from the models list.',
    ],
    [
      new ApiError({
        code: 'provider-not-configured',
        message: 'Not configured',
        status: 422,
        details: {provider_id: 'openai'},
      }),
      'Configure this provider before setting it as the default.',
    ],
    [
      new ApiError({
        code: 'workspace-providers-disabled',
        message: 'Provider policy rejected the request.',
        status: 422,
        details: {message: 'This instance only supports provider `shipfox`.'},
      }),
      'This instance only supports provider `shipfox`.',
    ],
    [
      new ApiError({code: 'not-found', message: 'Provider config not found', status: 404}),
      'This custom provider no longer exists. Refresh and try again.',
    ],
    [
      new ApiError({code: 'slug-collision', message: 'Slug collision', status: 409}),
      'A provider with this id already exists in this workspace.',
    ],
    [
      new ApiError({
        code: 'egress-denied',
        message: 'Egress denied',
        status: 400,
        details: {target: 'http://localhost:11434', reason: 'private-network'},
      }),
      'Requests to http://localhost:11434 are blocked (private-network). On Shipfox Cloud the endpoint must be reachable from the internet. Use a public HTTPS URL for hosted providers.',
    ],
    [
      new ApiError({code: 'invalid-header-keep', message: 'Invalid keep', status: 422}),
      'A kept secret header no longer exists - re-enter its value.',
    ],
    [
      new ApiError({
        code: 'stored-secret-base-url-changed',
        message: 'Stored secrets require rotation',
        status: 422,
      }),
      'Re-enter stored secret values before testing against a different base URL.',
    ],
    [
      new ApiError({
        code: 'workspace-secret-cap-exceeded',
        message: 'Secret cap',
        status: 409,
        details: {cap: 64},
      }),
      'This workspace has reached its secrets limit of 64.',
    ],
    [
      new ApiError({code: 'value-too-large', message: 'Too large', status: 400}),
      'A key or header value is too large to store.',
    ],
    [new ApiError({code: 'unknown-code', message: 'Server copy', status: 422}), 'Server copy'],
  ])('maps ApiError %s to a form-level alert', (error, expectedMessage) => {
    const result = modelProviderConfigErrorToFormError(error);

    expect(result).toEqual({kind: 'form', message: expectedMessage});
  });

  test('routes Error to a form-level alert with the error message', () => {
    const result = modelProviderConfigErrorToFormError(new Error('boom'));

    expect(result).toEqual({kind: 'form', message: 'boom'});
  });

  test('falls back to generic copy for non-Error throwables', () => {
    const result = modelProviderConfigErrorToFormError('weird');

    expect(result).toEqual({kind: 'form', message: 'Something went wrong. Try again.'});
  });

  test('routes base URL secret reuse errors to the base URL field', () => {
    const result = modelProviderConfigErrorField(
      new ApiError({
        code: 'stored-secret-base-url-changed',
        message: 'Stored secrets require rotation',
        status: 422,
      }),
    );

    expect(result).toEqual({
      kind: 'field',
      field: 'base_url',
      message: 'Re-enter stored secret values before testing against a different base URL.',
    });
  });
});
