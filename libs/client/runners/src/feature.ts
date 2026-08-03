import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const runnersSettingsSections = [
  {
    id: 'settings.runners',
    pathSegment: 'runners',
    label: 'Runners',
    icon: 'settings3Line',
    order: 200,
  },
  {
    id: 'settings.provisioners',
    pathSegment: 'provisioners',
    label: 'Runner provisioners',
    icon: 'serverLine',
    order: 300,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const runnersFeature = defineClientFeature({
  id: 'shipfox.runners',
  routes: [
    {
      path: '/w/$workspaceSlug/settings/runners',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-runners/routes/runners-settings',
    },
    {
      path: '/w/$workspaceSlug/settings/provisioners',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-runners/routes/provisioners-settings',
    },
  ],
  settingsSections: runnersSettingsSections,
});
