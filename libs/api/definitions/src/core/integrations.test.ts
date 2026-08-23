import type {IntegrationsModuleClient} from '@shipfox/api-integration-core-dto/inter-module';
import {loadIntegrationValidationContext} from './integrations.js';

describe('loadIntegrationValidationContext', () => {
  it('materializes provider event catalogs and fixed-provider metadata', async () => {
    const getAgentToolsContext = vi.fn<IntegrationsModuleClient['getAgentToolsContext']>(
      async () => ({
        selectionCatalogs: [],
        catalogs: [],
        workspaceConnections: [],
        eventCatalogs: [
          {provider: 'github', events: ['push', 'pull_request.opened']},
          {provider: 'gitea', events: ['push']},
        ],
        fixedEventProviders: ['webhook'],
        defaultConnection: null,
      }),
    );
    const integrations = {getAgentToolsContext} as unknown as IntegrationsModuleClient;
    const workspaceId = crypto.randomUUID();
    const defaultConnectionId = crypto.randomUUID();

    const context = await loadIntegrationValidationContext(
      integrations,
      workspaceId,
      defaultConnectionId,
    );

    expect(getAgentToolsContext).toHaveBeenCalledWith({workspaceId, defaultConnectionId});
    expect(context.eventCatalogs).toEqual(
      new Map([
        ['github', new Set(['push', 'pull_request.opened'])],
        ['gitea', new Set(['push'])],
      ]),
    );
    expect(context.fixedEventProviders).toEqual(new Set(['webhook']));
  });
});
