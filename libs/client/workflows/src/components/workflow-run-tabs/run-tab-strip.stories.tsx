import {Tabs} from '@shipfox/react-ui/tabs';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import type {RunAnnotationSummary} from '#core/workflow-run-tabs.js';
import {RunTabStrip} from './run-tab-strip.js';

const ANNOTATION_SUMMARY: RunAnnotationSummary = {
  total: 8,
  error: 2,
  warning: 3,
  info: 2,
  success: 1,
};

const withRouter: Decorator = (Story) => {
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => <Story />,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/w/acme/p/project/runs/run-1']}),
    routeTree: rootRoute.addChildren([runRoute]),
  });

  return <RouterProvider router={router} />;
};

const meta = {
  title: 'Workflows/RunTabStrip',
  component: RunTabStrip,
  parameters: {layout: 'fullscreen'},
  decorators: [withRouter],
  render: (args) => (
    <div className="bg-background-subtle-base">
      <Tabs defaultValue="summary">
        <RunTabStrip {...args} />
      </Tabs>
    </div>
  ),
  args: {
    jobCount: 6,
    jobsFailed: 1,
    annotationSummary: ANNOTATION_SUMMARY,
    workspaceSlug: 'acme',
    projectSlug: 'project',
    workflowRunId: 'run-1',
    search: {},
  },
} satisfies Meta<typeof RunTabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const NoCounts: Story = {
  args: {
    jobCount: undefined,
    annotationSummary: undefined,
  },
};

export const NarrowLayout: Story = {
  decorators: [
    (Story) => (
      <div className="w-[360px] max-w-full overflow-hidden border">
        <Story />
      </div>
    ),
  ],
};
