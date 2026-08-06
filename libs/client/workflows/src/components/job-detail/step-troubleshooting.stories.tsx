import type {Meta, StoryObj} from '@storybook/react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useState} from 'react';
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
                evaluated_at: 'step-dispatch',
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
