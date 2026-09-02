import {agentAccessFeature, agentAccessSettingsSections} from './feature.js';

describe('agentAccessFeature', () => {
  test('declares dormant consent and settings routes', () => {
    expect(agentAccessFeature).toMatchObject({
      id: 'shipfox.agent-access',
      routes: [
        {
          path: '/oauth/consent',
          parent: 'root',
          impl: '@shipfox/client-agent-access/routes/consent',
        },
        {
          path: '/w/$workspaceSlug/settings/agent-access',
          parent: 'workspaceSettings',
          impl: '@shipfox/client-agent-access/routes/settings',
        },
      ],
    });
    expect(agentAccessSettingsSections).toEqual([
      {
        id: 'settings.agent-access',
        pathSegment: 'agent-access',
        label: 'Agent access',
        icon: 'key2Line',
        order: 450,
      },
    ]);
  });
});
