import {argosScreenshot} from '@argos-ci/storybook/vitest';
import type {RerunMode} from '@shipfox/api-workflows-dto';
import {configureApiClient} from '@shipfox/client-api';
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
import type {ReactNode} from 'react';
import {useEffect, useState} from 'react';
import {screen, userEvent, within} from 'storybook/test';
import {WorkflowRunAttempt, type WorkflowRunStatus} from '#core/workflow-run.js';
import {
  runAttemptsResponseDto,
  workflowJobDto,
  workflowRunAttemptDto,
  workflowRunDetail,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunSummary} from './workflow-run-summary.js';

const ROOT_RUN_ID = '11111111-1111-4111-8111-111111111111';
const CURRENT_RUN_ID = '22222222-2222-4222-8222-222222222222';
const NEXT_RUN_ID = '33333333-3333-4333-8333-333333333333';
const SWITCH_ATTEMPT_PATTERN = /Switch attempt/;
const ATTEMPT_3_PATTERN = /Attempt 3/;
const STORYBOOK_NOW = '2026-06-26T12:00:00.000Z';
const RUN_STARTED_AT = '2026-06-26T11:57:46.000Z';
const RUN_ATTEMPTS_RESPONSE = runAttemptsResponseDto({
  attempts: [
    workflowRunAttemptDto({
      id: ROOT_RUN_ID,
      attempt: 1,
      status: 'succeeded',
      created_at: '2026-06-21T12:00:00.000Z',
    }),
    workflowRunAttemptDto({
      id: CURRENT_RUN_ID,
      attempt: 2,
      status: 'failed',
      created_at: '2026-06-21T12:08:00.000Z',
      rerun_mode: 'all',
    }),
    workflowRunAttemptDto({
      id: NEXT_RUN_ID,
      attempt: 3,
      status: 'running',
      created_at: '2026-06-21T12:14:00.000Z',
      rerun_mode: 'failed',
    }),
  ],
});

const withFrame: Decorator = (Story) => (
  <div className="min-h-screen bg-background-neutral-base">
    <div className="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col overflow-hidden border-x border-border-neutral-base bg-background-subtle-base">
      <Story />
      <div className="min-h-0 flex-1 bg-background-neutral-base p-16" />
    </div>
  </div>
);

const withAttemptApi: Decorator = (Story) => {
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}});
  const rootRoute = createRootRoute({component: Outlet});
  const runRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
    component: () => <Story />,
  });
  const router = createRouter({
    history: createMemoryHistory({
      initialEntries: [`/w/acme/p/project/runs/${CURRENT_RUN_ID}`],
    }),
    routeTree: rootRoute.addChildren([runRoute]),
  });

  return (
    <AttemptApiProvider>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </AttemptApiProvider>
  );
};

function AttemptApiProvider({children}: {children: ReactNode}) {
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    configureApiClient({
      baseUrl: 'https://api.example.test',
      fetchImpl: async () =>
        new Response(JSON.stringify(RUN_ATTEMPTS_RESPONSE), {
          headers: {'content-type': 'application/json'},
        }),
    });
    setConfigured(true);

    return () => {
      configureApiClient({baseUrl: '', fetchImpl: undefined});
    };
  }, []);

  if (!configured) return null;
  return children;
}

const meta = {
  title: 'Workflows/RunSummary',
  component: WorkflowRunSummary,
  parameters: {
    layout: 'fullscreen',
    argos: {
      modes: {
        light: {theme: 'light'},
        dark: {theme: 'dark'},
      },
    },
  },
  decorators: [withFrame],
  args: {run: workflowRunDetail({status: 'succeeded'})},
} satisfies Meta<typeof WorkflowRunSummary>;

export default meta;
type Story = StoryObj<typeof meta>;
type WorkflowRunSummaryStoryContext = Parameters<NonNullable<Story['play']>>[0];

async function captureOpenAttemptsMenu(ctx: WorkflowRunSummaryStoryContext) {
  const canvas = within(ctx.canvasElement);

  await userEvent.click(await canvas.findByRole('button', {name: SWITCH_ATTEMPT_PATTERN}));
  await screen.findByRole('menu');
  await screen.findByRole('menuitem', {name: ATTEMPT_3_PATTERN});
  await argosScreenshot(ctx, 'Workflow Run Summary Attempts Open');
}

const noop = () => undefined;
const noopRerun = (_mode: RerunMode) => undefined;

const ATTEMPT_SUMMARY_ARGS = {
  run: workflowRunDetail({
    id: CURRENT_RUN_ID,
    current_attempt: 2,
    run_attempt: workflowRunAttemptDto({
      id: CURRENT_RUN_ID,
      workflow_run_id: CURRENT_RUN_ID,
      attempt: 2,
    }),
    status: 'failed',
  }),
  workspaceSlug: 'acme',
  projectSlug: 'project',
  latestAttempt: 3,
};

export const Playground: Story = {};

export const WithAttempts: Story = {
  decorators: [withAttemptApi],
  args: ATTEMPT_SUMMARY_ARGS,
};

export const WithAttemptsOpen: Story = {
  decorators: [withAttemptApi],
  play: captureOpenAttemptsMenu,
  args: ATTEMPT_SUMMARY_ARGS,
};

export const Durations: Story = {
  render: () => (
    <div className="flex flex-col">
      <WorkflowRunSummary
        run={workflowRunDetail({
          status: 'succeeded',
          name: 'release-finished',
          run_attempt: workflowRunAttemptDto({
            status: 'succeeded',
            created_at: RUN_STARTED_AT,
            started_at: RUN_STARTED_AT,
            finished_at: STORYBOOK_NOW,
          }),
        })}
      />
      <WorkflowRunSummary
        run={workflowRunDetail({
          status: 'running',
          name: 'release-running',
          run_attempt: workflowRunAttemptDto({
            status: 'running',
            created_at: RUN_STARTED_AT,
            started_at: RUN_STARTED_AT,
            finished_at: null,
          }),
        })}
      />
    </div>
  ),
};

export const Cancellable: Story = {
  args: {
    run: workflowRunDetail({status: 'running'}),
    onCancel: noop,
  },
};

export const Cancelling: Story = {
  args: {
    run: workflowRunDetail({status: 'running'}),
    onCancel: noop,
    cancelling: true,
  },
};

const ALL_STATUSES: WorkflowRunStatus[] = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
];

export const Statuses: Story = {
  render: () => (
    <div className="flex flex-col">
      {ALL_STATUSES.map((status, index) => (
        <WorkflowRunSummary
          key={status}
          run={workflowRunDetail({
            id: `11111111-1111-4111-8111-${String(index + 2).padStart(12, '0')}`,
            status,
            name: `${status}-pipeline`,
          })}
        />
      ))}
    </div>
  ),
};

const ACTION_VARIANTS = [
  {
    label: 'Running',
    run: workflowRunDetail({status: 'running', name: 'running-pipeline'}),
    props: {onCancel: noop},
  },
  {
    label: 'Cancelling',
    run: workflowRunDetail({status: 'running', name: 'cancelling-pipeline'}),
    props: {cancelling: true, onCancel: noop},
  },
  {
    label: 'Succeeded',
    run: workflowRunDetail({status: 'succeeded', name: 'succeeded-pipeline'}),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Re-running',
    run: workflowRunDetail({status: 'succeeded', name: 'rerun-pending-pipeline'}),
    props: {rerunPending: true, onRerun: noopRerun},
  },
  {
    label: 'Failed',
    run: workflowRunDetail({
      status: 'failed',
      name: 'failed-pipeline',
      jobs: [workflowJobDto({status: 'failed'})],
    }),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Cancelled',
    run: workflowRunDetail({
      status: 'cancelled',
      name: 'cancelled-pipeline',
      jobs: [workflowJobDto({status: 'cancelled'})],
    }),
    props: {onRerun: noopRerun},
  },
  {
    label: 'Failed without failed jobs',
    run: workflowRunDetail({
      status: 'failed',
      name: 'failed-without-failed-jobs-pipeline',
      jobs: [workflowJobDto({status: 'succeeded'})],
    }),
    props: {onRerun: noopRerun},
  },
] satisfies Array<{
  label: string;
  run: ReturnType<typeof workflowRunDetail>;
  props: Pick<
    Parameters<typeof WorkflowRunSummary>[0],
    'cancelling' | 'onCancel' | 'rerunPending' | 'onRerun'
  >;
}>;

export const ActionVariants: Story = {
  render: () => (
    <div className="flex flex-col">
      {ACTION_VARIANTS.map(({label, run, props}, index) => (
        <WorkflowRunSummary
          key={label}
          run={{
            ...run,
            id: `22222222-2222-4222-8222-${String(index + 2).padStart(12, '0')}`,
          }}
          {...props}
        />
      ))}
    </div>
  ),
};

export const ActionVariantsWithAttempts: Story = {
  decorators: [withAttemptApi],
  render: () => (
    <div className="flex flex-col">
      {ACTION_VARIANTS.map(({label, run, props}, index) => (
        <WorkflowRunSummary
          key={label}
          run={{
            ...run,
            id: `22222222-2222-4222-8222-${String(index + 2).padStart(12, '0')}`,
            currentAttempt: 2,
            runAttempt: new WorkflowRunAttempt({
              id: `22222222-2222-4222-8222-${String(index + 2).padStart(12, '0')}`,
              workflowRunId: `22222222-2222-4222-8222-${String(index + 2).padStart(12, '0')}`,
              attempt: 2,
              status: run.runAttempt.status,
              createdAt: run.createdAt,
              startedAt: null,
              finishedAt: null,
              rerunMode: null,
            }),
          }}
          workspaceSlug="acme"
          projectSlug="project"
          latestAttempt={3}
          {...props}
        />
      ))}
    </div>
  ),
};

export const MissingTriggerMetadata: Story = {
  args: {
    run: workflowRunDetail({
      status: 'succeeded',
      trigger_source: '',
      trigger_event: '',
    }),
  },
};

export const EmptyTriggerPayload: Story = {
  args: {
    run: workflowRunDetail({status: 'succeeded', trigger_payload: {}}),
  },
};

export const LongRunName: Story = {
  args: {
    run: workflowRunDetail({
      status: 'succeeded',
      name: 'release-production-multi-region-with-canary-and-smoke-tests-and-progressive-delivery-observability-and-post-deploy-validation-for-enterprise-workspaces',
    }),
  },
};

export const LongTriggerMetadata: Story = {
  args: {
    run: workflowRunDetail({
      status: 'succeeded',
      trigger_provider: 'github',
      trigger_source: 'github-enterprise-cloud-production-organization',
      trigger_event: 'workflow_dispatch_with_release_candidate_payload',
    }),
  },
};
