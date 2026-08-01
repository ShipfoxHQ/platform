import {defineClientFeature} from '#contract.js';

export const features = [
  defineClientFeature({
    id: 'shipfox.projects',
    routes: [
      {
        path: '/w/$workspaceSlug/p/$projectSlug/overview',
        parent: 'projectLayout',
        impl: '#test/default-route-impl.js',
      },
      {
        path: '/w/$workspaceSlug/settings/members',
        parent: 'workspaceSettings',
        impl: '#test/default-route-impl.js',
      },
    ],
    navigation: [
      {
        id: 'projects',
        scope: 'workspace',
        label: 'Projects',
        to: '/w/$workspaceSlug/p/$projectSlug/overview',
        order: 100,
      },
    ],
    settingsSections: [
      {id: 'members', pathSegment: 'members', label: 'Members', icon: 'users', order: 100},
    ],
  }),
  defineClientFeature({
    id: 'acme.insights',
    routes: [
      {
        path: '/w/$workspaceSlug/insights',
        parent: 'workspaceLayout',
        impl: '#test/named-route-impl.js',
      },
      {
        path: '/w/$workspaceSlug/p/$projectSlug/overview',
        parent: 'projectLayout',
        override: true,
        impl: '#test/search-route-impl.js',
      },
    ],
    navigation: [
      {
        id: 'insights',
        scope: 'workspace',
        label: 'Insights',
        to: '/w/$workspaceSlug/insights',
        order: 200,
      },
    ],
  }),
] as const;
