import {agentAccessFeature, agentAccessSettingsSections, agentFeature} from './feature.js';

describe('agentAccessFeature', () => {
  test('declares dormant consent and settings routes', () => {
    expect(agentAccessFeature).toMatchObject({
      id: 'shipfox.agent-access',
      routes: [
        {
          path: '/oauth/consent',
          parent: 'root',
          impl: '@shipfox/client-agent/routes/agent-access-consent',
        },
        {
          path: '/w/$workspaceSlug/settings/agent-access',
          parent: 'workspaceSettings',
          impl: '@shipfox/client-agent/routes/agent-access-settings',
        },
      ],
    });
    expect(agentAccessSettingsSections).toEqual([
      {
        id: 'settings.agent-access',
        pathSegment: 'agent-access',
        label: 'MCP connections',
        icon: 'terminalBoxLine',
        order: 450,
      },
    ]);
    expect(agentFeature.id).toBe('shipfox.agent');
    expect(agentAccessFeature.id).not.toBe(agentFeature.id);
  });
});
