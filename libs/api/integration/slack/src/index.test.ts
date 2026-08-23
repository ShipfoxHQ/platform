import {slackEventCatalog} from '@shipfox/api-integration-slack-dto';
import {createSlackIntegrationProvider, slackAgentToolCatalog} from '#index.js';

describe('createSlackIntegrationProvider', () => {
  it('does not mount webhook routes without route options', () => {
    const provider = createSlackIntegrationProvider();

    expect(provider.routes).toEqual([]);
    expect(provider.eventCatalog).toBe(slackEventCatalog);
  });

  it('rejects incomplete webhook route options', () => {
    expect(() => createSlackIntegrationProvider({routes: {}})).toThrow(
      'Slack webhook routes require every core persistence dependency',
    );
  });

  it('exposes the Slack agent-tools adapter when token access is configured', () => {
    const provider = createSlackIntegrationProvider({
      agentTools: {tokenStore: {getAccessToken: async () => 'xoxb-token'}},
    });

    const catalog = provider.adapters.agent_tools?.catalog();

    expect(catalog).toBe(slackAgentToolCatalog);
  });

  it('exposes explicit connection cleanup without requiring routes', () => {
    const deleteConnectionRecords = vi.fn(() => Promise.resolve());
    const deleteConnectionSecrets = vi.fn(() => Promise.resolve());
    const provider = createSlackIntegrationProvider({
      cleanup: {deleteConnectionRecords, deleteConnectionSecrets},
    });

    expect(provider.deleteConnectionRecords).toBe(deleteConnectionRecords);
    expect(provider.deleteConnectionSecrets).toBe(deleteConnectionSecrets);
  });
});
