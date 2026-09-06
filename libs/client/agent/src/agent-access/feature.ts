import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const agentAccessSettingsSections = [
  {
    id: 'settings.agent-access',
    pathSegment: 'agent-access',
    label: 'MCP connections',
    icon: 'terminalBoxLine',
    order: 450,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const agentAccessFeature = defineClientFeature({
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
  settingsSections: agentAccessSettingsSections,
});
