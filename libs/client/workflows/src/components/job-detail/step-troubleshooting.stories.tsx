import type {StepAttemptDto} from '@shipfox/api-workflows-dto';
import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
import type {StepAttemptDetail} from '#core/workflow-run.js';
import {stepAttemptDetailQueryKeys} from '#hooks/api/step-attempt-detail.js';
import {
  workflowJob,
  workflowJobExecutionDto,
  workflowStepAttemptDto,
  workflowStepDto,
} from '#test/fixtures/workflow-run.js';
import {buildStepListModel, type StepListEntryModel} from '../step-list/step-list-model.js';
import {StepInspectorSheet} from './step-troubleshooting.js';

const meta = {
  title: 'Workflows/StepInspector',
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const FailedStep: Story = {
  render: () => <FailedStepStory />,
};

export const SuccessfulToolStep: Story = {
  render: () => <ToolStepStory outcome="succeeded" />,
};

export const FailedToolStep: Story = {
  render: () => <ToolStepStory outcome="failed" />,
};

export const RetryingToolStep: Story = {
  render: () => <ToolStepStory outcome="running" />,
};

function ToolStepStory({outcome}: {outcome: 'succeeded' | 'failed' | 'running'}) {
  const entry = toolStepEntry(outcome);
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}},
    });
    client.setQueryData(
      stepAttemptDetailQueryKeys.detail(entry.step.id, entry.attempt),
      toolStepDetail(entry.step.id),
    );
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000002"
          onViewLogs={() => undefined}
        />
      </main>
    </QueryClientProvider>
  );
}

function FailedStepStory() {
  const [queryClient] = useState(
    () => new QueryClient({defaultOptions: {queries: {staleTime: Number.POSITIVE_INFINITY}}}),
  );
  const entry = failedStepEntry();

  return (
    <QueryClientProvider client={queryClient}>
      <main className="min-h-screen bg-background-neutral-base p-16">
        <StepInspectorSheet
          entry={entry}
          open
          onOpenChange={() => undefined}
          workspaceSlug="acme"
          projectSlug="platform"
          workflowRunId="11111111-1111-4111-8111-111111111111"
          runAttempt={1}
          jobId="44444444-4444-4444-8444-000000000001"
        />
      </main>
    </QueryClientProvider>
  );
}

function failedStepEntry(): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000001';
  const executionId = '77777777-7777-4777-8777-000000000001';
  const stepId = '55555555-5555-4555-8555-000000000001';
  const attemptId = '66666666-6666-4666-8666-000000000001';
  const job = workflowJob({
    id: jobId,
    name: 'verification',
    key: 'verification',
    status: 'failed',
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status: 'failed',
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Run verification suite',
            key: 'run-verification',
            status: 'failed',
            status_reason: 'agent_invocation_failed',
            config: {run: 'pnpm test --filter=@shipfox/client-workflows'},
            evaluation_trace: [
              {
                expression: 'inputs["branch"]',
                roots: ['inputs'],
                fill_target: 'step-dispatch',
                evaluated_at: '2026-06-21T12:04:00.000Z',
                field: 'branch',
                value: 'main',
              },
            ],
            error: {
              message: 'The verification agent returned a non-zero exit code.',
              reason: 'agent_invocation_failed',
              category: 'user',
              exit_code: 1,
            },
            attempts: [
              workflowStepAttemptDto({
                id: attemptId,
                step_id: stepId,
                status: 'failed',
                exit_code: 1,
                output: {summary: 'Tests failed before the report was uploaded.'},
                outputs: {failed_tests: 3},
                error: {
                  message: 'The verification agent returned a non-zero exit code.',
                  reason: 'agent_invocation_failed',
                  category: 'user',
                  exit_code: 1,
                },
                finished_at: '2026-06-21T12:04:00.000Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');

  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Story fixture is missing a step attempt.');

  return entry;
}

function toolStepEntry(outcome: 'succeeded' | 'failed' | 'running'): StepListEntryModel {
  const jobId = '44444444-4444-4444-8444-000000000002';
  const executionId = '77777777-7777-4777-8777-000000000002';
  const stepId = '55555555-5555-4555-8555-000000000002';
  const attemptId = '66666666-6666-4666-8666-000000000002';
  const failed = outcome === 'failed';
  const retrying = outcome === 'running';
  const invocations = toolStoryInvocations(outcome);
  const error = failed
    ? {
        message: 'Slack rejected the token for this workspace.',
        code: 'access-denied',
        reason: 'tool_error' as const,
      }
    : null;
  const job = workflowJob({
    id: jobId,
    name: 'release',
    key: 'release',
    status: outcome,
    job_executions: [
      workflowJobExecutionDto({
        id: executionId,
        job_id: jobId,
        status: outcome,
        steps: [
          workflowStepDto({
            id: stepId,
            job_execution_id: executionId,
            name: 'Post release notice',
            key: 'notify-release',
            status: outcome,
            source_location: {start_line: 20, end_line: 29},
            type: 'tool',
            config: {
              tool: {
                provider: 'slack',
                connection_slug: 'release-notifications',
                id: 'chat_post_message',
                method: 'post',
                sensitivity: 'write',
              },
            },
            error,
            attempts: [
              workflowStepAttemptDto({
                id: attemptId,
                step_id: stepId,
                status: outcome,
                output:
                  outcome === 'succeeded'
                    ? {result: {ts: '1717171717.000100', channel: 'C012345'}}
                    : null,
                outputs: outcome === 'succeeded' ? {message_id: '1717171717.000100'} : null,
                error,
                invocations,
                finished_at: retrying ? null : '2026-06-26T11:59:57.412Z',
              }),
            ],
          }),
        ],
      }),
    ],
  });
  const execution = job.jobExecutions[0];
  if (!execution) throw new Error('Story fixture is missing a job execution.');
  const entry = buildStepListModel({job, jobExecution: execution}).entries[0];
  if (!entry) throw new Error('Story fixture is missing a step attempt.');
  return entry;
}

function toolStoryInvocations(
  outcome: 'succeeded' | 'failed' | 'running',
): StepAttemptDto['invocations'] {
  if (outcome === 'running') {
    return [
      {
        call_index: 0,
        started_at: '2026-06-26T11:59:57.000Z',
        finished_at: '2026-06-26T11:59:57.412Z',
        outcome: 'error',
        error_code: 'rate-limited',
        duration_ms: 412,
      },
      {
        call_index: 1,
        started_at: '2026-06-26T11:59:58.000Z',
        next_due_at: '2026-06-26T12:00:05.000Z',
      },
    ];
  }
  if (outcome === 'failed') {
    return [
      {
        call_index: 0,
        started_at: '2026-06-26T11:59:57.000Z',
        finished_at: '2026-06-26T11:59:57.412Z',
        outcome: 'error',
        error_code: 'access-denied',
        duration_ms: 412,
      },
    ];
  }
  return [
    {
      call_index: 0,
      started_at: '2026-06-26T11:59:57.000Z',
      finished_at: '2026-06-26T11:59:57.412Z',
      outcome: 'success',
      duration_ms: 412,
    },
  ];
}

function toolStepDetail(stepId: string): StepAttemptDetail {
  return {
    stepId,
    attempt: 1,
    session: null,
    authoredConfig: {
      tool: {
        provider: 'slack',
        connection: 'release-notifications',
        id: 'chat_post_message',
        with: {channel: `\${{ inputs.channel }}`, text: `\${{ inputs.message }}`},
      },
    },
    config: {
      tool: {
        provider: 'slack',
        connection_slug: 'release-notifications',
        id: 'chat_post_message',
        with: {channel: '#releases', text: 'Version 2.4.0 is live.'},
      },
    },
    evaluationTrace: null,
  };
}
