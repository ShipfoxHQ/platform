import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const agentSettingsSections = [
  {
    id: 'settings.agents',
    pathSegment: 'agents',
    label: 'Agents',
    icon: 'robot2Line',
    order: 400,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const agentFeature = defineClientFeature({
  id: 'shipfox.agent',
  routes: [
    {
      path: '/w/$workspaceSlug/model-provider',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-agent/routes/model-provider',
    },
    {
      path: '/w/$workspaceSlug/settings/agents',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-agent/routes/agents-settings',
    },
  ],
  settingsSections: agentSettingsSections,
});

export {agentAccessFeature, agentAccessSettingsSections} from './agent-access/feature.js';
