import {defaultFeatures} from '@shipfox/client-features';
import {defineClientFeature} from '@shipfox/client-shell';
import {z} from 'zod';
import {ExternalProviderInner, ExternalProviderOuter} from './provider';

export const externalConfigShape = {
  externalGreeting: z.string(),
};

export const externalFeature = defineClientFeature({
  id: 'fixture.external',
  routes: [
    {
      path: '/auth/login',
      parent: 'root',
      override: true,
      impl: './features/login-override',
    },
    {
      path: '/w/$workspaceSlug/settings/external',
      parent: 'workspaceSettings',
      impl: './features/external-settings',
    },
  ],
  providers: [
    {id: 'fixture-provider-outer', Component: ExternalProviderOuter},
    {id: 'fixture-provider-inner', Component: ExternalProviderInner},
  ],
  navigation: [
    {
      id: 'nav.external',
      scope: 'workspace',
      label: 'External',
      to: '/w/$workspaceSlug/settings/external',
      order: 150,
    },
  ],
  settingsSections: [
    {
      id: 'settings.external',
      pathSegment: 'external',
      label: 'External',
      icon: 'settings3Line',
      order: 150,
    },
  ],
  configShape: externalConfigShape,
});

export const externalLayoutFeature = defineClientFeature({
  id: 'fixture.admin-layout',
  layouts: [
    {
      id: 'fixture.admin-layout',
      path: '/external-admin',
      parent: 'root',
      impl: './features/external-admin-layout',
    },
  ],
});

export const externalLayoutSectionsFeature = defineClientFeature({
  id: 'fixture.admin-sections',
  routes: [
    {
      path: '/external-admin/overview',
      parent: 'fixture.admin-layout',
      impl: './features/external-admin-overview',
    },
    {
      path: '/external-admin/users',
      parent: 'fixture.admin-layout',
      impl: './features/external-admin-users',
    },
  ],
  navigation: [
    {
      id: 'admin.users',
      scope: 'layout',
      layout: 'fixture.admin-layout',
      label: 'Users',
      to: '/external-admin/users',
      minimumRole: 'fixture-reader',
      order: 200,
    },
    {
      id: 'admin.overview',
      scope: 'layout',
      layout: 'fixture.admin-layout',
      label: 'Overview',
      to: '/external-admin/overview',
      minimumRole: 'fixture-reader',
      order: 100,
    },
  ],
});

export const features = [
  ...defaultFeatures(),
  externalFeature,
  externalLayoutFeature,
  externalLayoutSectionsFeature,
];
