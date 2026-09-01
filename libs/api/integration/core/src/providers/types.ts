import type {UserContextMembership} from '@shipfox/api-auth-context';
import type {WebhookRequestProcessor, WebhookRouteId} from '@shipfox/api-integration-spi';
import type {RouteExport} from '@shipfox/node-fastify';
import type {ModuleDatabase, ModuleWorker} from '@shipfox/node-module';
import type {IntegrationProvider} from '#core/entities/provider.js';

/**
 * Everything one integration contributes to the composed integrations module:
 * a registry provider, plus an optional dedicated database, background workers,
 * and one-shot boot-time tasks. Providers that own none of these simply omit them.
 *
 * A startup task is run once after modules are initialized (migrations done). The
 * provider owns its own wiring: core runs each task generically and isolates
 * failures so a task can never gate API boot.
 */
export interface IntegrationModuleParts {
  provider: IntegrationProvider;
  database?: ModuleDatabase | undefined;
  e2eRoutes?: RouteExport[] | undefined;
  workers?: ModuleWorker[] | undefined;
  startupTasks?: Array<() => Promise<void>> | undefined;
  webhookProcessors?: WebhookProcessorRegistration[] | undefined;
}

export interface WebhookProcessorRegistration {
  routeIds: readonly WebhookRouteId[];
  processor: WebhookRequestProcessor;
}

/**
 * A config-gated integration, registered once in `providerModules`. `load` is
 * called lazily and only when `enabled`, so a disabled provider never imports
 * its (potentially heavy) implementation package.
 */
export interface IntegrationProviderModule {
  id: string;
  enabled: boolean;
  load(options?: IntegrationProviderModuleLoadOptions): Promise<IntegrationModuleParts>;
}

export interface IntegrationProviderModuleLoadOptions {
  secrets?: IntegrationProviderSecrets | undefined;
  /** Invalidates local repository authorization decisions after committed provider-owned changes. */
  invalidateRepositoryAuthorizationCache?: ((connectionId: string) => void) | undefined;
  requireActiveWorkspaceMembership?:
    | ((input: {
        workspaceId: string;
        userId: string;
        memberships: ReadonlyArray<UserContextMembership>;
      }) => Promise<unknown>)
    | undefined;
}

export interface IntegrationProviderSecrets {
  github?: IntegrationProviderScopedSecrets | undefined;
  jira?: IntegrationProviderScopedSecrets | undefined;
  linear?: IntegrationProviderScopedSecrets | undefined;
  slack?: IntegrationProviderScopedSecrets | undefined;
  deleteSecrets(params: {workspaceId: string; namespace: string}): Promise<number>;
}

export interface IntegrationProviderScopedSecrets {
  getSecret(params: {workspaceId: string; namespace: string; key: string}): Promise<string | null>;
  getSecretsByNamespace?(params: {
    workspaceId: string;
    namespace: string;
  }): Promise<Record<string, string>>;
  setSecrets(params: {
    workspaceId: string;
    namespace: string;
    values: Record<string, string>;
    editedBy?: string | null | undefined;
  }): Promise<void>;
  deleteSecrets(params: {
    workspaceId: string;
    namespace: string;
    keys?: string[] | undefined;
  }): Promise<number>;
}
