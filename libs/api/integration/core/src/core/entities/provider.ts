import type {RouteExport} from '@shipfox/node-fastify';
import type {SourceControlProvider} from '#core/providers/source-control.js';

export type IntegrationProviderKind = 'debug' | 'github';

export type IntegrationCapability = 'source_control';

export interface IntegrationProvider {
  provider: IntegrationProviderKind;
  displayName: string;
  capabilities: IntegrationCapability[];
  sourceControl?: SourceControlProvider | undefined;
  routes?: RouteExport[] | undefined;
}
