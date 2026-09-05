import type {Meta, StoryObj} from '@storybook/react';
import type {KeyboardEventHandler} from 'react';
import type {JobExecutionStatus, JobMode, JobStatus, ListenerStatus} from '#core/workflow-run.js';
import {workflowJobExecutionDto, workflowRunOverviewJob} from '#test/fixtures/workflow-run.js';
import type {JobGraphNode} from './graph-model.js';
import {JobNode} from './job-node.js';

const statuses: JobStatus[] = ['pending', 'running', 'succeeded', 'failed', 'cancelled', 'skipped'];
const ignoreKeyDown: KeyboardEventHandler<HTMLButtonElement> = () => undefined;
const statusModes: JobMode[] = ['one_shot', 'listening'];

const meta = {
  title: 'Workflows/JobNode',
  component: JobNode,
  parameters: {layout: 'centered'},
  decorators: [
    (Story) => (
      <div className="bg-background-subtle-base p-16">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof JobNode>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
  render: () => (
    <JobNode
      node={makeNode({
        id: 'job-build',
        label: 'build',
        status: 'running',
        position: 0,
        dependencies: [],
      })}
      selected
      onSelect={() => undefined}
      onKeyDown={ignoreKeyDown}
    />
  ),
};

export const Statuses: Story = {
  render: () => (
    <div className="grid w-440 grid-cols-2 gap-18">
      {statusModes.map((mode) => (
        <div key={mode} className="flex flex-col gap-12">
          <span className="font-code text-xs text-foreground-neutral-muted">{mode}</span>
          {statuses.map((status, row) => (
            <JobNode
              key={`${mode}-${status}`}
              node={makeNode({
                id: `job-${mode}-${status}`,
                label: status,
                mode,
                status,
                listenerStatus:
                  mode === 'listening' && status === 'running' ? 'listening' : undefined,
                position: row,
                dependencies: [],
              })}
              selected={false}
              onSelect={() => undefined}
              onKeyDown={ignoreKeyDown}
            />
          ))}
        </div>
      ))}
    </div>
  ),
};

// Storybook freezes `Date.now()` at 2026-06-26T12:00:00Z (see `.storybook/preview.tsx`),
// so anchors near that instant render deterministic live durations for Argos.
const QUEUED_AT = '2026-06-26T11:54:00.000Z'; // queued 6m
const STARTED_AT = '2026-06-26T11:57:46.000Z'; // running 2m 14s
const FINISHED_AT = '2026-06-26T12:00:00.000Z'; // started→finished span 2m 14s

const durationNodes = [
  makeNode({
    id: 'job-queueing',
    label: 'queueing',
    status: 'pending',
    position: 0,
    dependencies: [],
    queuedAt: QUEUED_AT,
  }),
  makeNode({
    id: 'job-running',
    label: 'running',
    status: 'running',
    position: 1,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
  }),
  makeNode({
    id: 'job-ran',
    label: 'ran',
    status: 'succeeded',
    position: 2,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
    finishedAt: FINISHED_AT,
  }),
  makeNode({
    id: 'job-terminal-no-finish',
    label: 'terminal no finish',
    status: 'failed',
    position: 3,
    dependencies: [],
    queuedAt: QUEUED_AT,
    startedAt: STARTED_AT,
  }),
  makeNode({
    id: 'job-skipped',
    label: 'skipped',
    status: 'skipped',
    position: 4,
    dependencies: [],
  }),
  makeNode({
    id: 'job-cancelled-before-start',
    label: 'cancelled before start',
    status: 'cancelled',
    position: 5,
    dependencies: [],
    queuedAt: QUEUED_AT,
    finishedAt: FINISHED_AT,
  }),
];

export const Durations: Story = {
  render: () => (
    <div className="grid w-440 grid-cols-1 gap-12">
      {durationNodes.map((node) => (
        <JobNode
          key={node.id}
          node={node}
          selected={false}
          onSelect={() => undefined}
          onKeyDown={ignoreKeyDown}
        />
      ))}
    </div>
  ),
};

export const ListeningProgression: Story = {
  render: () => (
    <div className="grid w-440 grid-cols-1 gap-12">
      <JobNode
        node={makeNode({
          id: 'job-completed-dependency',
          label: 'completed dependency',
          status: 'succeeded',
          position: 0,
          dependencies: [],
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <JobNode
        node={makeNode({
          id: 'job-listening-pending',
          label: 'pending listener',
          mode: 'listening',
          status: 'pending',
          position: 1,
          dependencies: ['build'],
          jobExecutions: [],
          queuedAt: QUEUED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <JobNode
        node={makeNode({
          id: 'job-listening-running',
          label: 'listening, 0 executions',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 2,
          dependencies: [],
          jobExecutions: [],
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <JobNode
        node={makeNode({
          id: 'job-one-running-execution',
          label: 'listening, 1 running execution',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 3,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-one-running-execution', ['running']),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <JobNode
        node={makeNode({
          id: 'job-mixed-executions',
          label: 'listening, mixed executions',
          mode: 'listening',
          status: 'running',
          listenerStatus: 'listening',
          position: 4,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-mixed-executions', [
            'running',
            'running',
            'succeeded',
            'succeeded',
            'succeeded',
            'failed',
          ]),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <JobNode
        node={makeNode({
          id: 'job-listener-succeeded',
          label: 'resolved succeeded',
          mode: 'listening',
          status: 'succeeded',
          listenerStatus: 'resolved',
          position: 5,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-listener-succeeded', [
            'succeeded',
            'succeeded',
            'succeeded',
            'succeeded',
          ]),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
          finishedAt: FINISHED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
      <JobNode
        node={makeNode({
          id: 'job-listener-failed',
          label: 'resolved failed',
          mode: 'listening',
          status: 'failed',
          listenerStatus: 'resolved',
          position: 6,
          dependencies: [],
          jobExecutions: makeExecutionsByStatus('job-listener-failed', [
            'succeeded',
            'failed',
            'failed',
          ]),
          queuedAt: QUEUED_AT,
          startedAt: STARTED_AT,
          finishedAt: FINISHED_AT,
        })}
        selected={false}
        onSelect={() => undefined}
        onKeyDown={ignoreKeyDown}
      />
    </div>
  ),
};

function makeNode({
  id,
  label,
  status,
  position,
  dependencies,
  mode = 'one_shot',
  listenerStatus = 'inactive',
  jobExecutions,
  queuedAt = null,
  startedAt = null,
  finishedAt = null,
}: {
  id: string;
  label: string;
  status: JobStatus;
  position: number;
  dependencies: string[];
  mode?: JobMode;
  listenerStatus?: ListenerStatus;
  jobExecutions?: ReturnType<typeof workflowJobExecutionDto>[];
  queuedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}): JobGraphNode {
  const shouldCreateExecution =
    jobExecutions === undefined && (queuedAt !== null || startedAt !== null || finishedAt !== null);
  const overrides = {
    id,
    name: label,
    mode,
    status,
    listener_status: listenerStatus,
    position,
    dependencies,
    job_executions: shouldCreateExecution
      ? [
          workflowJobExecutionDto({
            job_id: id,
            status: status === 'skipped' ? 'cancelled' : status,
            queued_at: queuedAt,
            started_at: startedAt,
            finished_at: finishedAt,
          }),
        ]
      : jobExecutions,
  };
  const job = workflowRunOverviewJob(overrides);
  return Object.assign(Object.create(Object.getPrototypeOf(job)), job, {
    column: 0,
    row: position,
    currentDependencyCount: dependencies.length,
  });
}

function makeExecutionsByStatus(
  jobId: string,
  statuses: readonly JobExecutionStatus[],
): ReturnType<typeof workflowJobExecutionDto>[] {
  return statuses.map((status, index) => ({
    id: `exec-${index + 1}`,
    job_id: jobId,
    sequence: index + 1,
    name: `execution-${index + 1}`,
    status,
    status_reason: status === 'failed' ? 'step_failed' : null,
    queued_at: '2026-06-26T11:54:00.000Z',
    started_at: '2026-06-26T11:57:46.000Z',
    finished_at: status === 'running' ? null : '2026-06-26T12:00:00.000Z',
    timed_out_at: null,
    created_at: '2026-06-26T11:54:00.000Z',
    updated_at: '2026-06-26T12:00:00.000Z',
    steps: [],
  }));
}
