import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const triggersSettingsSections = [
  {id: 'settings.events', pathSegment: 'events', label: 'Events', icon: 'pulseLine', order: 800},
] as const satisfies readonly SettingsSectionEntry[];

export const triggersFeature = defineClientFeature({
  id: 'shipfox.triggers',
  routes: [
    {
      path: '/w/$workspaceSlug/settings/events',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-triggers/routes/events-settings',
    },
  ],
  settingsSections: triggersSettingsSections,
});
