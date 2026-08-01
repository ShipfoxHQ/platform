import {defineClientFeature, type NavTabEntry} from '@shipfox/client-shell';

export const projectsNavigation = [
  {
    id: 'nav.projects',
    scope: 'workspace',
    label: 'Projects',
    to: '/w/$workspaceSlug',
    exact: true,
    order: 100,
  },
] as const satisfies readonly NavTabEntry[];

export const projectsFeature = defineClientFeature({
  id: 'shipfox.projects',
  routes: [
    {
      path: '/w/$workspaceSlug',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-projects/routes/home',
    },
    {
      path: '/w/$workspaceSlug/projects/new',
      parent: 'workspaceLayout',
      impl: '@shipfox/client-projects/routes/create-project',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug',
      parent: 'projectLayout',
      impl: '@shipfox/client-projects/routes/project-index',
    },
  ],
  navigation: projectsNavigation,
});
