// biome-ignore-all lint/a11y/noRedundantRoles: the story mirrors the job log region contract.
// biome-ignore-all lint/a11y/noNoninteractiveTabindex: the story mirrors the focusable log surface.

import {type StepLogSnapshot, stepLogsQueryKeys} from '@shipfox/client-logs';
import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {type ReactNode, useState} from 'react';
import type {Job, JobExecution, WorkflowRunDetail} from '#core/workflow-run.js';
import {runAnnotationsQueryKeys} from '#hooks/api/run-annotations.js';
import type {useWorkflowRunAttemptQuery} from '#hooks/api/workflow-runs.js';
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

export const DataStates: Story = {
  render: () => {
    const partialRun = partialJobRun();
    const emptyRun = emptyJobRun();
    const loadedRun = playgroundRun();
    return (
      <div className="grid max-w-[1120px] gap-16 p-16 md:grid-cols-2">
        <StateExample label="Loading">
          <JobDetailStoryState
            query={makeQuery(undefined, {isPending: true})}
            jobId={loadedRun.jobs[0]?.id ?? ''}
          />
        </StateExample>
        <StateExample label="Empty">
          <JobDetailStoryState query={makeQuery(emptyRun)} jobId={emptyRun.jobs[0]?.id ?? ''} />
        </StateExample>
        <StateExample label="Error">
          <JobDetailStoryState
            query={makeQuery(undefined, {isError: true, error: new Error('Storybook error')})}
            jobId="missing-job"
          />
        </StateExample>
        <StateExample label="Partial">
          <JobDetailStoryState query={makeQuery(partialRun)} jobId={partialRun.jobs[0]?.id ?? ''} />
        </StateExample>
        <StateExample label="Job not found">
          <JobDetailStoryState query={makeQuery(loadedRun)} jobId="missing-job" />
        </StateExample>
      </div>
    );
  },
};

function JobDetailStoryFrame({run, jobId, selectedExecutionId}: JobDetailStoryArgs) {
  const job = run.jobs.find((candidate) => candidate.id === jobId) ?? run.jobs[0];
  const selectedExecution = job?.jobExecutions.find(
    (execution) => execution.id === selectedExecutionId,
  );
  return (
    <div className="flex min-h-screen min-w-0 bg-background-neutral-base">
      <JobDetailStoryState
        query={makeQuery(run)}
        jobId={jobId}
        search={selectedExecution ? {jobExecutionId: selectedExecution.id} : {}}
      />
    </div>
  );
}

function JobDetailStoryState({
  query,
  jobId,
  search = {},
}: {
  query: JobDetailQuery;
  jobId: string;
  search?: Parameters<typeof JobDetailView>[0]['search'];
}) {
  const run = query.data;
  return (
    <StoryQueryProvider run={run}>
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
  children,
}: {
  run: WorkflowRunDetail | undefined;
  children: ReactNode;
}) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    if (run) {
      client.setQueryData(runAnnotationsQueryKeys.list(run.id, run.runAttempt.attempt), {
        pages: [{annotations: [], hasMore: false, nextCursor: null}],
        pageParams: [undefined],
      });
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
        trigger_events: [],
        outputs: null,
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
          error: null,
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
      outputs: job.jobExecutions[0]?.outputs ?? null,
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

function StateExample({label, children}: {label: string; children: ReactNode}) {
  return (
    <section className="min-w-0 rounded-8 border border-border-neutral-base bg-background-neutral-base p-12">
      <Text as="h3" size="xs" bold className="mb-8 text-foreground-neutral-muted">
        {label}
      </Text>
      {children}
    </section>
  );
}
