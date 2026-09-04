import {type ClientUsagePricing, ClientUsagePricingProvider} from '@shipfox/client-shell/runtime';
import type {Meta, StoryObj} from '@storybook/react';
import type {JobExecutionUsage} from '#core/usage.js';
import {StepInferenceTable} from './step-inference-table.js';

const STEP_ID = '99999999-9999-4999-8999-999999999999';
const STEP_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const usage: JobExecutionUsage = {
  jobExecution: {
    jobId: '22222222-2222-4222-8222-222222222222',
    jobExecutionId: '33333333-3333-4333-8333-333333333333',
    workflowRunId: '11111111-1111-4111-8111-111111111111',
    workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
    workspaceId: '55555555-5555-4555-8555-555555555555',
    projectId: '66666666-6666-4666-8666-666666666666',
    definitionId: null,
    jobKey: 'build',
    runNumber: 42,
    requestedLabels: null,
    runnerLabels: null,
    templateKey: null,
    provisionerId: null,
    provisionerScope: null,
    providerKind: null,
    launchKind: null,
    runnerClass: null,
    runnerArch: null,
    runnerCpu: null,
    managed: null,
    queuedAt: null,
    startedAt: null,
    finishedAt: null,
    leaseExpiredAt: null,
    status: 'running',
    statusReason: null,
    cancellationReason: null,
    durationSeconds: null,
    state: 'running',
    recordedAt: null,
  },
  inferenceSegments: [
    {
      id: '88888888-8888-4888-8888-888888888888',
      segmentKey: 'gateway:build:1',
      source: 'gateway',
      workspaceId: '55555555-5555-4555-8555-555555555555',
      projectId: '66666666-6666-4666-8666-666666666666',
      workflowRunId: '11111111-1111-4111-8111-111111111111',
      workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
      jobId: '22222222-2222-4222-8222-222222222222',
      jobExecutionId: '33333333-3333-4333-8333-333333333333',
      stepId: STEP_ID,
      stepAttemptId: STEP_ATTEMPT_ID,
      upstream: 'anthropic',
      model: 'claude-sonnet-4',
      dialect: 'anthropic-messages',
      windowStart: '2026-06-26T11:59:20.000Z',
      windowEnd: '2026-06-26T11:59:30.000Z',
      requestCount: 2,
      inputTokens: 1_200,
      outputTokens: 500,
      cacheCreationTokens: 40,
      cacheReadTokens: 100,
      reasoningTokens: 80,
      recordedAt: '2026-06-26T11:59:30.000Z',
    },
  ],
};

const pricing: ClientUsagePricing = {
  resolveCosts: (refs) =>
    new Map(
      refs.map((reference) => [
        `${reference.kind}:${reference.id}`,
        {amount: 0.12, state: 'resolved'},
      ]),
    ),
  estimate: () => ({amount: 0.12, state: 'estimated'}),
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

const meta = {
  title: 'Usage/StepInferenceTable',
  component: StepInferenceTable,
  parameters: {layout: 'padded'},
} satisfies Meta<typeof StepInferenceTable>;

export default meta;
type Story = StoryObj<typeof meta>;

const args = {
  usage,
  stepLabels: new Map([[STEP_ID, 'Generate release notes']]),
  stepAttemptLabels: new Map([[STEP_ATTEMPT_ID, '1']]),
};

export const WithoutPricing: Story = {args};

export const WithPricing: Story = {
  args,
  decorators: [
    (Story) => (
      <ClientUsagePricingProvider usagePricing={pricing}>
        <Story />
      </ClientUsagePricingProvider>
    ),
  ],
};
