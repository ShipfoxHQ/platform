import {
  groupInferenceSegmentsByStepAttempt,
  summarizeRunUsage,
  type UsageInferenceSegment,
  type UsageJobExecution,
} from './usage.js';

const RUN_ID = '11111111-1111-4111-8111-111111111111';

function segment(overrides: Partial<UsageInferenceSegment> = {}): UsageInferenceSegment {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    segmentKey: 'gateway:segment',
    source: 'gateway',
    workspaceId: '55555555-5555-4555-8555-555555555555',
    projectId: '66666666-6666-4666-8666-666666666666',
    workflowRunId: RUN_ID,
    workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
    jobId: '22222222-2222-4222-8222-222222222222',
    jobExecutionId: '33333333-3333-4333-8333-333333333333',
    stepId: '99999999-9999-4999-8999-999999999999',
    stepAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    upstream: 'anthropic',
    model: 'claude-sonnet-4',
    dialect: 'anthropic-messages',
    windowStart: '2026-06-26T11:59:20.000Z',
    windowEnd: '2026-06-26T11:59:30.000Z',
    requestCount: 1,
    inputTokens: 100,
    outputTokens: 50,
    cacheCreationTokens: 0,
    cacheReadTokens: 10,
    reasoningTokens: 5,
    recordedAt: '2026-06-26T11:59:30.000Z',
    ...overrides,
  };
}

function execution(durationSeconds: number | null): UsageJobExecution {
  return {
    jobId: '22222222-2222-4222-8222-222222222222',
    jobExecutionId: '33333333-3333-4333-8333-333333333333',
    workflowRunId: RUN_ID,
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
    status: null,
    statusReason: null,
    cancellationReason: null,
    durationSeconds,
    state: null,
    recordedAt: null,
  };
}

describe('Usage aggregation', () => {
  test('summarizes compute, total tokens, requests, and models', () => {
    const usage = {
      jobExecutions: [execution(12), execution(null), execution(8)],
      inferenceSegments: [
        segment(),
        segment({
          id: '77777777-7777-4777-8777-777777777777',
          model: 'gpt-5',
          requestCount: 2,
          inputTokens: 200,
          outputTokens: 25,
        }),
      ],
    };

    const summary = summarizeRunUsage(usage);

    expect(summary.computeSeconds).toBe(20);
    expect(summary.totals).toMatchObject({
      requestCount: 3,
      inputTokens: 300,
      outputTokens: 75,
      cacheReadTokens: 20,
      reasoningTokens: 10,
      totalTokens: 405,
    });
    expect(summary.byModel.map(({model, totalTokens}) => [model, totalTokens])).toEqual([
      ['claude-sonnet-4', 165],
      ['gpt-5', 240],
    ]);
  });

  test('groups adjacent segments by step attempt, upstream, and model', () => {
    const rows = groupInferenceSegmentsByStepAttempt([
      segment(),
      segment({
        id: '77777777-7777-4777-8777-777777777777',
        requestCount: 2,
        inputTokens: 50,
      }),
      segment({
        id: '66666666-6666-4666-8666-666666666666',
        stepAttemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      stepAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      requestCount: 3,
      inputTokens: 150,
      totalTokens: 280,
    });
    expect(rows[1]).toMatchObject({
      stepAttemptId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestCount: 1,
    });
  });
});
