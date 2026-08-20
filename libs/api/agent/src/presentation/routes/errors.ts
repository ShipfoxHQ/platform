import {secretsInterModuleContract} from '@shipfox/api-secrets-dto/inter-module';
import {isInterModuleKnownError} from '@shipfox/inter-module';
import {EgressDeniedError} from '@shipfox/node-egress-guard';
import {ClientError} from '@shipfox/node-fastify';
import {
  CustomModelProviderConfigNotFoundError,
  CustomModelProviderSlugCollisionError,
  CustomModelProviderStoredSecretBaseUrlChangeError,
  InvalidAgentModelError,
  InvalidCredentialFieldsError,
  InvalidCustomModelProviderHeaderKeepError,
  ModelProviderConfigNotFoundError,
  ModelProviderValidationError,
  UnsupportedModelProviderError,
  WorkspaceProvidersDisabledError,
} from '#core/index.js';
import {getModelProviderCredentialKeys} from '#core/model-provider-policy.js';

export function translateModelProviderRouteError(error: unknown): never {
  if (error instanceof ModelProviderValidationError) {
    throw new ClientError(error.sanitizedMessage, 'provider-validation-failed', {
      status: 422,
      details: {
        provider_id: error.providerId,
        message: error.sanitizedMessage,
      },
    });
  }

  if (error instanceof EgressDeniedError) {
    throw new ClientError('Egress denied', 'egress-denied', {
      status: 400,
      details: {
        reason: error.reason,
        target: error.target,
      },
    });
  }

  if (error instanceof CustomModelProviderSlugCollisionError) {
    throw new ClientError('Custom model provider slug already exists', 'slug-collision', {
      status: 409,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof CustomModelProviderConfigNotFoundError) {
    throw new ClientError('Custom model provider configuration not found', 'not-found', {
      status: 404,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof InvalidCustomModelProviderHeaderKeepError) {
    throw new ClientError('Invalid kept secret header', 'invalid-header-keep', {
      status: 422,
      details: {provider_id: error.providerId, name: error.headerName},
    });
  }

  if (error instanceof CustomModelProviderStoredSecretBaseUrlChangeError) {
    throw new ClientError(
      'Stored custom model provider secrets cannot be reused with a changed base URL',
      'stored-secret-base-url-changed',
      {
        status: 422,
        details: {provider_id: error.providerId},
      },
    );
  }

  if (error instanceof InvalidCredentialFieldsError) {
    throw new ClientError('Invalid credential fields', 'invalid-credential-fields', {
      status: 422,
      details: {
        provider_id: error.providerId,
        expected_keys: getModelProviderCredentialKeys(error.providerId) ?? [],
      },
    });
  }

  if (error instanceof InvalidAgentModelError) {
    throw new ClientError('Invalid agent model', 'invalid-agent-model', {
      status: 422,
      details: {
        harness: error.harness,
        provider_id: error.providerId,
        model: error.model,
      },
    });
  }

  if (error instanceof UnsupportedModelProviderError) {
    throw new ClientError('Provider is not supported', 'provider-unsupported', {
      status: 422,
      details: {provider_id: error.providerId},
    });
  }

  if (error instanceof WorkspaceProvidersDisabledError) {
    throw new ClientError(error.message, 'workspace-providers-disabled', {
      status: 422,
      details: {
        managed_provider_id: error.managedProviderId,
        message: error.message,
      },
    });
  }

  if (error instanceof ModelProviderConfigNotFoundError) {
    throw new ClientError('Provider is not configured', 'provider-not-configured', {
      status: 422,
      details: {
        provider_id: error.providerId,
      },
    });
  }

  if (isInterModuleKnownError(secretsInterModuleContract.methods.setSecrets, error)) {
    if (error.code === 'workspace-secret-cap-exceeded') {
      throw new ClientError('Workspace secret cap exceeded', 'workspace-secret-cap-exceeded', {
        status: 409,
        details: {cap: error.details.cap},
      });
    }
    throw new ClientError('Secret value is too large', 'value-too-large', {
      status: 400,
      details: {max_bytes: error.details.maxBytes},
    });
  }

  throw error;
}
