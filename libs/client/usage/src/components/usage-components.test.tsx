// @vitest-environment jsdom
import {type ClientUsagePricing, ClientUsagePricingProvider} from '@shipfox/client-shell/runtime';
import {render, screen, waitFor} from '@testing-library/react';
import type {
  JobExecutionUsage,
  RunUsage,
  UsageInferenceSegment,
  UsageJobExecution,
} from '#core/usage.js';
import {JobUsageCells} from './job-usage-cells.js';
import {RunUsageSummary} from './run-usage-summary.js';
import {StepInferenceTable} from './step-inference-table.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const EXECUTION_ID = '33333333-3333-4333-8333-333333333333';
const STEP_ID = '99999999-9999-4999-8999-999999999999';
const STEP_ATTEMPT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const jobExecution: UsageJobExecution = {
  jobId: '22222222-2222-4222-8222-222222222222',
  jobExecutionId: EXECUTION_ID,
  workflowRunId: RUN_ID,
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
};

const segment: UsageInferenceSegment = {
  id: '88888888-8888-4888-8888-888888888888',
  segmentKey: 'gateway:build:1',
  source: 'gateway',
  workspaceId: jobExecution.workspaceId,
  projectId: jobExecution.projectId,
  workflowRunId: RUN_ID,
  workflowRunAttemptId: jobExecution.workflowRunAttemptId,
  jobId: jobExecution.jobId,
  jobExecutionId: EXECUTION_ID,
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
  cacheCreationTokens: 0,
  cacheReadTokens: 100,
  reasoningTokens: 80,
  recordedAt: '2026-06-26T11:59:30.000Z',
};

const runUsage: RunUsage = {
  jobExecutions: [jobExecution],
  inferenceSegments: [segment],
};

const jobUsage: JobExecutionUsage = {
  jobExecution,
  inferenceSegments: [segment],
};

const pricing: ClientUsagePricing = {
  resolveCosts: (refs) =>
    new Map(
      refs.map((reference) => [
        `${reference.kind}:${reference.id}`,
        {amount: 1.2, state: 'resolved'},
      ]),
    ),
  estimate: () => ({amount: 0.9, state: 'estimated'}),
  formatMoney: (amount) => `$${amount.toFixed(2)}`,
};

describe('Usage components', () => {
  test('renders quantities without a pricing seam', () => {
    render(<RunUsageSummary runId={RUN_ID} usage={runUsage} />);

    expect(screen.getByText('1,880 tokens')).toBeVisible();
    expect(screen.getByText('2 requests')).toBeVisible();
    expect(screen.queryByText('$1.20')).not.toBeInTheDocument();
  });

  test('renders resolved cost only when pricing returns one', async () => {
    render(
      <ClientUsagePricingProvider usagePricing={pricing}>
        <RunUsageSummary runId={RUN_ID} usage={runUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getByText('$1.20')).toBeVisible());
    expect(screen.getByText('$1.20')).toHaveAttribute('data-usage-cost-state', 'resolved');
  });

  test('renders an estimated job cost while preserving job quantities', async () => {
    const estimatingPricing: ClientUsagePricing = {
      ...pricing,
      resolveCosts: () => new Map(),
    };
    render(
      <ClientUsagePricingProvider usagePricing={estimatingPricing}>
        <JobUsageCells usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    expect(screen.getByText('1,880 tokens')).toBeVisible();
    await waitFor(() => expect(screen.getByText('est. $0.90')).toBeVisible());
    expect(screen.getByText('est. $0.90')).toHaveAttribute('data-usage-cost-state', 'estimated');
  });

  test('does not estimate a running job with an unknown duration', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimate = vi.fn(() => ({amount: 0.9, state: 'estimated' as const}));
    const runningUsage: JobExecutionUsage = {
      ...jobUsage,
      jobExecution: {
        ...jobExecution,
        durationSeconds: null,
        finishedAt: null,
        state: 'running',
        status: null,
      },
    };
    render(
      <ClientUsagePricingProvider usagePricing={{...pricing, resolveCosts, estimate}}>
        <JobUsageCells usage={runningUsage} />
      </ClientUsagePricingProvider>,
    );

    expect(screen.getByText('— compute')).toBeVisible();
    await waitFor(() => expect(resolveCosts).toHaveBeenCalledTimes(1));
    expect(estimate).not.toHaveBeenCalled();
  });

  test('normalizes an absent pricing resolution before estimating usage', async () => {
    render(
      <ClientUsagePricingProvider
        usagePricing={{...pricing, resolveCosts: () => undefined as never}}
      >
        <JobUsageCells usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    expect(screen.getByText('1,880 tokens')).toBeVisible();
    await waitFor(() => expect(screen.getByText('est. $0.90')).toBeVisible());
  });

  test('estimates one aggregate cost for multiple rows sharing a step attempt', async () => {
    const estimate = vi.fn(({quantities}: {quantities: {requestCount: number}}) => ({
      amount: quantities.requestCount,
      state: 'estimated' as const,
    }));
    const secondSegment: UsageInferenceSegment = {
      ...segment,
      id: '77777777-7777-4777-8777-777777777777',
      upstream: 'openai',
      model: 'gpt-5',
      requestCount: 3,
      inputTokens: 400,
    };
    const multipleRowsUsage: JobExecutionUsage = {
      ...jobUsage,
      inferenceSegments: [segment, secondSegment],
    };
    render(
      <ClientUsagePricingProvider
        usagePricing={{...pricing, resolveCosts: () => new Map(), estimate}}
      >
        <StepInferenceTable usage={multipleRowsUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getByText('est. $5.00')).toBeVisible());
    expect(estimate).toHaveBeenCalledTimes(1);
    expect(estimate).toHaveBeenCalledWith({
      reference: {kind: 'step-attempt', id: STEP_ATTEMPT_ID},
      quantities: expect.objectContaining({requestCount: 5, inputTokens: 1_600}),
    });
  });

  test('does not reload pricing when equivalent request inputs are recreated', async () => {
    const resolveCosts = vi.fn(() => new Map());
    const estimatingPricing: ClientUsagePricing = {
      ...pricing,
      resolveCosts,
    };
    function Usage({revision}: {revision: number}) {
      return (
        <ClientUsagePricingProvider usagePricing={estimatingPricing}>
          <JobUsageCells
            usage={{...jobUsage, inferenceSegments: [...jobUsage.inferenceSegments]}}
            className={String(revision)}
          />
        </ClientUsagePricingProvider>
      );
    }

    const {rerender} = render(<Usage revision={1} />);
    await waitFor(() => expect(resolveCosts).toHaveBeenCalledTimes(1));

    rerender(<Usage revision={2} />);

    expect(resolveCosts).toHaveBeenCalledTimes(1);
  });

  test('renders step inference quantities and hides the absent cost column', () => {
    render(
      <StepInferenceTable
        usage={jobUsage}
        stepLabels={new Map([[STEP_ID, 'Generate release notes']])}
        stepAttemptLabels={new Map([[STEP_ATTEMPT_ID, '1']])}
      />,
    );

    expect(screen.getByText('Generate release notes')).toBeVisible();
    expect(screen.getByText('claude-sonnet-4')).toBeVisible();
    expect(screen.getByText('1,880')).toBeVisible();
    expect(screen.queryByRole('columnheader', {name: 'Cost'})).not.toBeInTheDocument();
  });

  test('adds the cost column after pricing resolves a step attempt', async () => {
    render(
      <ClientUsagePricingProvider usagePricing={pricing}>
        <StepInferenceTable usage={jobUsage} />
      </ClientUsagePricingProvider>,
    );

    await waitFor(() => expect(screen.getByRole('columnheader', {name: 'Cost'})).toBeVisible());
    expect(screen.getByText('$1.20')).toBeVisible();
  });
});
