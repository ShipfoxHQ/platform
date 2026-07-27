import {type StepLogSnapshot, stepLogsQueryKeys} from '@shipfox/client-logs';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import {useState} from 'react';
import type {RunAnnotation, RunAnnotationStyle} from '#core/run-annotation.js';
import {runAnnotationsQueryKeys} from '#hooks/api/run-annotations.js';
import {workflowRunsQueryKeys} from '#hooks/api/workflow-runs.js';
import {
  workflowJobDto,
  workflowJobExecutionDto,
  workflowRunDetail,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {WorkflowRunView} from './workflow-run-view.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const RUN_ID = '33333333-3333-4333-8333-333333333333';
const BUILD_JOB_ID = '44444444-4444-4444-8444-444444444444';
const BUILD_EXECUTION_ID = '55555555-5555-4555-8555-555555555555';
const TEST_STEP_ID = '66666666-6666-4666-8666-666666666666';
const TEST_ATTEMPT_ID = '77777777-7777-4777-8777-777777777777';
const PACKAGE_STEP_ID = '88888888-8888-4888-8888-888888888888';
const PACKAGE_ATTEMPT_ID = '99999999-9999-4999-8999-999999999999';
const DEPLOY_JOB_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEPLOY_EXECUTION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DEPLOY_STEP_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const run = workflowRunDetail({
  id: RUN_ID,
  project_id: PROJECT_ID,
  definition_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  name: 'release-production',
  status: 'succeeded',
  current_attempt: 1,
  latest_attempt: 1,
  trigger_provider: 'github',
  trigger_source: 'github',
  trigger_event: 'push',
  created_at: '2026-07-27T09:00:00.000Z',
  updated_at: '2026-07-27T09:08:00.000Z',
  started_at: '2026-07-27T09:00:04.000Z',
  finished_at: '2026-07-27T09:08:00.000Z',
  jobs: [
    workflowJobDto({
      id: BUILD_JOB_ID,
      name: 'build-and-test',
      status: 'succeeded',
      position: 0,
      job_executions: [
        workflowJobExecutionDto({
          id: BUILD_EXECUTION_ID,
          job_id: BUILD_JOB_ID,
          status: 'succeeded',
          queued_at: '2026-07-27T09:00:04.000Z',
          started_at: '2026-07-27T09:00:08.000Z',
          finished_at: '2026-07-27T09:04:00.000Z',
          steps: [
            workflowStepDto({
              id: TEST_STEP_ID,
              key: 'test',
              name: 'test',
              status: 'succeeded',
              position: 0,
              attempts: [
                workflowStepAttemptDto({
                  id: TEST_ATTEMPT_ID,
                  step_id: TEST_STEP_ID,
                  status: 'succeeded',
                  exit_code: 0,
                  started_at: '2026-07-27T09:00:10.000Z',
                  finished_at: '2026-07-27T09:02:30.000Z',
                }),
              ],
            }),
            workflowStepDto({
              id: PACKAGE_STEP_ID,
              key: 'package',
              name: 'package',
              status: 'succeeded',
              position: 1,
              attempts: [
                workflowStepAttemptDto({
                  id: PACKAGE_ATTEMPT_ID,
                  step_id: PACKAGE_STEP_ID,
                  status: 'succeeded',
                  exit_code: 0,
                  started_at: '2026-07-27T09:02:31.000Z',
                  finished_at: '2026-07-27T09:04:00.000Z',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
    workflowJobDto({
      id: DEPLOY_JOB_ID,
      name: 'deploy-production',
      status: 'succeeded',
      position: 1,
      dependencies: [BUILD_JOB_ID],
      job_executions: [
        workflowJobExecutionDto({
          id: DEPLOY_EXECUTION_ID,
          job_id: DEPLOY_JOB_ID,
          status: 'succeeded',
          queued_at: '2026-07-27T09:04:00.000Z',
          started_at: '2026-07-27T09:04:04.000Z',
          finished_at: '2026-07-27T09:08:00.000Z',
          steps: [
            workflowStepDto({
              id: DEPLOY_STEP_ID,
              key: 'deploy',
              name: 'deploy',
              status: 'succeeded',
              position: 0,
              attempts: [
                workflowStepAttemptDto({
                  step_id: DEPLOY_STEP_ID,
                  status: 'succeeded',
                  exit_code: 0,
                  started_at: '2026-07-27T09:04:05.000Z',
                  finished_at: '2026-07-27T09:08:00.000Z',
                }),
              ],
            }),
          ],
        }),
      ],
    }),
  ],
});

const hierarchyAnnotations = [
  annotation({
    id: '10000000-0000-4000-8000-000000000001',
    context: 'test-summary',
    style: 'success',
    sequence: 1,
    body: '### Test summary\n\n- 128 passed\n- 0 failed\n- Coverage: **94.2%**',
  }),
  annotation({
    id: '10000000-0000-4000-8000-000000000002',
    context: 'coverage',
    style: 'info',
    sequence: 2,
    body: 'Coverage increased by **1.8%** compared with the default branch.',
  }),
  annotation({
    id: '10000000-0000-4000-8000-000000000003',
    context: 'flaky-tests',
    style: 'warning',
    sequence: 3,
    body: 'Two tests required a retry. Neither failed on the second attempt.',
  }),
  annotation({
    id: '10000000-0000-4000-8000-000000000004',
    originStepId: PACKAGE_STEP_ID,
    context: 'artifact',
    style: 'success',
    sequence: 4,
    body: 'Published `web-app.tar.gz` — 42.6 MB, SHA `6f05f3b`.',
  }),
  annotation({
    id: '10000000-0000-4000-8000-000000000005',
    jobId: DEPLOY_JOB_ID,
    jobExecutionId: DEPLOY_EXECUTION_ID,
    originStepId: DEPLOY_STEP_ID,
    context: 'deployment',
    style: 'success',
    sequence: 1,
    body: 'Production rollout completed across all three regions.',
  }),
];

const annotationStyles: RunAnnotationStyle[] = ['default', 'info', 'success', 'warning', 'error'];

const manyAnnotations = [
  ...hierarchyAnnotations,
  ...Array.from({length: 7}, (_, index) =>
    annotation({
      id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      context: `check-${index + 1}`,
      style: annotationStyles[index % annotationStyles.length],
      sequence: index + 5,
      body: `Check ${index + 1} completed with deterministic diagnostic output for the dense annotation state.`,
    }),
  ),
];

const meta = {
  title: 'Workflows/RunView/WorkflowRunView',
  component: WorkflowRunView,
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof WorkflowRunView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AnnotationHierarchy: Story = {
  render: () => <WorkflowRunViewStory annotations={hierarchyAnnotations} />,
};

export const ManyAnnotations: Story = {
  render: () => <WorkflowRunViewStory annotations={manyAnnotations} />,
};

function WorkflowRunViewStory({annotations}: {annotations: RunAnnotation[]}) {
  const [queryClient] = useState(() => storyQueryClient(annotations));
  const [router] = useState(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const runRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/workspaces/$wid/projects/$pid/runs/$workflowRunId',
      component: () => (
        <div className="flex h-[1500px] min-h-0 bg-background-neutral-base">
          <WorkflowRunView
            workspaceId={WORKSPACE_ID}
            projectId={PROJECT_ID}
            workflowRunId={RUN_ID}
            selection={{
              runAttempt: 1,
              jobId: BUILD_JOB_ID,
              jobExecutionId: BUILD_EXECUTION_ID,
              stepId: TEST_STEP_ID,
              stepAttemptId: TEST_ATTEMPT_ID,
            }}
          />
        </div>
      ),
    });

    return createRouter({
      history: createMemoryHistory({
        initialEntries: [`/workspaces/${WORKSPACE_ID}/projects/${PROJECT_ID}/runs/${RUN_ID}`],
      }),
      routeTree: rootRoute.addChildren([runRoute]),
    });
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}

function storyQueryClient(annotations: RunAnnotation[]): QueryClient {
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false, refetchOnWindowFocus: false}},
  });
  queryClient.setQueryData(workflowRunsQueryKeys.detail(RUN_ID, 1), run);
  queryClient.setQueryData(runAnnotationsQueryKeys.detail(RUN_ID, 1), annotations);
  queryClient.setQueryData(stepLogsQueryKeys.detail(TEST_STEP_ID, 1), completeLogSnapshot());
  return queryClient;
}

function completeLogSnapshot(): StepLogSnapshot {
  return {
    records: [
      {
        v: 1,
        ts: Date.parse('2026-07-27T09:02:29.000Z'),
        type: 'output',
        stream: 'stdout',
        data: '128 tests passed in 140.2s\n',
      },
    ],
    nextCursor: 1,
    source: 'inline',
    state: 'closed',
    complete: true,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
  };
}

function annotation(overrides: Partial<RunAnnotation>): RunAnnotation {
  return {
    id: '10000000-0000-4000-8000-000000000000',
    jobId: BUILD_JOB_ID,
    jobExecutionId: BUILD_EXECUTION_ID,
    originStepId: TEST_STEP_ID,
    originStepAttempt: 1,
    context: 'summary',
    style: 'default',
    sequence: 1,
    body: 'Annotation body',
    ...overrides,
  };
}
