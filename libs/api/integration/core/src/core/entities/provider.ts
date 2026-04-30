import type {RouteExport} from '@shipfox/node-fastify';
import type {SourceControlProvider} from '#core/providers/source-control.js';

export type IntegrationProviderKind = string;

export interface IntegrationProviderAdapters {
  source_control?: SourceControlProvider | undefined;
}

export type IntegrationCapability = keyof IntegrationProviderAdapters;

export interface IntegrationProvider {
  provider: IntegrationProviderKind;
  displayName: string;
  adapters?: IntegrationProviderAdapters | undefined;
  routes?: RouteExport[] | undefined;
}

export interface RegisteredIntegrationProvider extends IntegrationProvider {
  adapters: IntegrationProviderAdapters;
  capabilities: IntegrationCapability[];
}
