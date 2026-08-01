import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {TriggerEventDetailResponseDto} from '@shipfox/api-triggers-dto';
import {projectsQueryKeys} from '@shipfox/client-projects';
import {RelativeTimeProvider} from '@shipfox/react-ui/relative-time';
import type {Decorator, Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {screen} from 'storybook/test';
import {toTriggerEventDetail} from '#hooks/api/trigger-event-mapper.js';
import {TriggerEventDetailView} from './trigger-event-detail.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function createStoryQueryClient() {
  const queryClient = new QueryClient();
  queryClient.setQueryData(projectsQueryKeys.list(WORKSPACE_ID), {
    pages: [{projects: [{id: PROJECT_ID, slug: 'checkout-api'}], nextCursor: null}],
    pageParams: [undefined],
  });
  return queryClient;
}

const withRouter: Decorator = (Story) => {
  const queryClient = createStoryQueryClient();

  function StoryRoute() {
    return (
      <QueryClientProvider client={queryClient}>
        <RelativeTimeProvider>
          <div className="min-h-screen bg-background-subtle-base p-24 [--app-content-h:calc(100dvh_-_96px)]">
            <div className="@container ml-auto w-[860px]">
              <Story />
            </div>
          </div>
        </RelativeTimeProvider>
      </QueryClientProvider>
    );
  }

  const rootRoute = createRootRoute({component: Outlet});
  const storyRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: StoryRoute,
  });
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: StoryRoute,
  });
  const router = createRouter({
    history: createMemoryHistory({initialEntries: ['/']}),
    routeTree: rootRoute.addChildren([storyRoute, runRoute]),
  });

  return <RouterProvider router={router} />;
};

const routedEventDto: TriggerEventDetailResponseDto = {
  id: '44444444-4444-4444-8444-444444444444',
  event_ref: 'github:delivery-179:push',
  origin: 'integration',
  workspace_id: WORKSPACE_ID,
  provider: 'github',
  source: 'github_acme',
  event: 'push',
  delivery_id: 'delivery-179',
  connection_id: '55555555-5555-4555-8555-555555555555',
  connection_name: 'ShipfoxHQ Production',
  outcome: 'routed',
  matched_count: 2,
  payload: {
    ref: 'refs/heads/main',
    repository: {full_name: 'ShipfoxHQ/platform'},
    head_commit: {id: '9f1a0f2c7a1b', message: 'Deploy event detail'},
  },
  received_at: minutesAgo(15),
  processed_at: '2026-06-25T19:30:02.000Z',
  created_at: '2026-06-25T19:30:00.000Z',
  decisions: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      received_event_id: '44444444-4444-4444-8444-444444444444',
      subscription_kind: 'trigger',
      subscription_id: '77777777-7777-4777-8777-777777777777',
      subscription_name: 'Deploy production',
      workflow_definition_id: '88888888-8888-4888-8888-888888888888',
      project_id: PROJECT_ID,
      workflow_run_id: null,
      job_id: null,
      matcher_kind: null,
      matcher_ordinal: null,
      decision: 'triggered',
      run_id: RUN_ID,
      run_name: 'deploy-web #184',
      reason: null,
      created_at: '2026-06-25T19:30:02.000Z',
    },
    {
      id: '99999999-9999-4999-8999-999999999999',
      received_event_id: '44444444-4444-4444-8444-444444444444',
      subscription_kind: 'trigger',
      subscription_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      subscription_name: 'Mirror staging',
      workflow_definition_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      project_id: PROJECT_ID,
      workflow_run_id: null,
      job_id: null,
      matcher_kind: null,
      matcher_ordinal: null,
      decision: 'triggered',
      run_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      run_name: 'mirror-staging #51',
      reason: null,
      created_at: '2026-06-25T19:30:02.000Z',
    },
  ],
};

const discardedEventDto: TriggerEventDetailResponseDto = {
  ...routedEventDto,
  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  event_ref: 'github:delivery-180:issue_comment',
  event: 'issue_comment',
  delivery_id: 'delivery-180',
  outcome: 'discarded',
  matched_count: 0,
  payload: {action: 'created', comment: {body: '/preview'}},
  processed_at: '2026-06-25T19:33:01.000Z',
  decisions: [],
};

const routedEvent = toTriggerEventDetail(routedEventDto);
const discardedEvent = toTriggerEventDetail(discardedEventDto);

const meta = {
  title: 'Triggers/EventDetail',
  component: TriggerEventDetailView,
  parameters: {
    layout: 'fullscreen',
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
    },
  },
  decorators: [withRouter],
  args: {
    workspaceId: WORKSPACE_ID,
    workspaceSlug: 'acme',
    event: routedEvent,
    onBack: () => undefined,
  },
} satisfies Meta<typeof TriggerEventDetailView>;

export default meta;
type Story = StoryObj<typeof meta>;

async function captureDetail(ctx: Parameters<NonNullable<Story['play']>>[0], name: string) {
  await screen.findByRole('complementary', {name: 'Event details'});
  await argosScreenshot(ctx, name);
}

export const Playground: Story = {
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Playground');
  },
};

export const Discarded: Story = {
  args: {event: discardedEvent},
  play: async (ctx) => {
    await captureDetail(ctx, 'Trigger Event Detail Discarded');
  },
};
