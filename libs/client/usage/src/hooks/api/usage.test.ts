import {configureApiClient} from '@shipfox/client-api';
import {
  jobExecutionUsageQueryOptions,
  readJobExecutionUsage,
  readRunUsage,
  runUsageQueryOptions,
  usageQueryKeys,
} from './usage.js';

const WORKSPACE_ID = '55555555-5555-4555-8555-555555555555';
const RUN_ID = '11111111-1111-4111-8111-111111111111';
const JOB_ID = '22222222-2222-4222-8222-222222222222';
const EXECUTION_ID = '33333333-3333-4333-8333-333333333333';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    headers: {'content-type': 'application/json'},
    status: 200,
    ...init,
  });
}

function executionResponse() {
  return {
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
    runner_labels: ['linux'],
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
}

function segmentResponse() {
  return {
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
}

function runResponse() {
  return {job_executions: [executionResponse()], inference_segments: [segmentResponse()]};
}

describe('Usage API adapters', () => {
  beforeEach(() => {
    configureApiClient({baseUrl: 'https://api.example.test', fetchImpl: undefined});
  });

  test('reads and maps run usage through the checked route', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(runResponse()));
    configureApiClient({fetchImpl});

    const result = await readRunUsage({workspaceId: WORKSPACE_ID, workflowRunId: RUN_ID});

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      `https://api.example.test/usage/workspaces/${WORKSPACE_ID}/runs/${RUN_ID}`,
    );
    expect(result.jobExecutions[0]?.jobExecutionId).toBe(EXECUTION_ID);
    expect(result.inferenceSegments[0]?.outputTokens).toBe(500);
  });

  test('reads and maps one job execution usage response', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({job_execution: executionResponse(), inference_segments: [segmentResponse()]}),
      );
    configureApiClient({fetchImpl});

    const result = await readJobExecutionUsage({
      workspaceId: WORKSPACE_ID,
      jobExecutionId: EXECUTION_ID,
    });

    const request = fetchImpl.mock.calls[0]?.[0] as Request;
    expect(request.url).toBe(
      `https://api.example.test/usage/workspaces/${WORKSPACE_ID}/job-executions/${EXECUTION_ID}`,
    );
    expect(result.jobExecution.jobId).toBe(JOB_ID);
    expect(result.inferenceSegments).toHaveLength(1);
  });

  test('keeps query keys on UUID identity and disables incomplete resources', () => {
    expect(
      runUsageQueryOptions({workspaceId: WORKSPACE_ID, workflowRunId: RUN_ID}).queryKey,
    ).toEqual(usageQueryKeys.run(WORKSPACE_ID, RUN_ID));
    expect(
      jobExecutionUsageQueryOptions({workspaceId: undefined, jobExecutionId: EXECUTION_ID}).enabled,
    ).toBe(false);
  });
});
