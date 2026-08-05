import {defineClientFeature, type NavTabEntry} from '@shipfox/client-shell';

export const workflowsNavigation = [
  {
    id: 'nav.runs',
    scope: 'project',
    label: 'Runs',
    to: '/w/$workspaceSlug/p/$projectSlug/runs',
    order: 100,
  },
  {
    id: 'nav.workflows',
    scope: 'project',
    label: 'Workflows',
    to: '/w/$workspaceSlug/p/$projectSlug/workflows',
    order: 200,
  },
] as const satisfies readonly NavTabEntry[];

export const workflowsFeature = defineClientFeature({
  id: 'shipfox.workflows',
  routes: [
    {
      path: '/w/$workspaceSlug/p/$projectSlug/workflows',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/workflows',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/runs',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/runs',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/run-detail',
    },
    {
      path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
      parent: 'projectLayout',
      impl: '@shipfox/client-workflows/routes/job-detail',
    },
  ],
  navigation: workflowsNavigation,
});
