// biome-ignore-all lint/a11y/noRedundantRoles: the story mirrors the job log region contract.
// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the story mirrors the focusable log surface.

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
import {type ReactNode, useState} from 'react';
import {userEvent, within} from 'storybook/test';
import type {Job, JobExecution, StepAttemptDetail, WorkflowRunDetail} from '#core/workflow-run.js';
import type {RunAnnotationSummary} from '#core/run-annotation.js';
import {workflowRunAnnotationsQueryKeys} from '#hooks/api/annotations.js';
import {stepAttemptDetailQueryKeys} from '#hooks/api/step-attempt-detail.js';
import type {useWorkflowRunAttemptQuery} from '#hooks/api/workflow-runs.js';
import {workflowRunsQueryKeys} from '#hooks/api/workflow-runs.js';
import {WorkflowJobDetailPage} from '#pages/workflow-job-detail-page.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowRunAttemptDto,
  workflowRunDetail,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {JobDetailView} from './job-detail-view.js';

const WORKSPACE_SLUG = 'acme';
const PROJECT_SLUG = 'platform';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const INSPECTOR_TRIGGER_NAME = /Inspect Run tests/;
const LOG_RECORDS: StepLogSnapshot['records'] = [
  {
    v: 1,
    ts: Date.parse('2026-06-26T11:58:00.000Z'),
    type: 'output',
    stream: 'stdout',
    data: '$ pnpm test --filter=@shipfox/client-workflows\n',
  },
  {
    v: 1,
    ts: Date.parse('2026-06-26T11:58:04.000Z'),
    type: 'output',
    stream: 'stdout',
    data: '370 tests passed\n',
  },
];

interface JobDetailStoryArgs {
  run: WorkflowRunDetail;
  jobId: string;
  selectedExecutionId?: string | undefined;
  search?: Parameters<typeof JobDetailView>[0]['search'];
  stepDetails?: readonly StepAttemptDetail[];
}

type JobDetailQuery = ReturnType<typeof useWorkflowRunAttemptQuery>;

const meta = {
  title: 'Workflows/JobDetail',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<JobDetailStoryArgs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => {
    const run = playgroundRun();
    return <JobDetailStoryFrame run={run} jobId={run.jobs[1]?.id ?? ''} />;
  },
};

export const Executions: Story = {
  render: () => {
    const {run, jobId, selectedExecutionId} = executionStory();
    return (
      <JobDetailStoryFrame run={run} jobId={jobId} selectedExecutionId={selectedExecutionId} />
    );
  },
};

export const Loading: Story = {
  render: () => {
    const run = playgroundRun();
    return (
      <JobDetailStoryViewport>
        <JobDetailStoryState
          query={makeQuery(undefined, {isPending: true})}
          jobId={run.jobs[0]?.id ?? ''}
        />
      </JobDetailStoryViewport>
    );
  },
};

export const Empty: Story = {
  render: () => {
    const run = emptyJobRun();
    return <JobDetailStoryFrame run={run} jobId={run.jobs[0]?.id ?? ''} />;
  },
};

export const ErrorState: Story = {
  render: () => (
    <JobDetailStoryViewport>
      <JobDetailStoryState
        query={makeQuery(undefined, {isError: true, error: new Error('Storybook error')})}
        jobId="missing-job"
      />
    </JobDetailStoryViewport>
  ),
};

export const Partial: Story = {
  render: () => {
    const run = partialJobRun();
    return <JobDetailStoryFrame run={run} jobId={run.jobs[0]?.id ?? ''} />;
  },
};

export const JobNotFound: Story = {
  render: () => {
    const run = playgroundRun();
    return <JobDetailStoryFrame run={run} jobId="missing-job" />;
  },
};

export const StepFailure: Story = {
  render: () => {
    const {run, commandJobId, stepDetails} = failureRun();
    return <JobDetailStoryFrame run={run} jobId={commandJobId} stepDetails={stepDetails} />;
  },
};

export const TimedOutBeforeStep: Story = {
  render: () => {
    const {run, timeoutJobId} = failureRun();
    return <JobDetailStoryFrame run={run} jobId={timeoutJobId} />;
  },
};

export const ConditionRejected: Story = {
  render: () => {
    const {run, conditionJobId} = failureRun();
    return <JobDetailStoryFrame run={run} jobId={conditionJobId} />;
  },
};

export const FailureStates: Story = {
  render: () => <FailureCompositionStory />,
};

export const InspectionData: Story = {
  render: () => {
    const {run, jobId, executionId, stepId, attemptId, stepDetails} = inspectionRun();
    return (
      <JobDetailStoryFrame
        run={run}
        jobId={jobId}
        selectedExecutionId={executionId}
        search={{jobExecutionId: executionId, stepId, stepAttemptId: attemptId}}
        stepDetails={stepDetails}
      />
    );
  },
  play: async ({canvasElement}) => {
    const canvas = within(canvasElement);
    const inspectorTrigger = await canvas.findByRole('button', {
      name: INSPECTOR_TRIGGER_NAME,
    });
    await userEvent.click(inspectorTrigger);
    const documentBody = within(canvasElement.ownerDocument.body);
    await documentBody.findByRole('region', {name: 'Inputs'});
    await documentBody.findByRole('region', {name: 'Evaluation'});
  },
};

export const RunComposition: Story = {
  render: () => <RunCompositionStory />,
};

function JobDetailStoryFrame({
  run,
  jobId,
  selectedExecutionId,
  search,
  stepDetails,
}: JobDetailStoryArgs) {
  const job = run.jobs.find((candidate) => candidate.id === jobId) ?? run.jobs[0];
  const selectedExecution = job?.jobExecutions.find(
    (execution) => execution.id === selectedExecutionId,
  );
  return (
    <JobDetailStoryViewport>
      <JobDetailStoryState
        query={makeQuery(run)}
        jobId={jobId}
        search={search ?? (selectedExecution ? {jobExecutionId: selectedExecution.id} : {})}
        stepDetails={stepDetails}
      />
    </JobDetailStoryViewport>
  );
}

function JobDetailStoryViewport({children}: {children: ReactNode}) {
  return (
    <div className="flex min-h-screen min-w-0 w-full bg-background-neutral-base">{children}</div>
  );
}

function JobDetailStoryState({
  query,
  jobId,
  search = {},
  stepDetails = [],
}: {
  query: JobDetailQuery;
  jobId: string;
  search?: Parameters<typeof JobDetailView>[0]['search'];
  stepDetails?: readonly StepAttemptDetail[];
}) {
  const run = query.data;
  return (
    <StoryQueryProvider run={run} stepDetails={stepDetails}>
      <JobDetailView
        workspaceSlug={WORKSPACE_SLUG}
        projectSlug={PROJECT_SLUG}
        workflowRunId={run?.id ?? RUN_ID}
        jobId={jobId}
        search={search}
        query={query}
        onSelectionChange={() => undefined}
      />
    </StoryQueryProvider>
  );
}

function makeQuery(data: WorkflowRunDetail | undefined, overrides: Partial<JobDetailQuery> = {}) {
  return {
    isPending: false,
    isError: false,
    isFetching: false,
    data,
    error: null,
    refetch: () => Promise.resolve({} as never),
    ...overrides,
  } as JobDetailQuery;
}

function StoryQueryProvider({
  run,
  stepDetails = [],
  children,
}: {
  run: WorkflowRunDetail | undefined;
  stepDetails?: readonly StepAttemptDetail[];
  children: ReactNode;
}) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    if (run) {
      for (const job of run.jobs) {
        for (const execution of job.jobExecutions) {
          for (const step of execution.steps) {
            for (const attempt of step.attempts) {
              client.setQueryData<StepLogSnapshot>(
                stepLogsQueryKeys.detail(step.id, attempt.attempt),
                storyLogSnapshot(),
              );
            }
          }
        }
      }
      client.setQueryData(workflowRunsQueryKeys.detail(run.id), run);
      for (const detail of stepDetails) {
        client.setQueryData(
          stepAttemptDetailQueryKeys.detail(detail.stepId, detail.attempt),
          detail,
        );
      }
      const summary: RunAnnotationSummary = {
        total: 0,
        error: 0,
        warning: 0,
        info: 0,
        success: 0,
        truncated: false,
        stepCounts: [],
      };
      for (const job of run.jobs) {
        for (const execution of job.jobExecutions) {
          client.setQueryData(
            workflowRunAnnotationsQueryKeys.summary(run.id, run.runAttempt.attempt, execution.id),
            summary,
          );
        }
      }
      client.setQueryData(
        workflowRunAnnotationsQueryKeys.summary(run.id, run.runAttempt.attempt),
        summary,
      );
    }
    return client;
  });

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function storyLogSnapshot(): StepLogSnapshot {
  return {
    records: LOG_RECORDS,
    nextCursor: LOG_RECORDS.length,
    source: 'inline',
    state: 'closed',
    complete: true,
    hasMore: false,
    truncated: false,
    totalBytes: null,
    expiresAt: null,
  };
}

function playgroundRun(): WorkflowRunDetail {
  const setupId = '22222222-2222-4222-8222-222222222222';
  const buildId = '33333333-3333-4333-8333-333333333333';
  const deployId = '44444444-4444-4444-8444-444444444445';

  return storyRun({
    status: 'running',
    jobs: [
      makeJob({
        id: setupId,
        key: 'setup',
        name: 'setup',
        status: 'succeeded',
        position: 0,
        executions: [
          makeExecution('55555555-5555-4555-8555-555555555555', setupId, 1, 'succeeded'),
        ],
      }),
      makeJob({
        id: buildId,
        key: 'build',
        name: 'build',
        status: 'running',
        position: 1,
        executions: [
          makeExecution('66666666-6666-4666-8666-666666666666', buildId, 1, 'running', 'running'),
        ],
      }),
      makeJob({
        id: deployId,
        key: 'deploy',
        name: 'deploy',
        status: 'pending',
        position: 2,
        dependencies: ['build'],
        executions: [],
      }),
    ],
  });
}

function compositionRun() {
  const setupId = '12121212-1212-4212-8212-121212121212';
  const buildId = '13131313-1313-4313-8313-131313131313';
  const buildExecutionId = '14141414-1414-4414-8414-141414141414';
  const installStepId = '15151515-1515-4515-8515-151515151515';
  const installAttemptId = '16161616-1616-4616-8616-161616161616';
  const testStepId = '17171717-1717-4717-8717-171717171717';
  const testAttemptId = '18181818-1818-4818-8818-181818181818';
  const packageStepId = '19191919-1919-4919-8919-191919191919';
  const deployId = '20202020-2020-4020-8020-202020202020';

  const installStep = workflowStepDto({
    id: installStepId,
    job_execution_id: buildExecutionId,
    key: 'install',
    name: 'Install dependencies',
    status: 'succeeded',
    position: 0,
    attempts: [
      workflowStepAttemptDto({
        id: installAttemptId,
        step_id: installStepId,
        status: 'succeeded',
        finished_at: '2026-08-06T09:02:00.000Z',
      }),
    ],
  });
  const testStep = workflowStepDto({
    id: testStepId,
    job_execution_id: buildExecutionId,
    key: 'test',
    name: 'Run tests',
    status: 'failed',
    status_reason: 'agent_invocation_failed',
    position: 1,
    config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
    error: {
      message: 'The test command exited with code 1.',
      reason: 'agent_invocation_failed',
      category: 'user',
      exit_code: 1,
    },
    attempts: [
      workflowStepAttemptDto({
        id: testAttemptId,
        step_id: testStepId,
        status: 'failed',
        exit_code: 1,
        output: {summary: '4 tests failed in the workflow package.'},
        outputs: {failed_tests: 4},
        error: {
          message: 'The test command exited with code 1.',
          reason: 'agent_invocation_failed',
          category: 'user',
          exit_code: 1,
        },
        finished_at: '2026-08-06T09:05:00.000Z',
      }),
    ],
  });
  const packageStep = workflowStepDto({
    id: packageStepId,
    job_execution_id: buildExecutionId,
    key: 'package',
    name: 'Package artifacts',
    status: 'skipped',
    status_reason: 'upstream_failed',
    position: 2,
    attempts: [],
  });
  const buildExecution = workflowJobExecutionDto({
    id: buildExecutionId,
    job_id: buildId,
    status: 'failed',
    status_reason: 'step_failed',
    runner: ['runner-linux-x64'],
    outputs: {failed_tests: 4},
    steps: [installStep, testStep, packageStep],
  });
  const buildJob = workflowJob({
    id: buildId,
    key: 'build',
    name: 'build',
    status: 'failed',
    status_reason: 'step_failed',
    runner: ['runner-linux-x64'],
    outputs: {failed_tests: 4},
    position: 1,
    job_executions: [buildExecution],
  });
  const run = storyRun({
    status: 'failed',
    jobs: [
      makeJob({
        id: setupId,
        key: 'setup',
        name: 'setup',
        status: 'succeeded',
        position: 0,
        executions: [
          makeExecution('21212121-2121-4212-8212-212121212121', setupId, 1, 'succeeded'),
        ],
      }),
      buildJob,
      makeJob({
        id: deployId,
        key: 'deploy',
        name: 'deploy',
        status: 'pending',
        position: 2,
        dependencies: [buildId],
        executions: [],
      }),
    ],
  });

  return {
    run,
    stepDetails: [
      stepAttemptDetail({
        stepId: testStepId,
        attempt: 1,
        authoredConfig: {run: String.raw`pnpm test --filter=\${{ inputs.package }}`},
        config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
      }),
    ],
  };
}

function emptyJobRun(): WorkflowRunDetail {
  return storyRun({
    status: 'succeeded',
    jobs: [
      makeJob({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        key: 'skipped-job',
        name: 'skipped-job',
        status: 'skipped',
        position: 0,
        executions: [],
      }),
    ],
  });
}

function partialJobRun(): WorkflowRunDetail {
  const jobId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  return storyRun({
    status: 'running',
    jobs: [
      makeJob({
        id: jobId,
        key: 'build',
        name: 'build',
        status: 'running',
        position: 0,
        executions: [
          makeExecution('dddddddd-dddd-4ddd-8ddd-dddddddddddd', jobId, 1, 'running', 'running'),
        ],
      }),
    ],
  });
}

function failureRun() {
  const commandJobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
  const commandExecutionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2';
  const commandStepId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3';
  const commandAttemptId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4';
  const timeoutJobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5';
  const timeoutExecutionId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee6';
  const conditionJobId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee7';
  const commandStep = workflowStepDto({
    id: commandStepId,
    job_execution_id: commandExecutionId,
    key: 'run-tests',
    name: 'Run tests',
    status: 'failed',
    status_reason: 'agent_invocation_failed',
    config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
    evaluation_trace: [
      {
        expression: 'inputs["package"]',
        roots: ['inputs.package'],
        fill_target: 'step-dispatch',
        evaluated_at: '2026-08-05T12:00:00.000Z',
        field: 'run',
        value: '@shipfox/client-workflows',
      },
    ],
    error: {
      message: 'The test command exited with code 1.',
      reason: 'agent_invocation_failed',
      category: 'user',
      exit_code: 1,
    },
    attempts: [
      workflowStepAttemptDto({
        id: commandAttemptId,
        step_id: commandStepId,
        status: 'failed',
        exit_code: 1,
        output: {summary: '4 tests failed in the workflow package.'},
        outputs: {failed_tests: 4},
        error: {
          message: 'The test command exited with code 1.',
          reason: 'agent_invocation_failed',
          category: 'user',
          exit_code: 1,
        },
        finished_at: '2026-08-05T12:04:00.000Z',
      }),
    ],
  });
  const commandExecution = workflowJobExecutionDto({
    id: commandExecutionId,
    job_id: commandJobId,
    status: 'failed',
    status_reason: 'step_failed',
    runner: ['runner-linux-x64'],
    outputs: {test_count: 370, failed_tests: 4},
    evaluation_trace: [
      {
        expression: 'inputs["package"]',
        roots: ['inputs.package'],
        fill_target: 'job-dispatch',
        evaluated_at: '2026-08-05T12:00:00.000Z',
        field: 'condition',
        value: '@shipfox/client-workflows',
      },
    ],
    steps: [commandStep],
  });
  const commandJob = workflowJob({
    id: commandJobId,
    key: 'test',
    name: 'test',
    status: 'failed',
    status_reason: 'step_failed',
    runner: ['runner-linux-x64'],
    outputs: {test_count: 370, failed_tests: 4},
    position: 0,
    job_executions: [commandExecution],
  });
  const timeoutJob = workflowJob({
    id: timeoutJobId,
    key: 'deploy',
    name: 'deploy',
    status: 'failed',
    status_reason: 'timed_out',
    position: 1,
    job_executions: [
      workflowJobExecutionDto({
        id: timeoutExecutionId,
        job_id: timeoutJobId,
        status: 'failed',
        status_reason: 'timed_out',
        steps: [],
      }),
    ],
  });
  const conditionJob = workflowJob({
    id: conditionJobId,
    key: 'publish',
    name: 'publish',
    status: 'skipped',
    status_reason: 'condition_rejected',
    position: 2,
    job_executions: [],
  });
  const run = storyRun({status: 'failed', jobs: [commandJob, timeoutJob, conditionJob]});
  const stepDetails = [
    stepAttemptDetail({
      stepId: commandStepId,
      attempt: 1,
      authoredConfig: {run: String.raw`pnpm test --filter=\${{ inputs.package }}`},
      config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
    }),
  ];

  return {
    run,
    commandJobId,
    timeoutJobId,
    conditionJobId,
    commandExecutionId,
    commandStepId,
    commandAttemptId,
    stepDetails,
  };
}

function inspectionRun() {
  const story = failureRun();
  return {
    run: story.run,
    jobId: story.commandJobId,
    executionId: story.commandExecutionId,
    stepId: story.commandStepId,
    attemptId: story.commandAttemptId,
    stepDetails: story.stepDetails,
  };
}

function stepAttemptDetail({
  stepId,
  attempt,
  authoredConfig,
  config,
}: {
  stepId: string;
  attempt: number;
  authoredConfig: Record<string, unknown>;
  config: Record<string, unknown>;
}): StepAttemptDetail {
  return {
    stepId,
    attempt,
    authoredConfig,
    config,
    evaluationTrace: [
      {
        expression: 'inputs.package',
        roots: ['inputs.package'],
        fillTarget: 'run',
        evaluatedAt: '2026-08-05T12:00:00.000Z',
        field: 'run',
        value: '@shipfox/client-workflows',
      },
      {
        expression: 'inputs.branch',
        roots: ['inputs.branch'],
        fillTarget: 'run',
        evaluatedAt: '2026-08-05T12:00:00.000Z',
        field: 'run',
        value: 'main',
      },
    ],
  };
}

function RunCompositionStory() {
  const {run, stepDetails} = compositionRun();
  const job = run.jobs[1] ?? run.jobs[0];
  if (!job) return null;

  return (
    <StoryQueryProvider run={run} stepDetails={stepDetails}>
      <StoryRouter>
        <WorkflowJobDetailPage
          projectId="project-id"
          workspaceSlug={WORKSPACE_SLUG}
          projectSlug={PROJECT_SLUG}
          workflowRunId={run.id}
          jobId={job.id}
          search={{}}
        />
      </StoryRouter>
    </StoryQueryProvider>
  );
}

function FailureCompositionStory() {
  const {run, commandJobId, stepDetails} = failureRun();

  return (
    <StoryQueryProvider run={run} stepDetails={stepDetails}>
      <StoryRouter>
        <WorkflowJobDetailPage
          projectId="project-id"
          workspaceSlug={WORKSPACE_SLUG}
          projectSlug={PROJECT_SLUG}
          workflowRunId={run.id}
          jobId={commandJobId}
          search={{}}
        />
      </StoryRouter>
    </StoryQueryProvider>
  );
}

function StoryRouter({children}: {children: ReactNode}) {
  const [router] = useState(() => {
    const rootRoute = createRootRoute({component: Outlet});
    const storyRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => children,
    });
    const runRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId',
      component: () => null,
    });
    const jobRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/w/$workspaceSlug/p/$projectSlug/runs/$workflowRunId/jobs/$jobId',
      component: () => null,
    });
    return createRouter({
      history: createMemoryHistory({initialEntries: ['/']}),
      routeTree: rootRoute.addChildren([storyRoute, runRoute, jobRoute]),
    });
  });

  return <RouterProvider router={router} />;
}

function executionStory() {
  const jobId = '77777777-7777-4777-8777-777777777777';
  const firstExecutionId = '88888888-8888-4888-8888-888888888888';
  const secondExecutionId = '99999999-9999-4999-8999-999999999999';
  const selectedExecutionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const run = storyRun({
    status: 'succeeded',
    jobs: [
      makeJob({
        id: jobId,
        key: 'release',
        name: 'release',
        status: 'succeeded',
        position: 0,
        executions: [
          makeExecution(firstExecutionId, jobId, 1, 'failed', 'failed'),
          makeExecution(secondExecutionId, jobId, 2, 'failed', 'failed'),
          makeExecution(selectedExecutionId, jobId, 3, 'succeeded'),
        ],
      }),
    ],
  });

  return {run, jobId, selectedExecutionId};
}

function storyRun({
  status,
  jobs,
}: {
  status: WorkflowRunDetail['status'];
  jobs: Job[];
}): WorkflowRunDetail {
  return workflowRunDetail({
    id: RUN_ID,
    status,
    current_attempt: 1,
    latest_attempt: 1,
    run_attempt: workflowRunAttemptDto({
      workflow_run_id: RUN_ID,
      attempt: 1,
      status,
    }),
    jobs: jobs.map((job) => ({
      id: job.id,
      key: job.key,
      name: job.name,
      mode: job.mode,
      status: job.status,
      status_reason: job.statusReason,
      carried_over: job.carriedOver,
      success: job.success,
      runner: job.runner,
      evaluation_trace: job.evaluationTrace,
      listening: job.listening,
      listener_status: job.listenerStatus,
      dependencies: job.dependencies,
      position: job.position,
      run_attempt_id: job.runAttemptId,
      created_at: job.createdAt,
      updated_at: job.updatedAt,
      job_executions: job.jobExecutions.map((execution) => ({
        id: execution.id,
        job_id: execution.jobId,
        sequence: execution.sequence,
        name: execution.name,
        status: execution.status,
        status_reason: execution.statusReason,
        runner: execution.runner,
        trigger_events: [],
        outputs: execution.outputs,
        evaluation_trace: execution.evaluationTrace,
        queued_at: execution.queuedAt,
        started_at: execution.startedAt,
        finished_at: execution.finishedAt,
        timed_out_at: execution.timedOutAt,
        created_at: execution.createdAt,
        updated_at: execution.updatedAt,
        steps: execution.steps.map((step) => ({
          id: step.id,
          job_execution_id: step.jobExecutionId,
          key: step.key,
          name: step.name,
          source_location: null,
          status: step.status,
          type: step.type,
          config: step.config,
          evaluation_trace: step.evaluationTrace,
          error: step.error
            ? {
                message: step.error.message,
                ...(step.error.exitCode !== null ? {exit_code: step.error.exitCode} : {}),
                ...(step.error.signal ? {signal: step.error.signal} : {}),
                ...(step.error.reason ? {reason: step.error.reason} : {}),
                ...(step.error.agentConfigIssue
                  ? {agent_config_issue: step.error.agentConfigIssue}
                  : {}),
                ...(step.error.category ? {category: step.error.category} : {}),
              }
            : null,
          position: step.position,
          current_attempt: step.currentAttempt,
          exit_code: null,
          outputs: null,
          response: null,
          gate_result: null,
          created_at: step.createdAt,
          updated_at: step.updatedAt,
          attempts: step.attempts.map((attempt) => ({
            id: attempt.id,
            step_id: attempt.stepId,
            attempt: attempt.attempt,
            execution_order: attempt.executionOrder,
            status: attempt.status,
            exit_code: attempt.exitCode,
            output: attempt.output,
            outputs: attempt.outputs,
            response: attempt.response,
            error: attempt.error,
            gate_result: null,
            restart_feedback: attempt.restartFeedback,
            started_at: attempt.startedAt,
            finished_at: attempt.finishedAt,
          })),
        })),
      })),
      outputs: job.outputs ?? job.jobExecutions[0]?.outputs ?? null,
      resolution_reason: job.resolutionReason,
    })),
  });
}

function makeJob({
  id,
  key,
  name,
  status,
  position,
  dependencies = [],
  executions,
}: {
  id: string;
  key: string;
  name: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'skipped';
  position: number;
  dependencies?: string[];
  executions: WorkflowRunDetail['jobs'][number]['jobExecutions'];
}): Job {
  return workflowJob({
    id,
    key,
    name,
    status,
    position,
    dependencies,
    job_executions: executions.map((execution) => executionDto(execution)),
  });
}

function makeExecution(
  id: string,
  jobId: string,
  sequence: number,
  status: JobExecution['status'],
  stepStatus?: 'running' | 'failed' | undefined,
): JobExecution {
  const step = stepStatus
    ? workflowStepDto({
        id: `${id.slice(0, 8)}-5555-4555-8555-555555555555`,
        key: 'tests',
        name: 'tests',
        status: stepStatus,
        attempts: [
          workflowStepAttemptDto({
            id: `${id.slice(0, 8)}-6666-4666-8666-666666666666`,
            status: stepStatus,
          }),
        ],
      })
    : undefined;
  return workflowExecution({
    id,
    jobId,
    sequence,
    status,
    steps: step ? [step] : [],
  });
}

function workflowExecution({
  id,
  jobId,
  sequence,
  status,
  steps,
}: {
  id: string;
  jobId: string;
  sequence: number;
  status: JobExecution['status'];
  steps: ReturnType<typeof workflowStepDto>[];
}) {
  return workflowJobExecutionDto({
    id,
    job_id: jobId,
    sequence,
    status,
    steps,
  });
}

function executionDto(execution: JobExecution) {
  return workflowJobExecutionDto({
    id: execution.id,
    job_id: execution.jobId,
    sequence: execution.sequence,
    name: execution.name,
    status: execution.status,
    status_reason: execution.statusReason,
    queued_at: execution.queuedAt,
    started_at: execution.startedAt,
    finished_at: execution.finishedAt,
    timed_out_at: execution.timedOutAt,
    steps: execution.steps.map((step) =>
      workflowStepDto({
        id: step.id,
        job_execution_id: execution.id,
        key: step.key,
        name: step.name,
        status: step.status,
        type: step.type,
        config: step.config,
        position: step.position,
        current_attempt: step.currentAttempt,
        attempts: step.attempts.map((attempt) =>
          workflowStepAttemptDto({
            id: attempt.id,
            step_id: step.id,
            attempt: attempt.attempt,
            execution_order: attempt.executionOrder,
            status: attempt.status,
            exit_code: attempt.exitCode,
            started_at: attempt.startedAt,
            finished_at: attempt.finishedAt,
          }),
        ),
      }),
    ),
  });
}
