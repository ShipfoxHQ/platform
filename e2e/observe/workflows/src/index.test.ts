import type {
  WorkflowRunDetailResponseDto,
  WorkflowRunListItemDto,
  WorkflowRunListResponseDto,
  WorkflowRunStatusDto,
} from '@shipfox/api-workflows-dto';
import {waitForRunByCommit, waitForRunByDeliveryId, waitForRunTerminal} from './index.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const definitionId = '22222222-2222-4222-8222-222222222222';
const runId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const RUN_BY_COMMIT_TIMEOUT_RE =
  /Timed out waiting for workflow run by commit: expectedHeadCommitSha=abc123/u;
const RUN_BY_COMMIT_OBSERVED_RE = /headCommitSha=other/u;
const RUN_BY_DELIVERY_TIMEOUT_RE =
  /Timed out waiting for workflow run by delivery ID: expectedDeliveryId=delivery-1/u;
const RUN_BY_DELIVERY_OBSERVED_RE = /deliveryId=other-delivery/u;
const RUN_TERMINAL_TIMEOUT_RE =
  /Timed out waiting for workflow run terminal status: runId=33333333/u;
const RUN_TERMINAL_OBSERVED_RE = /status=running/u;

function valueOr<T>(value: T | undefined, fallback: T): T {
  return value ?? fallback;
}

function run(params: Partial<WorkflowRunListItemDto> = {}): WorkflowRunListItemDto {
  return {
    id: valueOr(params.id, runId),
    project_id: valueOr(params.project_id, projectId),
    definition_id: valueOr(params.definition_id, definitionId),
    number: valueOr(params.number, 1),
    name: valueOr(params.name, 'Build'),
    workflow_name: valueOr(params.workflow_name, 'Build'),
    status: valueOr(params.status, 'pending'),
    origin: valueOr(params.origin, 'synced'),
    dev_source: valueOr(params.dev_source, null),
    current_attempt: valueOr(params.current_attempt, 1),
    latest_attempt: valueOr(params.latest_attempt, 1),
    trigger_provider: valueOr(params.trigger_provider, 'gitea'),
    trigger_source: valueOr(params.trigger_source, 'gitea_e2e'),
    trigger_event: valueOr(params.trigger_event, 'push'),
    trigger_payload: valueOr(params.trigger_payload, {
      provider: 'gitea',
      source: 'gitea_e2e',
      event: 'push',
      deliveryId: 'delivery-1',
      data: {headCommitSha: 'abc123', ref: 'main'},
    }),
    trigger_reference: valueOr(params.trigger_reference, null),
    inputs: valueOr(params.inputs, null),
    source_snapshot: valueOr(params.source_snapshot, null),
    created_at: valueOr(params.created_at, '2026-07-02T08:00:00.000Z'),
    updated_at: valueOr(params.updated_at, '2026-07-02T08:00:00.000Z'),
    started_at: valueOr(params.started_at, null),
    finished_at: valueOr(params.finished_at, null),
    jobs: valueOr(params.jobs, []),
    job_status_counts: valueOr(params.job_status_counts, []),
    has_started_job_execution: valueOr(params.has_started_job_execution, false),
  };
}

function listResponse(
  params: Partial<WorkflowRunListResponseDto> = {},
): WorkflowRunListResponseDto {
  return {
    runs: params.runs ?? [],
    next_cursor: params.next_cursor ?? null,
    filtered_total_count: params.filtered_total_count ?? null,
  };
}

function detail(params: Partial<WorkflowRunDetailResponseDto> = {}): WorkflowRunDetailResponseDto {
  const {jobs: detailJobs, run_attempt: runAttempt, ...runParams} = params;
  const {jobs: _listJobs, job_status_counts: _listOnly, ...listItem} = run(runParams);
  return {
    ...listItem,
    run_attempt: runAttempt ?? {
      id: attemptId,
      workflow_run_id: params.id ?? runId,
      attempt: 1,
      status: params.status ?? 'pending',
      created_at: '2026-07-02T08:00:00.000Z',
      started_at: null,
      finished_at: null,
      rerun_mode: null,
    },
    jobs: detailJobs ?? [],
    has_started_job_execution: params.has_started_job_execution ?? false,
  };
}

function response(body: unknown): Response {
  return Response.json(body);
}

describe('waitForRunByCommit', () => {
  test('polls until a run with the matching head commit appears', async () => {
    let calls = 0;

    const result = await waitForRunByCommit({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          response(
            calls === 1
              ? listResponse({runs: [run({trigger_payload: {data: {headCommitSha: 'other'}}})]})
              : listResponse({runs: [run()]}),
          ),
        );
      },
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(calls).toBe(2);
  });

  test('correlates on a raw VCS push payload where the head commit is `after`', async () => {
    const result = await waitForRunByCommit({
      fetch: () =>
        response(
          listResponse({
            runs: [run({trigger_payload: {data: {ref: 'refs/heads/main', after: 'abc123'}}})],
          }),
        ),
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
  });

  test('times out with a bounded run list summary', async () => {
    const result = waitForRunByCommit({
      fetch: () =>
        response(listResponse({runs: [run({trigger_payload: {data: {headCommitSha: 'other'}}})]})),
      headCommitSha: 'abc123',
      initialDelayMs: 1,
      projectId,
      timeoutMs: 1,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(RUN_BY_COMMIT_TIMEOUT_RE);
    await expect(result).rejects.toThrow(RUN_BY_COMMIT_OBSERVED_RE);
  });

  test('passes abort signals through polling', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = waitForRunByCommit({
      fetch: () => response(listResponse()),
      headCommitSha: 'abc123',
      projectId,
      signal: controller.signal,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(
      'Stopped waiting for Timed out waiting for workflow run by commit',
    );
  });
});

describe('waitForRunByDeliveryId', () => {
  test('polls until a run with the matching delivery ID appears', async () => {
    let calls = 0;

    const result = await waitForRunByDeliveryId({
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          response(
            calls === 1
              ? listResponse({
                  runs: [run({trigger_payload: {deliveryId: 'other-delivery', data: {}}})],
                })
              : listResponse({runs: [run()]}),
          ),
        );
      },
      deliveryId: 'delivery-1',
      initialDelayMs: 1,
      projectId,
      token: 'user-token',
    });

    expect(result.id).toBe(runId);
    expect(calls).toBe(2);
  });

  test('times out with a bounded run list summary', async () => {
    const result = waitForRunByDeliveryId({
      fetch: () =>
        response(
          listResponse({runs: [run({trigger_payload: {deliveryId: 'other-delivery', data: {}}})]}),
        ),
      deliveryId: 'delivery-1',
      initialDelayMs: 1,
      projectId,
      timeoutMs: 1,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(RUN_BY_DELIVERY_TIMEOUT_RE);
    await expect(result).rejects.toThrow(RUN_BY_DELIVERY_OBSERVED_RE);
  });
});

describe('waitForRunTerminal', () => {
  test.each([
    'succeeded',
    'failed',
    'cancelled',
  ] satisfies WorkflowRunStatusDto[])('returns %s runs as terminal', async (status) => {
    const result = await waitForRunTerminal({
      fetch: () => response(detail({status})),
      runId,
      token: 'user-token',
    });

    expect(result.status).toBe(status);
    expect(result).not.toHaveProperty('job_status_counts');
  });

  test('polls until the run reaches a terminal status', async () => {
    let calls = 0;

    const result = await waitForRunTerminal({
      fetch: () => {
        calls += 1;
        return Promise.resolve(response(detail({status: calls === 1 ? 'running' : 'succeeded'})));
      },
      initialDelayMs: 1,
      runId,
      token: 'user-token',
    });

    expect(result.status).toBe('succeeded');
    expect(calls).toBe(2);
  });

  test('times out with the last run status', async () => {
    const result = waitForRunTerminal({
      fetch: () => response(detail({status: 'running'})),
      initialDelayMs: 1,
      runId,
      timeoutMs: 1,
      token: 'user-token',
    });

    await expect(result).rejects.toThrow(RUN_TERMINAL_TIMEOUT_RE);
    await expect(result).rejects.toThrow(RUN_TERMINAL_OBSERVED_RE);
  });
});
