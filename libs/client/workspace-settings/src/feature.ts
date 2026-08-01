import {
  defineClientFeature,
  type NavTabEntry,
  type SettingsSectionEntry,
} from '@shipfox/client-shell';

export const workspaceSettingsNavigation = [
  {
    id: 'nav.settings',
    scope: 'workspace',
    label: 'Settings',
    to: '/w/$workspaceSlug/settings',
    order: 200,
  },
] as const satisfies readonly NavTabEntry[];

export const workspaceSettingsSections = [
  {
    id: 'settings.members',
    pathSegment: 'members',
    label: 'Members',
    icon: 'userLine',
    order: 100,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const workspaceSettingsFeature = defineClientFeature({
  id: 'shipfox.workspace-settings',
  routes: [
    {
      path: '/w/$workspaceSlug/settings',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/index',
    },
    {
      path: '/w/$workspaceSlug/settings/members',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-workspace-settings/routes/members',
    },
  ],
  navigation: workspaceSettingsNavigation,
  settingsSections: workspaceSettingsSections,
});
