import type {
  InferenceSegmentUsageHttpDto,
  JobExecutionUsageHttpDto,
  RunUsageResponseDto,
} from '@shipfox/api-usage-dto';
import {toRunUsage} from './usage-mapper.js';

const WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTION_ID = '33333333-3333-4333-8333-333333333333';

const execution: JobExecutionUsageHttpDto = {
  job_id: JOB_ID,
  job_execution_id: EXECUTION_ID,
  workflow_run_id: RUN_ID,
  workflow_run_attempt_id: '44444444-4444-4444-8444-444444444444',
  workspace_id: WORKSPACE_ID,
  project_id: '66666666-6666-4666-8666-666666666666',
  definition_id: null,
  job_key: 'build',
  run_number: 42,
  requested_labels: ['linux'],
  runner_labels: ['linux', 'x86_64'],
  template_key: null,
  provisioner_id: null,
  provisioner_scope: null,
  provider_kind: 'managed',
  launch_kind: 'ephemeral',
  runner_class: 'standard',
  runner_arch: 'x86_64',
  runner_cpu: '4',
  managed: true,
  queued_at: '2026-06-26T11:59:00.000Z',
  started_at: '2026-06-26T11:59:05.000Z',
  finished_at: '2026-06-26T12:00:05.000Z',
  lease_expired_at: null,
  status: 'succeeded',
  status_reason: null,
  cancellation_reason: null,
  duration_seconds: 60,
  state: 'terminated',
  recorded_at: '2026-06-26T12:00:05.000Z',
};

const segment: InferenceSegmentUsageHttpDto = {
  id: '88888888-8888-4888-8888-888888888888',
  segment_key: 'gateway:build:1',
  source: 'gateway',
  workspace_id: WORKSPACE_ID,
  project_id: '66666666-6666-4666-8666-666666666666',
  workflow_run_id: RUN_ID,
  workflow_run_attempt_id: '44444444-4444-4444-8444-444444444444',
  job_id: JOB_ID,
  job_execution_id: EXECUTION_ID,
  step_id: '99999999-9999-4999-8999-999999999999',
  step_attempt_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  upstream: 'anthropic',
  model: 'claude-sonnet-4',
  dialect: 'anthropic-messages',
  window_start: '2026-06-26T11:59:20.000Z',
  window_end: '2026-06-26T11:59:30.000Z',
  request_count: 2,
  input_tokens: 1_200,
  output_tokens: 500,
  cache_creation_tokens: 0,
  cache_read_tokens: 100,
  reasoning_tokens: 80,
  recorded_at: '2026-06-26T11:59:30.000Z',
};

describe('Usage DTO mapper', () => {
  test('maps the strict snake_case response into package-owned domain models', () => {
    const result = toRunUsage({
      job_executions: [execution],
      inference_segments: [segment],
    } satisfies RunUsageResponseDto);

    expect(result).toEqual({
      jobExecutions: [
        {
          jobId: JOB_ID,
          jobExecutionId: EXECUTION_ID,
          workflowRunId: RUN_ID,
          workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
          workspaceId: WORKSPACE_ID,
          projectId: '66666666-6666-4666-8666-666666666666',
          definitionId: null,
          jobKey: 'build',
          runNumber: 42,
          requestedLabels: ['linux'],
          runnerLabels: ['linux', 'x86_64'],
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
      ],
      inferenceSegments: [
        {
          id: '88888888-8888-4888-8888-888888888888',
          segmentKey: 'gateway:build:1',
          source: 'gateway',
          workspaceId: WORKSPACE_ID,
          projectId: '66666666-6666-4666-8666-666666666666',
          workflowRunId: RUN_ID,
          workflowRunAttemptId: '44444444-4444-4444-8444-444444444444',
          jobId: JOB_ID,
          jobExecutionId: EXECUTION_ID,
          stepId: '99999999-9999-4999-8999-999999999999',
          stepAttemptId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
        },
      ],
    });
  });
});
