import {defineClientFeature, type SettingsSectionEntry} from '@shipfox/client-shell';

export const integrationsSettingsSections = [
  {
    id: 'settings.integrations',
    pathSegment: 'integrations',
    label: 'Integrations',
    icon: 'plugLine',
    order: 700,
  },
] as const satisfies readonly SettingsSectionEntry[];

export const integrationsFeature = defineClientFeature({
  id: 'shipfox.integrations',
  routes: [
    {
      path: '/integrations/github/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/github-callback',
    },
    {
      path: '/integrations/linear/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/linear-callback',
    },
    {
      path: '/integrations/jira/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/jira-callback',
    },
    {
      path: '/integrations/sentry/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/sentry-callback',
    },
    {
      path: '/integrations/slack/callback',
      parent: 'root',
      impl: '@shipfox/client-integrations/routes/slack-callback',
    },
    {
      path: '/w/$workspaceSlug/integrations',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/integrations',
    },
    {
      path: '/w/$workspaceSlug/integrations/gitea',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/gitea',
    },
    {
      path: '/w/$workspaceSlug/integrations/github',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/github',
    },
    {
      path: '/w/$workspaceSlug/integrations/linear',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/linear',
    },
    {
      path: '/w/$workspaceSlug/integrations/jira',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/jira',
    },
    {
      path: '/w/$workspaceSlug/integrations/sentry',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/sentry',
    },
    {
      path: '/w/$workspaceSlug/integrations/slack',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-integrations/routes/slack',
    },
    {
      path: '/w/$workspaceSlug/settings/integrations',
      parent: 'workspaceSettings',
      impl: '@shipfox/client-integrations/routes/integrations-settings',
    },
  ],
  settingsSections: integrationsSettingsSections,
});
