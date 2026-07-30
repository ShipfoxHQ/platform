import type {
  WorkflowExecutionEventDto,
  WorkflowRunJobDetailDto,
  WorkflowRunJobExecutionDetailDto,
  WorkflowRunStepDetailDto,
} from '@shipfox/api-workflows-dto';
import {Text} from '@shipfox/react-ui/typography';
import type {Meta, StoryObj} from '@storybook/react';
import {type ReactNode, useState} from 'react';
import {screen, userEvent, within} from 'storybook/test';
import {type Job, resolveJobExecution} from '#core/workflow-run.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import type {StepExpandedContext} from '../step-list/index.js';
import {JobCard} from './job-card.js';

const WORKSPACE_ID = '44444444-4444-4444-8444-444444444444';
const SWITCH_EXECUTION_PATTERN = /Switch job execution/;
const EXECUTION_FIVE_PATTERN = /#5/;

const QUEUED_AT = '2026-06-26T11:54:00.000Z';
const STARTED_AT = '2026-06-26T11:57:46.000Z';
const FINISHED_AT = '2026-06-26T12:00:00.000Z';
const LISTENING_BASE_AT = Date.parse('2026-06-26T10:00:00.000Z');

const meta = {
  title: 'Workflows/JobCard',
  component: JobCard,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => (
      <div className="w-760 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  args: {
    workspaceId: WORKSPACE_ID,
    job: singleExecutionJob(),
    selectedJobExecution: singleExecutionJob().jobExecutions[0],
    selectedAttemptId: null,
    onSelectedJobExecutionChange: undefined,
    onSelectedAttemptChange: undefined,
    renderExpandedStep: StepDetailPlaceholder,
  },
} satisfies Meta<typeof JobCard>;

export default meta;
type Story = StoryObj<typeof meta>;
type JobCardStoryContext = Parameters<NonNullable<Story['play']>>[0];

async function openJobExecutionSwitcher(ctx: JobCardStoryContext) {
  const canvas = within(ctx.canvasElement);

  await userEvent.click(await canvas.findByRole('button', {name: SWITCH_EXECUTION_PATTERN}));
  await screen.findByRole('menu');
  await screen.findByRole('menuitem', {name: EXECUTION_FIVE_PATTERN});
}

export const Playground: Story = {
  render: () => <JobCardStory job={singleExecutionJob()} />,
};

export const States: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="single execution">
        <JobCardStory job={singleExecutionJob()} />
      </StorySection>
      <StorySection label="display name fallback">
        <JobCardStory job={keyFallbackJob()} />
      </StorySection>
      <StorySection label="queueing execution">
        <JobCardStory job={queueingExecutionJob()} initialJobExecutionId="exec-queueing" />
      </StorySection>
      <StorySection label="failed then succeeded">
        <JobCardStory job={failedThenSucceededJob()} initialJobExecutionId="exec-2" />
      </StorySection>
      <StorySection label="running retry">
        <JobCardStory job={runningRetryJob()} initialJobExecutionId="exec-2" />
      </StorySection>
    </div>
  ),
};

export const EmptyStates: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="pending, no execution">
        <JobCardStory job={pendingNoExecutionJob()} />
      </StorySection>
      <StorySection label="listening, waiting for trigger events">
        <JobCardStory job={listeningJobNoExecutions()} />
      </StorySection>
      <StorySection label="listener resolved, no executions">
        <JobCardStory job={listeningJobResolvedNoExecutions()} />
      </StorySection>
      <StorySection label="skipped, no execution">
        <JobCardStory job={zeroExecutionJob()} />
      </StorySection>
      <StorySection label="cancelled, no execution">
        <JobCardStory job={cancelledNoExecutionJob()} />
      </StorySection>
      <StorySection label="finished, missing execution record">
        <JobCardStory job={finishedWithoutExecutionJob()} />
      </StorySection>
      <StorySection label="finished, no steps">
        <JobCardStory job={finishedWithoutStepsJob()} initialJobExecutionId="exec-empty" />
      </StorySection>
      <StorySection label="carried over">
        <JobCardStory job={carriedOverJob()} />
      </StorySection>
    </div>
  ),
};

export const ListeningProgression: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="pending, no executions">
        <JobCardStory job={listeningJobPending()} />
      </StorySection>
      <StorySection label="listening, 0 executions">
        <JobCardStory job={listeningJobNoExecutions()} />
      </StorySection>
      <StorySection label="listening, 1 running execution">
        <JobCardStory job={listeningJobOneExecution()} initialJobExecutionId="exec-listen-one-1" />
      </StorySection>
      <StorySection label="listening, mixed executions">
        <JobCardStory job={listeningJobMixedExecutions()} initialJobExecutionId="exec-listen-6" />
      </StorySection>
      <StorySection label="failed, resolved">
        <JobCardStory job={listeningJobResolved()} initialJobExecutionId="exec-listen-resolved-4" />
      </StorySection>
    </div>
  ),
};

export const ManyExecutions: Story = {
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="listening, 64 executions, short name">
        <JobCardStory
          job={manyExecutionsListeningJob('gate', 'job-many-short')}
          initialJobExecutionId="exec-many-job-many-short-64"
        />
      </StorySection>
      <StorySection label="listening, 64 executions, medium name">
        <JobCardStory
          job={manyExecutionsListeningJob('release-gates', 'job-many-medium')}
          initialJobExecutionId="exec-many-job-many-medium-64"
        />
      </StorySection>
      <StorySection label="listening, 64 executions, long name">
        <JobCardStory
          job={manyExecutionsListeningJob(
            'release-production-multi-region-with-canary-validation',
            'job-many-long',
          )}
          initialJobExecutionId="exec-many-job-many-long-64"
        />
      </StorySection>
    </div>
  ),
};

export const SourceAction: Story = {
  render: () => (
    <JobCardStory
      job={sourceActionJob()}
      initialJobExecutionId="exec-source-action"
      initialAttemptId="attempt-checkout-exec-source-action"
      sourceAvailable
      sourcePanelId="workflow-source-panel-story"
    />
  ),
};

export const Content: Story = {
  decorators: [
    (Story) => (
      <div className="w-440 bg-background-neutral-base p-16">
        <Story />
      </div>
    ),
  ],
  render: () => (
    <div className="flex flex-col gap-16">
      <StorySection label="regular long name">
        <JobCardStory job={longNameManyExecutionsJob()} initialJobExecutionId="exec-6" />
      </StorySection>
      <StorySection label="listening long name">
        <JobCardStory job={longNameListeningJob()} initialJobExecutionId="exec-long-listening-3" />
      </StorySection>
    </div>
  ),
};

export const TestListeningSwitcherOpen: Story = {
  render: () => (
    <JobCardStory job={listeningJobMixedExecutions()} initialJobExecutionId="exec-listen-6" />
  ),
  play: openJobExecutionSwitcher,
};

function JobCardStory({
  job,
  initialJobExecutionId,
  initialAttemptId = null,
  sourceAvailable,
  sourcePanelId,
}: {
  job: Job;
  initialJobExecutionId?: string | undefined;
  initialAttemptId?: string | null | undefined;
  sourceAvailable?: boolean | undefined;
  sourcePanelId?: string | undefined;
}) {
  const [selectedJobExecutionId, setSelectedJobExecutionId] = useState(initialJobExecutionId);
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(initialAttemptId);
  const selectedJobExecution = resolveJobExecution(job, selectedJobExecutionId);

  function selectJobExecution(jobExecutionId: string | undefined) {
    setSelectedJobExecutionId(jobExecutionId);
    setSelectedAttemptId(null);
  }

  return (
    <JobCard
      workspaceId={WORKSPACE_ID}
      job={job}
      selectedJobExecution={selectedJobExecution}
      selectedAttemptId={selectedAttemptId}
      onSelectedJobExecutionChange={selectJobExecution}
      onSelectedAttemptChange={(attemptId) => setSelectedAttemptId(attemptId ?? null)}
      renderExpandedStep={StepDetailPlaceholder}
      sourceAvailable={sourceAvailable}
      sourcePanelId={sourcePanelId}
      focusedSourceStepId={null}
      onOpenStepSource={() => undefined}
    />
  );
}

function StorySection({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <Text size="xs" className="font-code text-foreground-neutral-muted">
        {label}
      </Text>
      {children}
    </div>
  );
}

function StepDetailPlaceholder({attempt, attemptStatus}: StepExpandedContext) {
  return (
    <div className="rounded-6 border border-border-neutral-base bg-background-components-base px-12 py-10">
      <Text size="xs" className="font-code text-foreground-neutral-muted">
        attempt #{attempt} - {attemptStatus}
      </Text>
      <Text size="sm" className="text-foreground-neutral-subtle">
        Step detail content renders here in the run viewer.
      </Text>
    </div>
  );
}

function singleExecutionJob(): Job {
  return makeJob({
    id: 'job-build',
    name: 'build',
    status: 'succeeded',
    job_executions: [
      makeExecution({
        id: 'exec-1',
        job_id: 'job-build',
        sequence: 1,
        status: 'succeeded',
        queued_at: QUEUED_AT,
        started_at: STARTED_AT,
        finished_at: FINISHED_AT,
        steps: [
          makeStep('checkout', 'succeeded', 0, 'exec-1'),
          makeStep('install', 'succeeded', 1, 'exec-1'),
          makeStep('test', 'succeeded', 2, 'exec-1'),
        ],
      }),
    ],
  });
}

function keyFallbackJob(): Job {
  return makeJob({
    id: 'job-key-fallback',
    key: 'release-production',
    name: null,
    status: 'running',
    job_executions: [
      makeExecution({
        id: 'exec-key-fallback',
        job_id: 'job-key-fallback',
        sequence: 1,
        status: 'running',
        queued_at: QUEUED_AT,
        started_at: STARTED_AT,
        steps: [
          makeStep('package', 'succeeded', 0, 'exec-key-fallback'),
          makeStep('deploy', 'running', 1, 'exec-key-fallback'),
        ],
      }),
    ],
  });
}

function queueingExecutionJob(): Job {
  return makeJob({
    id: 'job-queueing',
    name: 'allocate-runner',
    status: 'pending',
    job_executions: [
      makeExecution({
        id: 'exec-queueing',
        job_id: 'job-queueing',
        sequence: 1,
        status: 'pending',
        queued_at: QUEUED_AT,
        started_at: null,
        finished_at: null,
        steps: [],
      }),
    ],
  });
}

function failedThenSucceededJob(): Job {
  return makeJob({
    id: 'job-deploy',
    name: 'deploy',
    status: 'succeeded',
    job_executions: [
      makeExecution({
        id: 'exec-1',
        job_id: 'job-deploy',
        sequence: 1,
        status: 'failed',
        status_reason: 'step_failed',
        queued_at: '2026-06-26T11:46:00.000Z',
        started_at: '2026-06-26T11:48:00.000Z',
        finished_at: '2026-06-26T11:50:30.000Z',
        steps: [
          makeStep('deploy', 'failed', 0, 'exec-1', {
            attempts: [
              workflowStepAttemptDto({
                id: 'attempt-deploy-1',
                step_id: 'step-deploy-1',
                status: 'failed',
                exit_code: 1,
                error: {message: 'Deployment failed'},
              }),
            ],
          }),
        ],
      }),
      makeExecution({
        id: 'exec-2',
        job_id: 'job-deploy',
        sequence: 2,
        status: 'succeeded',
        queued_at: QUEUED_AT,
        started_at: STARTED_AT,
        finished_at: FINISHED_AT,
        steps: [
          makeStep('deploy', 'succeeded', 0, 'exec-2'),
          makeStep('smoke-test', 'succeeded', 1, 'exec-2'),
        ],
      }),
    ],
  });
}

function runningRetryJob(): Job {
  return makeJob({
    id: 'job-release',
    name: 'release-production',
    status: 'running',
    job_executions: [
      makeExecution({
        id: 'exec-1',
        job_id: 'job-release',
        sequence: 1,
        status: 'failed',
        status_reason: 'step_failed',
        queued_at: '2026-06-26T11:46:00.000Z',
        started_at: '2026-06-26T11:48:00.000Z',
        finished_at: '2026-06-26T11:52:00.000Z',
        steps: [makeStep('package', 'failed', 0, 'exec-1')],
      }),
      makeExecution({
        id: 'exec-2',
        job_id: 'job-release',
        sequence: 2,
        status: 'running',
        queued_at: QUEUED_AT,
        started_at: STARTED_AT,
        steps: [
          makeStep('package', 'succeeded', 0, 'exec-2'),
          makeStep('publish', 'running', 1, 'exec-2', {
            current_attempt: 1,
            attempts: [
              workflowStepAttemptDto({
                id: 'attempt-publish-running',
                step_id: 'step-publish-exec-2',
                status: 'running',
                exit_code: null,
                finished_at: null,
              }),
            ],
          }),
          makeStep('notify', 'pending', 2, 'exec-2', {attempts: []}),
        ],
      }),
    ],
  });
}

function sourceActionJob(): Job {
  return makeJob({
    id: 'job-source-action',
    name: 'build',
    status: 'succeeded',
    job_executions: [
      makeExecution({
        id: 'exec-source-action',
        job_id: 'job-source-action',
        sequence: 1,
        status: 'succeeded',
        queued_at: QUEUED_AT,
        started_at: STARTED_AT,
        finished_at: FINISHED_AT,
        steps: [
          makeStep('checkout', 'succeeded', 0, 'exec-source-action', {
            source_location: {start_line: 12, end_line: 16},
          }),
          makeStep('install', 'succeeded', 1, 'exec-source-action'),
          makeStep('test', 'succeeded', 2, 'exec-source-action'),
        ],
      }),
    ],
  });
}

function pendingNoExecutionJob(): Job {
  return makeJob({
    id: 'job-pending-empty',
    name: 'wait-for-runner',
    status: 'pending',
    job_executions: [],
  });
}

function zeroExecutionJob(): Job {
  return makeJob({
    id: 'job-skipped',
    name: 'deploy-preview',
    status: 'skipped',
    status_reason: 'dependency_not_completed',
    dependencies: ['build'],
    job_executions: [],
  });
}

function cancelledNoExecutionJob(): Job {
  return makeJob({
    id: 'job-cancelled-empty',
    name: 'deploy-production',
    status: 'cancelled',
    status_reason: 'run_cancelled',
    job_executions: [],
  });
}

function finishedWithoutStepsJob(): Job {
  return makeJob({
    id: 'job-empty-steps',
    name: 'noop',
    status: 'succeeded',
    job_executions: [
      makeExecution({
        id: 'exec-empty',
        job_id: 'job-empty-steps',
        sequence: 1,
        status: 'succeeded',
        queued_at: QUEUED_AT,
        started_at: STARTED_AT,
        finished_at: FINISHED_AT,
        steps: [],
      }),
    ],
  });
}

function finishedWithoutExecutionJob(): Job {
  return makeJob({
    id: 'job-missing-execution',
    name: 'publish-artifacts',
    status: 'succeeded',
    job_executions: [],
  });
}

function carriedOverJob(): Job {
  return makeJob({
    id: 'job-test',
    name: 'test',
    status: 'succeeded',
    carried_over: true,
    job_executions: [],
  });
}

function listeningJobPending(): Job {
  return makeJob({
    id: 'job-listening-pending',
    name: 'release-gates',
    mode: 'listening',
    status: 'pending',
    listener_status: 'inactive',
    job_executions: [],
  });
}

function listeningJobNoExecutions(): Job {
  return makeJob({
    id: 'job-listening-empty',
    key: 'deploy-window',
    name: null,
    mode: 'listening',
    status: 'running',
    listener_status: 'listening',
    job_executions: [],
  });
}

function listeningJobResolvedNoExecutions(): Job {
  return makeJob({
    id: 'job-listening-resolved-empty',
    name: 'release-gates',
    mode: 'listening',
    status: 'succeeded',
    listener_status: 'resolved',
    resolution_reason: 'max_executions',
    job_executions: [],
  });
}

function listeningJobOneExecution(): Job {
  return makeJob({
    id: 'job-listening-one',
    name: 'release-gates',
    mode: 'listening',
    status: 'running',
    listener_status: 'listening',
    job_executions: [makeListeningExecution(1, 'running', 'job-listening-one', 'exec-listen-one')],
  });
}

function listeningJobMixedExecutions(): Job {
  return makeJob({
    id: 'job-listening-mixed',
    name: 'release-gates',
    mode: 'listening',
    status: 'running',
    listener_status: 'listening',
    job_executions: [
      ...Array.from({length: 2}, (_, index) =>
        makeListeningExecution(index + 1, 'running', 'job-listening-mixed'),
      ),
      ...Array.from({length: 3}, (_, index) =>
        makeListeningExecution(index + 3, 'succeeded', 'job-listening-mixed'),
      ),
      makeListeningExecution(6, 'failed', 'job-listening-mixed', 'exec-listen', {
        trigger_events: [
          makeTriggerEvent(6, 'deployment_status'),
          makeTriggerEvent(7, 'check_run'),
        ],
      }),
    ],
  });
}

function listeningJobResolved(): Job {
  return makeJob({
    id: 'job-listening-resolved',
    name: 'release-production-gates',
    mode: 'listening',
    status: 'failed',
    listener_status: 'resolved',
    resolution_reason: 'max_executions',
    job_executions: Array.from({length: 4}, (_, index) =>
      makeListeningExecution(
        index + 1,
        index === 3 ? 'failed' : 'succeeded',
        'job-listening-resolved',
        'exec-listen-resolved',
      ),
    ),
  });
}

function manyExecutionsListeningJob(name: string, id: string): Job {
  return makeJob({
    id,
    name,
    mode: 'listening',
    status: 'running',
    listener_status: 'listening',
    job_executions: Array.from({length: 64}, (_, index) => {
      const sequence = index + 1;
      const status = manyExecutionStatus(sequence);
      return makeListeningExecution(sequence, status, id, `exec-many-${id}`, {
        name: variedExecutionName(sequence),
      });
    }),
  });
}

function longNameManyExecutionsJob(): Job {
  return makeJob({
    id: 'job-long',
    name: 'release-production-multi-region-with-canary-validation-and-post-deploy-observability',
    status: 'running',
    job_executions: Array.from({length: 6}, (_, index) => {
      const sequence = index + 1;
      const status: WorkflowRunJobExecutionDetailDto['status'] =
        sequence < 6 ? 'failed' : 'running';
      return makeExecution({
        id: `exec-${sequence}`,
        job_id: 'job-long',
        sequence,
        status,
        status_reason: status === 'failed' ? 'step_failed' : null,
        queued_at: `2026-06-26T11:${String(36 + index * 3).padStart(2, '0')}:00.000Z`,
        started_at: `2026-06-26T11:${String(38 + index * 3).padStart(2, '0')}:00.000Z`,
        finished_at:
          status === 'failed'
            ? `2026-06-26T11:${String(40 + index * 3).padStart(2, '0')}:00.000Z`
            : null,
        steps: [
          makeStep(
            'run-production-canary-smoke-tests-with-cross-region-checkout-payment-and-notification-validation',
            status,
            0,
            `exec-${sequence}`,
          ),
        ],
      });
    }),
  });
}

function longNameListeningJob(): Job {
  return makeJob({
    id: 'job-long-listening',
    name: 'release-production-multi-region-with-canary-validation-and-post-deploy-observability',
    mode: 'listening',
    status: 'running',
    listener_status: 'listening',
    job_executions: Array.from({length: 3}, (_, index) =>
      makeListeningExecution(
        index + 1,
        index === 2 ? 'running' : 'succeeded',
        'job-long-listening',
        'exec-long-listening',
      ),
    ),
  });
}

function makeListeningExecution(
  sequence: number,
  status: WorkflowRunJobExecutionDetailDto['status'],
  jobId: string,
  idPrefix = 'exec-listen',
  overrides: Partial<WorkflowRunJobExecutionDetailDto> = {},
): WorkflowRunJobExecutionDetailDto {
  return makeExecution({
    id: `${idPrefix}-${sequence}`,
    job_id: jobId,
    sequence,
    name: `event-${sequence}`,
    status,
    status_reason: status === 'failed' ? 'step_failed' : null,
    queued_at: listeningTimestamp(sequence, 0),
    started_at: listeningTimestamp(sequence, 2),
    finished_at: status === 'running' ? null : listeningTimestamp(sequence, 3),
    trigger_events: [makeTriggerEvent(sequence, variedExecutionName(sequence))],
    steps: [makeStep('handle-event', status, 0, `${idPrefix}-${sequence}`)],
    ...overrides,
  });
}

function makeTriggerEvent(
  sequence: number,
  event = `event-${sequence}`,
): WorkflowExecutionEventDto {
  return {
    source: 'github',
    event,
    delivery_id: `delivery-${sequence}`,
    received_at: listeningTimestamp(sequence, 1),
    data: {sequence},
  };
}

function manyExecutionStatus(sequence: number): WorkflowRunJobExecutionDetailDto['status'] {
  if (sequence === 64) return 'running';
  if (sequence % 11 === 0) return 'failed';
  if (sequence % 7 === 0) return 'cancelled';
  return 'succeeded';
}

function variedExecutionName(sequence: number): string {
  const names = [
    'push',
    'gate-opened',
    'deployment-status-received',
    'manual-approval-received-from-release-coordinator',
    'production-canary-validation-completed-for-eu-west-and-us-east',
  ];

  return names[(sequence - 1) % names.length] ?? 'event';
}

function listeningTimestamp(sequence: number, offsetMinutes: number): string {
  return new Date(LISTENING_BASE_AT + (sequence + offsetMinutes) * 60_000).toISOString();
}

function makeJob(overrides: Partial<WorkflowRunJobDetailDto>): Job {
  return workflowJob(overrides);
}

function makeExecution(
  overrides: Partial<WorkflowRunJobExecutionDetailDto> & {
    id: string;
    job_id: string;
    sequence: number;
  },
): WorkflowRunJobExecutionDetailDto {
  return workflowJobExecutionDto(overrides);
}

function makeStep(
  name: string,
  status: string,
  position: number,
  jobExecutionId: string,
  overrides: Partial<WorkflowRunStepDetailDto> = {},
): WorkflowRunStepDetailDto {
  const stepId = `step-${name}-${jobExecutionId}`;
  return workflowStepDto({
    id: stepId,
    job_execution_id: jobExecutionId,
    name,
    position,
    status,
    attempts:
      overrides.attempts ??
      (status === 'pending'
        ? []
        : [
            workflowStepAttemptDto({
              id: `attempt-${name}-${jobExecutionId}`,
              step_id: stepId,
              status,
              exit_code: status === 'failed' ? 1 : null,
              finished_at: status === 'running' ? null : FINISHED_AT,
            }),
          ]),
    ...overrides,
  });
}
