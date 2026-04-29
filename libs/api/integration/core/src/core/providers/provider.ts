import type {RouteExport} from '@shipfox/node-fastify';
import type {IntegrationCapability, IntegrationProviderKind} from '#core/entities/connection.js';
import type {SourceControlProvider} from './source-control.js';

export interface IntegrationProvider {
  provider: IntegrationProviderKind;
  displayName: string;
  capabilities: IntegrationCapability[];
  sourceControl?: SourceControlProvider | undefined;
  routes?: RouteExport[] | undefined;
}
