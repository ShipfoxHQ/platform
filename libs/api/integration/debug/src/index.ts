import {DebugSourceControlProvider} from '#core/source-control.js';
import {
  type CreateDebugIntegrationRoutesOptions,
  createDebugIntegrationRoutes,
} from '#presentation/routes/connections.js';

export {DebugSourceControlProvider} from '#core/source-control.js';

export function createDebugIntegrationProvider(options: CreateDebugIntegrationRoutesOptions) {
  return {
    provider: 'debug' as const,
    displayName: 'Debug Source Control',
    adapters: {
      source_control: new DebugSourceControlProvider(),
    },
    routes: [createDebugIntegrationRoutes(options)],
  };
}
