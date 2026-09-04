import {type ClientUsagePricing, ClientUsagePricingProvider} from '@shipfox/client-shell/runtime';
import type {Meta, StoryObj} from '@storybook/react';
import type {JobExecutionUsage} from '#core/usage.js';
import {JobUsageCells} from './job-usage-cells.js';

const JOB_EXECUTION_ID = '33333333-3333-4333-8333-333333333333';

const usage: JobExecutionUsage = {
  jobExecution: {
    jobId: '22222222-2222-4222-8222-222222222222',
    jobExecutionId: JOB_EXECUTION_ID,
    workflowRunId: '11111111-1111-4111-8111-111111111111',
    workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
    workspaceId: '55555555-5555-4555-8555-555555555555',
    projectId: '66666666-6666-4666-8666-666666666666',
    definitionId: null,
    jobKey: 'build',
    runNumber: 42,
    requestedLabels: ['linux'],
    runnerLabels: ['linux'],
    templateKey: null,
    provisionerId: null,
    provisionerScope: null,
    providerKind: 'managed',
    launchKind: 'ephemeral',
    runnerClass: 'standard',
    runnerArch: 'x86_64',
    runnerCpu: '4',
    managed: true,
    queuedAt: '2026-06-26T11:59:00.000Z',
    startedAt: '2026-06-26T11:59:05.000Z',
    finishedAt: '2026-06-26T12:00:05.000Z',
    leaseExpiredAt: null,
    status: 'succeeded',
    statusReason: null,
    cancellationReason: null,
    durationSeconds: 60,
    state: 'terminated',
    recordedAt: '2026-06-26T12:00:05.000Z',
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
      jobExecutionId: JOB_EXECUTION_ID,
      stepId: '99999999-9999-4999-8999-999999999999',
      stepAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      upstream: 'openai',
      model: 'gpt-5',
      dialect: 'openai-responses',
      windowStart: '2026-06-26T11:59:20.000Z',
      windowEnd: '2026-06-26T11:59:30.000Z',
      requestCount: 1,
      inputTokens: 2_000,
      outputTokens: 600,
      cacheCreationTokens: 0,
      cacheReadTokens: 200,
      reasoningTokens: 120,
      recordedAt: '2026-06-26T11:59:30.000Z',
    },
  ],
};

const pricing: ClientUsagePricing = {
  resolveCosts: () => new Map(),
  estimate: () => ({amount: 0.18, state: 'estimated'}),
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

const meta = {
  title: 'Usage/JobUsageCells',
  component: JobUsageCells,
  parameters: {layout: 'padded'},
} satisfies Meta<typeof JobUsageCells>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithoutPricing: Story = {
  args: {usage},
};

export const WithPricing: Story = {
  args: {usage},
  decorators: [
    (Story) => (
      <ClientUsagePricingProvider usagePricing={pricing}>
        <Story />
      </ClientUsagePricingProvider>
    ),
  ],
};
